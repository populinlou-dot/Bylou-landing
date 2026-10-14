-- Booking core · migration 12 · throttle_and_erasure (pre-release hardening, ADR-019 / ADR-020)
-- Forward-only: earlier files untouched.
--   (a) Churn throttle (security review LOW #3). A student could book and cancel (> 24 h ahead, free)
--       over and over to churn spots. book_session now refuses a NEW booking with `too_many_changes` when
--       either rolling 24 h limit in studio_settings is reached (null = that limit is off):
--         max_self_cancellations_24h (default 6): bookings she cancelled herself in the last 24 h;
--         max_session_bookings_24h   (default 3): bookings she made on THIS session in the last 24 h.
--       Both count existing booking rows (created_at / cancelled_at / cancelled_by / created_by), never
--       idempotency keys, so a fresh key cannot reset them. Replays (same key) return the original
--       result before any check. Cancelling is never throttled (it frees a spot). Staff paths
--       (admin_book_for, admin_cancel_for, admin_cancel_session) are not throttled, and a staff
--       cancellation does not count against the student.
--   (b) Account erasure (DATA_MODEL open issue 7, Ley 25.326). History is kept (FKs are ON DELETE
--       RESTRICT) but made pseudonymous: admin_anonymize_student nulls the profile's name, phone and
--       email, stamps profiles.anonymized_at, and erases the free-text notes of her packs and ledger rows.
--       The auth.users row cannot be deleted while history exists (profiles.id → auth.users ON DELETE
--       CASCADE hits bookings/ledger RESTRICT); SUPABASE_SETUP.md §10 has the owner step (ban the user).
--       An anonymized profile can no longer book (book_session → 42501; admin_book_for, grant_credits and
--       admin_adjust_credits → not_found),
--       edit her profile, or get her email re-synced from auth.users.
--
-- Lock order (DATA_MODEL §5.1) gains a level 0 above sessions: the student's own profile row.
--   book_session / admin_book_for / grant_credits / admin_adjust_credits take it FOR SHARE first; admin_anonymize_student takes it FOR NO KEY
--   UPDATE first. SHARE conflicts with NO KEY UPDATE, so a booking and an anonymization of the same
--   student serialize; both are compatible with the FOR KEY SHARE that every FK check takes, so refunds,
--   grants and ledger inserts never wait on it. Below level 0 the order is unchanged.

-- (a) Throttle settings ---------------------------------------------------------------------------------
-- Not granted to anon/authenticated (column-level SELECT, migration 8): the UI does not need them.
alter table public.studio_settings
  add column max_self_cancellations_24h int default 6
    check (max_self_cancellations_24h between 1 and 100),
  add column max_session_bookings_24h int default 3
    check (max_session_bookings_24h between 1 and 100);

-- Throttle lookups: one index range scan each.
create index bookings_user_cancelled_idx on public.bookings (user_id, cancelled_at) where cancelled_at is not null;
create index bookings_user_session_idx   on public.bookings (user_id, session_id, created_at);

-- (b) Anonymization columns --------------------------------------------------------------------------------
alter table public.profiles add column anonymized_at timestamptz;
-- Audit: the staff member who ran the erasure (readable under the existing profiles RLS: staff, and the
-- row's owner while a session of hers is still valid).
alter table public.profiles add column anonymized_by uuid references public.profiles(id);
alter table public.profiles add constraint profiles_anonymized_by_consistent
  check ((anonymized_at is null) = (anonymized_by is null));
-- Backstop: an anonymized profile carries no personal data.
alter table public.profiles add constraint profiles_anonymized_scrubbed
  check (anonymized_at is null or (email is null and display_name is null and phone is null));

-- Ledger notes are free text (staff reasons). Erasure nulls them and stamps note_erased_at; an
-- admin_adjust entry keeps its "reason required" backstop unless its note was erased.
alter table public.credit_ledger add column note_erased_at timestamptz;
alter table public.credit_ledger drop constraint ledger_adjust_note;
alter table public.credit_ledger add constraint ledger_adjust_note
  check (reason <> 'admin_adjust' or note is not null or note_erased_at is not null);
alter table public.credit_ledger add constraint ledger_note_erased_consistent
  check (note_erased_at is null or note is null);

-- Append-only stays the rule (I8). The ONE exception is the erasure itself: inside
-- admin_anonymize_student the transaction-local flag `bylou.ledger_note_erasure` is 'on', and then a row
-- may change only note → null with note_erased_at set; every other column must stay identical.
-- DELETE / TRUNCATE are always refused; so is any UPDATE without the flag (even by the table owner).
create function private.ledger_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and pg_catalog.current_setting('bylou.ledger_note_erasure', true) = 'on' then
    return null;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create function private.ledger_note_erasure_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.note is null and new.note_erased_at is not null
     and (pg_catalog.to_jsonb(new) - 'note' - 'note_erased_at') = (pg_catalog.to_jsonb(old) - 'note' - 'note_erased_at') then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

revoke execute on function private.ledger_append_only() from public, anon, authenticated;
revoke execute on function private.ledger_note_erasure_only() from public, anon, authenticated;

drop trigger credit_ledger_append_only on public.credit_ledger;
create trigger credit_ledger_append_only before update or delete or truncate on public.credit_ledger
  for each statement execute function private.ledger_append_only();
create trigger credit_ledger_note_erasure_only before update on public.credit_ledger
  for each row execute function private.ledger_note_erasure_only();

-- An anonymized profile never gets an address back from auth.users (e.g. if the owner edits the auth
-- record later). Otherwise identical to migration 8.
create or replace function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set email = case when new.email_confirmed_at is not null then nullif(new.email, '') end
   where id = new.id and anonymized_at is null;
  return new;
end $$;
revoke execute on function private.sync_user_email() from public, anon, authenticated;

-- A signed-in but anonymized student cannot write a name or phone back.
drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and anonymized_at is null)
  with check (id = (select auth.uid()) and anonymized_at is null);

-- (a) + (b) book_session -----------------------------------------------------------------------------------
-- Identical to migration 8 except: LOCK 0 (own profile FOR SHARE; anonymized → 42501 forbidden) and the
-- throttle (step e). Check order: replay → not_found → session_cancelled → session_started →
-- booking_not_open → booking_closed → already_booked → session_full → too_many_changes → no_valid_credit.
create or replace function public.book_session(p_session_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid        uuid := (select auth.uid());
  v_rules      public.studio_settings%rowtype;
  v_session    public.sessions%rowtype;
  v_prior      public.bookings%rowtype;
  v_grant      public.credit_grants%rowtype;
  v_booking    uuid;
  v_opens      timestamptz;
  v_anonymized timestamptz;
  v_count      int;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_session_id is null or p_idempotency_key is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- (a) Fast replay, no locks. A replay writes nothing, so it is never throttled.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  -- LOCK 0: the caller's own profile (FOR SHARE). Serializes with admin_anonymize_student only.
  select p.anonymized_at into v_anonymized from public.profiles p where p.id = v_uid for share;
  if not found or v_anonymized is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_rules from public.studio_settings where id = 1;

  -- (b) LOCK 1: the session row (only; the EXISTS sublink is not locked). Hidden sessions → not_found.
  select * into v_session from public.sessions s
   where s.id = p_session_id and s.is_published
     and exists (select 1 from public.class_types ct where ct.id = s.class_type_id and ct.is_published)
     for update;
  if not found then return private.fail('not_found'); end if;

  -- (c) Replay re-check: a concurrent call with the same key may have committed while we waited.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  -- (d) Rules.
  v_opens := v_session.starts_at - make_interval(hours => 24 * v_rules.booking_opens_days);
  if v_session.status = 'cancelled' then return private.fail('session_cancelled'); end if;
  if now() >= v_session.starts_at then return private.fail('session_started'); end if;
  if now() < v_opens then
    return private.fail('booking_not_open', jsonb_build_object('opens_at', v_opens));
  end if;
  if now() >= v_session.starts_at - make_interval(mins => v_rules.booking_closes_minutes) then
    return private.fail('booking_closed');
  end if;

  select * into v_prior from public.bookings
   where session_id = v_session.id and user_id = v_uid and status = 'confirmed';
  if found then return private.fail('already_booked', jsonb_build_object('booking_id', v_prior.id)); end if;
  if v_session.confirmed_count >= v_session.capacity then return private.fail('session_full'); end if;

  -- (e) Churn throttle (ADR-019). Rows, not keys: a new idempotency key does not reset it. Only the
  --     student's own actions count (staff bookings and cancellations on her behalf do not).
  if v_rules.max_self_cancellations_24h is not null then
    select count(*)::int into v_count from public.bookings b
     where b.user_id = v_uid and b.cancelled_at > now() - make_interval(hours => 24) and b.cancelled_by = v_uid;
    if v_count >= v_rules.max_self_cancellations_24h then
      return private.fail('too_many_changes', jsonb_build_object('limit', 'cancellations'));
    end if;
  end if;
  if v_rules.max_session_bookings_24h is not null then
    select count(*)::int into v_count from public.bookings b
     where b.user_id = v_uid and b.session_id = v_session.id
       and b.created_at > now() - make_interval(hours => 24) and b.created_by = v_uid;
    if v_count >= v_rules.max_session_bookings_24h then
      return private.fail('too_many_changes', jsonb_build_object('limit', 'session_rebookings'));
    end if;
  end if;

  -- (f) LOCK 4: every usable grant in ONE statement ordered by id, then pick earliest-expiring.
  select * into v_grant from (
    select g.* from public.credit_grants g
     where g.user_id = v_uid
       and g.credits_remaining >= v_rules.credits_per_booking
       and g.valid_from <= now()
       and g.expires_at > v_session.starts_at
     order by g.id
     for update
  ) usable
  order by usable.expires_at, usable.created_at, usable.id
  limit 1;
  if not found then return private.fail('no_valid_credit'); end if;

  -- (g) Writes: booking, grant, ledger, counter — one transaction, all or nothing.
  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited, source, created_by)
  values (v_session.id, v_uid, p_idempotency_key, v_grant.id, v_rules.credits_per_booking, 'student', v_uid)
  returning id into v_booking;

  update public.credit_grants set credits_remaining = credits_remaining - v_rules.credits_per_booking
   where id = v_grant.id;
  insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
  values (v_uid, v_grant.id, v_booking, 'booking_debit', -v_rules.credits_per_booking, v_uid);
  update public.sessions set confirmed_count = confirmed_count + 1 where id = v_session.id;

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking, 'session_id', v_session.id,
    'status', 'confirmed', 'replayed', false, 'credits_debited', v_rules.credits_per_booking,
    'grant_expires_at', v_grant.expires_at,
    'remaining_credits', private.usable_balance(v_uid),
    'spots_left', v_session.capacity - v_session.confirmed_count - 1);
exception
  when unique_violation then
    select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return private.booking_replay(v_prior, p_session_id); end if;
    return private.fail('already_booked');
end $$;

-- (b) admin_book_for -----------------------------------------------------------------------------------------
-- Identical to migration 10 except LOCK 0: the student's profile FOR SHARE; an anonymized student is
-- not_found (same answer as an unknown id). Not throttled (ADR-019).
create or replace function public.admin_book_for(p_user_id uuid, p_session_id uuid, p_request_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff   uuid := (select auth.uid());
  v_rules   public.studio_settings%rowtype;
  v_session public.sessions%rowtype;
  v_prior   public.bookings%rowtype;
  v_grant   public.credit_grants%rowtype;
  v_booking uuid;
begin
  perform private.assert_staff();
  if p_user_id is null or p_session_id is null or p_request_key is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_prior from public.bookings where user_id = p_user_id and idempotency_key = p_request_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  perform 1 from public.profiles p                                                             -- LOCK 0
   where p.id = p_user_id and p.role = 'student' and p.anonymized_at is null
     for share;
  if not found then return private.fail('not_found'); end if;
  select * into v_rules from public.studio_settings where id = 1;

  select * into v_session from public.sessions where id = p_session_id for update;            -- LOCK 1
  if not found then return private.fail('not_found'); end if;

  select * into v_prior from public.bookings where user_id = p_user_id and idempotency_key = p_request_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  if v_session.status = 'cancelled' then return private.fail('session_cancelled'); end if;
  if now() >= v_session.starts_at then return private.fail('session_started'); end if;
  -- AD-10: booking_not_open / booking_closed are deliberately not checked.

  select * into v_prior from public.bookings
   where session_id = v_session.id and user_id = p_user_id and status = 'confirmed';
  if found then return private.fail('already_booked', jsonb_build_object('booking_id', v_prior.id)); end if;
  if v_session.confirmed_count >= v_session.capacity then return private.fail('session_full'); end if;

  select * into v_grant from (                                                                 -- LOCK 4
    select g.* from public.credit_grants g
     where g.user_id = p_user_id
       and g.credits_remaining >= v_rules.credits_per_booking
       and g.valid_from <= now()
       and g.expires_at > v_session.starts_at
     order by g.id
     for update
  ) usable
  order by usable.expires_at, usable.created_at, usable.id
  limit 1;
  if not found then return private.fail('no_valid_credit'); end if;

  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited, source, created_by)
  values (v_session.id, p_user_id, p_request_key, v_grant.id, v_rules.credits_per_booking, 'staff', v_staff)
  returning id into v_booking;

  update public.credit_grants set credits_remaining = credits_remaining - v_rules.credits_per_booking
   where id = v_grant.id;
  insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
  values (p_user_id, v_grant.id, v_booking, 'booking_debit', -v_rules.credits_per_booking, v_staff);
  update public.sessions set confirmed_count = confirmed_count + 1 where id = v_session.id;

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking, 'session_id', v_session.id,
    'user_id', p_user_id, 'status', 'confirmed', 'replayed', false, 'credits_debited', v_rules.credits_per_booking,
    'remaining_credits', private.usable_balance(p_user_id),
    'spots_left', v_session.capacity - v_session.confirmed_count - 1);
exception
  when unique_violation then
    select * into v_prior from public.bookings where user_id = p_user_id and idempotency_key = p_request_key;
    if found then return private.booking_replay(v_prior, p_session_id); end if;
    return private.fail('already_booked');
end $$;

-- (b) Student summaries: + anonymized_at; search skips anonymized profiles (nothing left to search by).
create or replace function private.student_summary(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'email', p.email,
    'anonymized_at', p.anonymized_at,
    'balance', private.usable_balance(p.id),
    'next_expiry', (select min(g.expires_at) from public.credit_grants g
                     where g.user_id = p.id and g.credits_remaining > 0
                       and g.valid_from <= now() and g.expires_at > now()),
    'next_booking', (select jsonb_build_object('booking_id', b.id, 'session_id', s.id, 'starts_at', s.starts_at,
                                               'class_type_name', ct.name)
                       from public.bookings b
                       join public.sessions s on s.id = b.session_id
                       join public.class_types ct on ct.id = s.class_type_id
                      where b.user_id = p.id and b.status = 'confirmed' and s.status = 'scheduled' and s.ends_at > now()
                      order by s.starts_at, s.id
                      limit 1))
    from public.profiles p
   where p.id = p_user_id
$$;
revoke execute on function private.student_summary(uuid) from public, anon, authenticated;

create or replace function public.admin_search_students(p_query text default null, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_query   text := nullif(pg_catalog.btrim(p_query), '');
  v_pattern text;
  v_rows    jsonb;
begin
  perform private.assert_staff();
  if p_limit is null or p_limit not between 1 and 100 or char_length(v_query) > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
                 coalesce(v_query, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(private.student_summary(m.id) order by m.unnamed, m.sort_key, m.id), '[]'::jsonb) into v_rows
    from (select p.id, n.label is null as unnamed, pg_catalog.lower(n.label) as sort_key
            from public.profiles p
           cross join lateral (select coalesce(nullif(pg_catalog.btrim(p.display_name), ''), p.email) as label) n
           where p.role = 'student' and p.anonymized_at is null
             and (v_query is null or p.display_name ilike v_pattern or p.email ilike v_pattern)
           order by 2, 3, p.id
           limit p_limit) m;

  return jsonb_build_object('ok', true, 'code', null, 'students', v_rows);
end $$;

-- (b) grant_credits ------------------------------------------------------------------------------------------
-- Identical to migration 7 except LOCK 0: the student's profile FOR SHARE (before the grant insert's own
-- locks); an anonymized profile is not_found (like admin_book_for), so no note with personal data can be
-- written after the erasure and no grant can slip past its notes sweep.
create or replace function public.grant_credits(p_user_id uuid, p_credits int, p_valid_days int,
                                                p_note text, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff   uuid := (select auth.uid());
  v_tz      text;
  v_prior   public.credit_grants%rowtype;
  v_expires timestamptz;
  v_grant   uuid;
begin
  perform private.assert_staff();
  if p_user_id is null or p_idempotency_key is null
     or p_credits is null or p_credits not between 1 and 100
     or p_valid_days is null or p_valid_days not between 1 and 365
     or char_length(p_note) > 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('grant_credits:' || v_staff::text || ':' || p_idempotency_key::text, 0));
  select * into v_prior from public.credit_grants where granted_by = v_staff and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.user_id <> p_user_id or v_prior.credits_total <> p_credits then
      raise exception 'idempotency key reused for a different grant' using errcode = '22023';
    end if;
    return jsonb_build_object('ok', true, 'code', null, 'grant_id', v_prior.id,
      'credits', v_prior.credits_total, 'expires_at', v_prior.expires_at, 'replayed', true);
  end if;

  perform 1 from public.profiles p where p.id = p_user_id and p.anonymized_at is null for share;  -- LOCK 0
  if not found then return private.fail('not_found'); end if;

  select timezone into v_tz from public.studio_settings where id = 1;
  v_expires := (((now() at time zone v_tz)::date + p_valid_days)::timestamp) at time zone v_tz;

  insert into public.credit_grants (user_id, credits_total, credits_remaining, expires_at, note,
                                    granted_by, idempotency_key)
  values (p_user_id, p_credits, p_credits, v_expires, p_note, v_staff, p_idempotency_key)
  returning id into v_grant;
  insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id, note)
  values (p_user_id, v_grant, 'grant', p_credits, v_staff, p_note);

  return jsonb_build_object('ok', true, 'code', null, 'grant_id', v_grant,
    'credits', p_credits, 'expires_at', v_expires, 'replayed', false);
end $$;

-- (b) admin_adjust_credits -----------------------------------------------------------------------------------
-- Identical to migration 10 except LOCK 0: an unlocked read learns the pack's owner, her profile is taken
-- FOR SHARE before the grant row (lock order profile → grants); an anonymized owner → not_found.
create or replace function public.admin_adjust_credits(p_grant_id uuid, p_delta int, p_reason text, p_request_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff  uuid := (select auth.uid());
  v_reason text := pg_catalog.btrim(p_reason);
  v_prior  public.credit_ledger%rowtype;
  v_grant  public.credit_grants%rowtype;
  v_owner  uuid;
  v_held   int;
  v_entry  bigint;
begin
  perform private.assert_staff();
  if p_grant_id is null or p_request_key is null
     or p_delta is null or p_delta = 0 or p_delta not between -100 and 100
     or v_reason is null or char_length(v_reason) not between 1 and 200 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Serialize calls sharing a key (double click), then replay.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_adjust_credits:' || v_staff::text || ':' || p_request_key::text, 0));
  select * into v_prior from public.credit_ledger where actor_id = v_staff and request_key = p_request_key;
  if found then
    if v_prior.grant_id <> p_grant_id or v_prior.delta <> p_delta then
      raise exception 'idempotency key reused for a different adjustment' using errcode = '22023';
    end if;
    select * into v_grant from public.credit_grants where id = v_prior.grant_id;
    return jsonb_build_object('ok', true, 'code', null, 'ledger_id', v_prior.id, 'grant_id', v_prior.grant_id,
      'user_id', v_prior.user_id, 'delta', v_prior.delta, 'credits_remaining', v_grant.credits_remaining,
      'balance', private.usable_balance(v_prior.user_id), 'replayed', true);
  end if;

  -- A pack never changes owner, so the unlocked read is enough to find which profile to lock.
  select g.user_id into v_owner from public.credit_grants g where g.id = p_grant_id;
  if not found then return private.fail('not_found'); end if;
  perform 1 from public.profiles p where p.id = v_owner and p.anonymized_at is null for share;    -- LOCK 0
  if not found then return private.fail('not_found'); end if;

  -- LOCK 4 only: one grant, one statement. FOR UPDATE returns the latest committed version, so a
  -- concurrent book_session debit of this grant is seen before the bounds are checked.
  select * into v_grant from public.credit_grants where id = p_grant_id for update;
  if v_grant.expires_at <= now() then return private.fail('grant_expired'); end if;
  if v_grant.credits_remaining + p_delta < 0 then
    return private.fail('insufficient_balance', jsonb_build_object('credits_remaining', v_grant.credits_remaining));
  end if;
  -- Credits still out on confirmed bookings come back on a refund: reserve room for them (migration 10).
  select coalesce(sum(b.credits_debited), 0)::int into v_held
    from public.bookings b where b.credit_grant_id = v_grant.id and b.status = 'confirmed';
  if v_grant.credits_remaining + p_delta > v_grant.credits_total - v_held then
    return private.fail('adjust_exceeds_pack', jsonb_build_object('credits_remaining', v_grant.credits_remaining,
      'credits_total', v_grant.credits_total, 'credits_booked', v_held));
  end if;

  update public.credit_grants set credits_remaining = credits_remaining + p_delta where id = v_grant.id;
  insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id, note, request_key)
  values (v_grant.user_id, v_grant.id, 'admin_adjust', p_delta, v_staff, v_reason, p_request_key)
  returning id into v_entry;

  return jsonb_build_object('ok', true, 'code', null, 'ledger_id', v_entry, 'grant_id', v_grant.id,
    'user_id', v_grant.user_id, 'delta', p_delta, 'credits_remaining', v_grant.credits_remaining + p_delta,
    'balance', private.usable_balance(v_grant.user_id), 'replayed', false);
end $$;

-- (b) admin_anonymize_student ------------------------------------------------------------------------------
-- Staff-only erasure of one student's personal data. p_confirm_email is a typo guard, so the wrong
-- student is never erased: her current (confirmed) email, case-insensitive; if she has none, her exact
-- display name or her user id. Refused while she has a
-- confirmed booking whose session has not ended (`has_upcoming_bookings`): staff cancel those first.
-- Keeps every booking, pack and ledger row (pseudonymous history; balances and counters unchanged) and
-- erases: profiles.display_name / phone / email, credit_grants.note, credit_ledger.note.
-- Idempotent: an already anonymized student → ok with replayed = true (the email is gone, so the
-- confirmation is not re-checked). Locks: LOCK 0 profile (NO KEY UPDATE), then LOCK 4 her grants (one
-- statement, ordered by id); ledger rows are never locked by any other path.
create function public.admin_anonymize_student(p_user_id uuid, p_confirm_email text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_confirm  text := pg_catalog.lower(pg_catalog.btrim(p_confirm_email));
  v_profile  public.profiles%rowtype;
  v_upcoming int;
  v_grants   int;
  v_ledger   int;
begin
  perform private.assert_staff();
  if p_user_id is null or v_confirm is null or v_confirm = '' or char_length(v_confirm) > 320 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = p_user_id for no key update;        -- LOCK 0
  if not found or v_profile.role <> 'student' then return private.fail('not_found'); end if;
  if v_profile.anonymized_at is not null then
    return jsonb_build_object('ok', true, 'code', null, 'user_id', v_profile.id,
      'anonymized_at', v_profile.anonymized_at, 'replayed', true);
  end if;
  -- Typo guard. With a confirmed email: that email (case-insensitive). Without one (an unconfirmed
  -- sign-up, migration 8): her exact display name, or her user id.
  if v_profile.email is not null then
    if pg_catalog.lower(v_profile.email) <> v_confirm then return private.fail('email_mismatch'); end if;
  elsif v_confirm <> v_profile.id::text
        and pg_catalog.btrim(p_confirm_email) is distinct from pg_catalog.btrim(v_profile.display_name) then
    return private.fail('email_mismatch');
  end if;

  -- Under LOCK 0 no new booking of hers can commit (book_session / admin_book_for wait on it).
  select count(*)::int into v_upcoming
    from public.bookings b join public.sessions s on s.id = b.session_id
   where b.user_id = v_profile.id and b.status = 'confirmed' and s.status = 'scheduled' and s.ends_at > now();
  if v_upcoming > 0 then
    return private.fail('has_upcoming_bookings', jsonb_build_object('upcoming', v_upcoming));
  end if;

  perform 1 from public.credit_grants g                                                        -- LOCK 4
   where g.user_id = v_profile.id and g.note is not null order by g.id for update;
  update public.credit_grants set note = null where user_id = v_profile.id and note is not null;
  get diagnostics v_grants = row_count;

  perform pg_catalog.set_config('bylou.ledger_note_erasure', 'on', true);
  update public.credit_ledger set note = null, note_erased_at = now()
   where user_id = v_profile.id and note is not null;
  get diagnostics v_ledger = row_count;
  perform pg_catalog.set_config('bylou.ledger_note_erasure', '', true);

  update public.profiles
     set display_name = null, phone = null, email = null, anonymized_at = now(), anonymized_by = (select auth.uid())
   where id = v_profile.id;

  return jsonb_build_object('ok', true, 'code', null, 'user_id', v_profile.id, 'anonymized_at', now(),
    'replayed', false, 'grant_notes_erased', v_grants, 'ledger_notes_erased', v_ledger);
end $$;

-- Privileges: Postgres grants EXECUTE to PUBLIC by default; revoking only anon is not enough.
-- CREATE OR REPLACE keeps existing grants; restated so this file is self-describing.
revoke execute on function public.book_session(uuid, uuid) from public, anon;
grant  execute on function public.book_session(uuid, uuid) to authenticated;
revoke execute on function public.admin_book_for(uuid, uuid, uuid) from public, anon;
grant  execute on function public.admin_book_for(uuid, uuid, uuid) to authenticated;
revoke execute on function public.admin_search_students(text, int) from public, anon;
grant  execute on function public.admin_search_students(text, int) to authenticated;
revoke execute on function public.grant_credits(uuid, int, int, text, uuid) from public, anon;
grant  execute on function public.grant_credits(uuid, int, int, text, uuid) to authenticated;
revoke execute on function public.admin_adjust_credits(uuid, int, text, uuid) from public, anon;
grant  execute on function public.admin_adjust_credits(uuid, int, text, uuid) to authenticated;
revoke execute on function public.admin_anonymize_student(uuid, text) from public, anon;
grant  execute on function public.admin_anonymize_student(uuid, text) to authenticated;

-- rollback (local only; production fixes forward — erased data cannot come back):
--   drop function public.admin_anonymize_student(uuid, text);
--   re-run public.admin_search_students / private.student_summary / public.admin_book_for / public.admin_adjust_credits
--   from migration 10 and public.grant_credits from migration 7
--   and public.book_session from migration 8;
--   drop policy profiles_update_own on public.profiles; recreate it from migration 5;
--   re-run private.sync_user_email from migration 8;
--   drop trigger credit_ledger_note_erasure_only on public.credit_ledger; drop trigger credit_ledger_append_only on public.credit_ledger;
--   create trigger credit_ledger_append_only before update or delete or truncate on public.credit_ledger
--     for each statement execute function private.forbid_mutation();
--   drop function private.ledger_note_erasure_only(); drop function private.ledger_append_only();
--   alter table public.credit_ledger drop constraint ledger_note_erased_consistent;
--   alter table public.credit_ledger drop constraint ledger_adjust_note;
--   alter table public.credit_ledger add constraint ledger_adjust_note check (reason <> 'admin_adjust' or note is not null);
--   alter table public.credit_ledger drop column note_erased_at;
--   alter table public.profiles drop constraint profiles_anonymized_by_consistent; alter table public.profiles drop column anonymized_by;
--   alter table public.profiles drop constraint profiles_anonymized_scrubbed; alter table public.profiles drop column anonymized_at;
--   drop index public.bookings_user_session_idx; drop index public.bookings_user_cancelled_idx;
--   alter table public.studio_settings drop column max_session_bookings_24h, drop column max_self_cancellations_24h;
