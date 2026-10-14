-- Booking core · migration 13 · waitlist (Phase 4.4, PRD ST-12, ADR-011 / ADR-021) + required display name
-- Forward-only: earlier files untouched; every function that changes is redefined here.
--
-- Owner rule (2026-10-14): FIFO. When a spot opens, the first waiting student is promoted ONLY if
--   (1) she holds a pack valid at the session start with enough credits (same selection as book_session), and
--   (2) the session starts MORE than studio_settings.cancellation_window_hours from now
--       (a promoted student must still be able to cancel for free).
-- Otherwise:
--   * no valid pack            → her entry becomes `skipped` (skip_reason no_valid_credit): she leaves the
--                                list and may join again (at the end). The next student is tried.
--   * already holds a booking  → `skipped` (already_booked), next student.
--   * inside the window        → nobody is promoted (the rule is session-wide); entries stay `waiting`,
--                                the freed spot is bookable first-come, and joining is refused
--                                (`waitlist_closed`).
-- If nobody is eligible the spot stays open for normal booking.
--
-- Promotion runs INSIDE the transaction that frees the spot: cancel_booking, admin_cancel_for and
-- admin_update_session (capacity increase). It debits exactly once with book_session's credit selection
-- (earliest expires_at, then created_at, then id), writes a booking with source 'waitlist'
-- (idempotency_key = entry id, so one entry can never produce two bookings), a `booking_debit` ledger
-- row with actor_id null (system), confirmed_count + 1, and marks the entry `promoted`.
-- admin_cancel_session closes waiting entries (`closed`, session_cancelled); admin_anonymize_student
-- closes hers (`closed`, account_erased); a direct booking (book_session / admin_book_for) closes the
-- booker's own waiting entry (`closed`, booked).
--
-- Feature flag: studio_settings.waitlist_enabled (migration 3) is the server-side switch. Off → every
-- waitlist RPC answers `waitlist_disabled`, the read returns no entries and nothing is promoted.
-- Bylou turns it on here (owner decision 2026-10-14); the brand flag `features.waitlist` hides the UI.
--
-- Required name (owner decision 2026-10-14): book_session and join_waitlist answer `profile_incomplete`
-- while the caller's profiles.display_name is null or invisible (private.has_display_name); a CHECK keeps new
-- invisible names out. Staff paths (admin_book_for) are unaffected.
--
-- Lock order (DATA_MODEL §5.1) is unchanged: profile → session → bookings → waitlist entries
-- (created_at, id) → credit grants (ONE statement, ordered by id). The promotion locks every waiting
-- entry of the session, then — in the same single grant statement as any refund grant — every usable
-- grant of every waiting student; it then only debits grants from that locked set, so it never takes a
-- grant lock afterwards. admin_anonymize_student (profile → her waiting entries → her grants) locks her
-- entries BEFORE its "no upcoming bookings" check, so a concurrent promotion of her either commits first
-- (and the check sees the new booking) or waits and finds her entry closed.
-- No notifications exist in the MVP: a promoted or skipped student sees the result the next time she
-- opens the app (Mis reservas).

-- (a) Table ------------------------------------------------------------------------------------------------
create table public.waitlist_entries (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.sessions(id) on delete restrict,
  user_id             uuid not null references public.profiles(id) on delete restrict,
  status              text not null default 'waiting'
                        check (status in ('waiting', 'promoted', 'skipped', 'left', 'closed')),
  skip_reason         text check (skip_reason in ('no_valid_credit', 'already_booked', 'profile_incomplete',
                                                  'too_many_changes', 'promotion_failed')),
  close_reason        text check (close_reason in ('session_cancelled', 'account_erased', 'booked')),
  promoted_booking_id uuid references public.bookings(id) on delete restrict,
  request_key         uuid not null,              -- join_waitlist idempotency key (per user)
  created_at          timestamptz not null default pg_catalog.clock_timestamp(),   -- FIFO order
  resolved_at         timestamptz,
  constraint waitlist_resolved  check ((status = 'waiting') = (resolved_at is null)),
  constraint waitlist_promoted  check ((status = 'promoted') = (promoted_booking_id is not null)),
  constraint waitlist_skipped   check ((status = 'skipped') = (skip_reason is not null)),
  constraint waitlist_closed    check ((status = 'closed') = (close_reason is not null)),
  constraint waitlist_request   unique (user_id, request_key)
);
-- One active (waiting) entry per student per session.
create unique index waitlist_one_waiting on public.waitlist_entries (session_id, user_id) where status = 'waiting';
create index waitlist_fifo on public.waitlist_entries (session_id, created_at, id) where status = 'waiting';
create index waitlist_user_idx on public.waitlist_entries (user_id, created_at desc);
create unique index waitlist_one_promotion on public.waitlist_entries (promoted_booking_id) where promoted_booking_id is not null;

-- Privileges + RLS: a student reads only her own entries, staff read all; nobody writes directly.
revoke all on public.waitlist_entries from anon, authenticated;
grant select on public.waitlist_entries to authenticated;
alter table public.waitlist_entries enable row level security;
create policy waitlist_select on public.waitlist_entries for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));

-- Bylou turns the waitlist on (owner decision 2026-10-14). One project per studio (DATA_MODEL §1).
update public.studio_settings set waitlist_enabled = true where id = 1;

-- Required name (ADR-022): a name made only of whitespace, control, zero-width, BOM or Hangul filler characters
-- is no name. Same character set as booking/application/profile.ts (BLANK_NAME). The CHECK inlines the pattern
-- (a CHECK calling a private function would need EXECUTE for every writer); null stays allowed (new sign-ups,
-- anonymized profiles).
create function private.has_display_name(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name is not null and p_name !~ '^[[:space:]\u0001-\u001f\u007f-\u009f ᅟᅠ ᠎ -‍    ⁠　ㅤ﻿ﾠ]*$'
$$;
revoke execute on function private.has_display_name(text) from public, anon, authenticated;
alter table public.profiles add constraint profiles_display_name_visible
  check (display_name is null or display_name !~ '^[[:space:]\u0001-\u001f\u007f-\u009f ᅟᅠ ᠎ -‍    ⁠　ㅤ﻿ﾠ]*$');

-- (b) Helpers (private, no EXECUTE for anyone) -----------------------------------------------------------------
-- True when a freed spot of this session may go to the waitlist right now: flag on, session scheduled,
-- it starts MORE than cancellation_window_hours from now, and booking has not closed (booking_closes_minutes).
create function private.waitlist_promotion_open(p_starts_at timestamptz, p_status text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select st.waitlist_enabled and p_status = 'scheduled'
                          and now() < p_starts_at - make_interval(hours => st.cancellation_window_hours)
                          and now() < p_starts_at - make_interval(mins => st.booking_closes_minutes)
                     from public.studio_settings st where st.id = 1), false)
$$;

-- 1-based place in the queue of a waiting entry (null when it is not waiting).
create function private.waitlist_position(p_entry_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*)::int + 1 from public.waitlist_entries o
           where o.session_id = e.session_id and o.status = 'waiting'
             and (o.created_at, o.id) < (e.created_at, e.id))
    from public.waitlist_entries e
   where e.id = p_entry_id and e.status = 'waiting'
$$;

-- LOCK 3 + LOCK 4 for a transaction that frees a spot (caller already holds the session row, LOCK 1, and
-- any booking row, LOCK 2). With p_promote: every waiting entry of the session (created_at, id). Then ONE
-- grant statement ordered by id: p_extra_grants (e.g. the refund grant) plus, with p_promote, every grant of
-- a waiting student that book_session would accept for this session. Returns the locked grant ids: the
-- promotion debits only from this set, so no grant lock is ever taken afterwards (§5.1 rule 4).
create function private.lock_for_promotion(p_session_id uuid, p_starts_at timestamptz,
                                           p_extra_grants uuid[], p_promote boolean) returns uuid[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_per_booking int;
  v_ids         uuid[];
begin
  if p_promote then
    perform 1 from public.waitlist_entries w
     where w.session_id = p_session_id and w.status = 'waiting'
     order by w.created_at, w.id
       for update;
  end if;
  select st.credits_per_booking into v_per_booking from public.studio_settings st where st.id = 1;
  with locked as (
    select g.id from public.credit_grants g
     where g.id = any(coalesce(p_extra_grants, '{}'::uuid[]))
        or (p_promote
            and g.user_id in (select w.user_id from public.waitlist_entries w
                               where w.session_id = p_session_id and w.status = 'waiting')
            and g.credits_remaining >= v_per_booking
            and g.valid_from <= now()
            and g.expires_at > p_starts_at)
     order by g.id
       for update
  )
  select coalesce(array_agg(locked.id), '{}'::uuid[]) into v_ids from locked;
  return v_ids;
end $$;

-- FIFO promotion. Precondition: the caller holds the session row lock and called private.lock_for_promotion
-- (p_promote = true) in this transaction, passing its result as p_locked_grants. Returns the promotions as
-- [{entry_id, user_id, booking_id}] ('[]' when the rule does not allow any).
-- Skips, in this order: already booked, no display name, too many self-cancellations in 24 h (ADR-019), no
-- valid pack. Each promotion runs in its own subtransaction: if writing it fails for any reason, only that
-- entry is skipped ('promotion_failed') and the cancellation / capacity change that freed the spot still commits.
-- The booking key is random (never the entry id, which the student knows and could pre-use as a book_session key).
create function private.promote_waitlist_locked(p_session_id uuid, p_locked_grants uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rules    public.studio_settings%rowtype;
  v_session  public.sessions%rowtype;
  v_entry    public.waitlist_entries%rowtype;
  v_grant    public.credit_grants%rowtype;
  v_booking  uuid;
  v_failed   boolean;
  v_promoted jsonb := '[]'::jsonb;
begin
  select * into v_rules from public.studio_settings where id = 1;
  select * into v_session from public.sessions where id = p_session_id;   -- locked by the caller
  if not found or not private.waitlist_promotion_open(v_session.starts_at, v_session.status) then
    return v_promoted;
  end if;

  while v_session.confirmed_count < v_session.capacity loop
    select * into v_entry from public.waitlist_entries w
     where w.session_id = v_session.id and w.status = 'waiting'
     order by w.created_at, w.id
     limit 1;
    exit when not found;

    if exists (select 1 from public.bookings b
                where b.session_id = v_session.id and b.user_id = v_entry.user_id and b.status = 'confirmed') then
      update public.waitlist_entries set status = 'skipped', skip_reason = 'already_booked', resolved_at = now()
       where id = v_entry.id;
      continue;
    end if;

    if not private.has_display_name((select p.display_name from public.profiles p where p.id = v_entry.user_id)) then
      update public.waitlist_entries set status = 'skipped', skip_reason = 'profile_incomplete', resolved_at = now()
       where id = v_entry.id;
      continue;
    end if;

    if v_rules.max_self_cancellations_24h is not null
       and (select count(*) from public.bookings b
             where b.user_id = v_entry.user_id and b.cancelled_by = v_entry.user_id
               and b.cancelled_at > now() - make_interval(hours => 24)) >= v_rules.max_self_cancellations_24h then
      update public.waitlist_entries set status = 'skipped', skip_reason = 'too_many_changes', resolved_at = now()
       where id = v_entry.id;
      continue;
    end if;

    select g.* into v_grant from public.credit_grants g
     where g.id = any(p_locked_grants)
       and g.user_id = v_entry.user_id
       and g.credits_remaining >= v_rules.credits_per_booking
       and g.valid_from <= now()
       and g.expires_at > v_session.starts_at
     order by g.expires_at, g.created_at, g.id
     limit 1;
    if not found then
      update public.waitlist_entries set status = 'skipped', skip_reason = 'no_valid_credit', resolved_at = now()
       where id = v_entry.id;
      continue;
    end if;

    v_failed := false;
    begin   -- subtransaction: a failure here rolls back only this promotion
      insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited, source, created_by)
      values (v_session.id, v_entry.user_id, pg_catalog.gen_random_uuid(), v_grant.id, v_rules.credits_per_booking,
              'waitlist', v_entry.user_id)
      returning id into v_booking;
      update public.credit_grants set credits_remaining = credits_remaining - v_rules.credits_per_booking
       where id = v_grant.id;
      insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
      values (v_entry.user_id, v_grant.id, v_booking, 'booking_debit', -v_rules.credits_per_booking, null);
      update public.sessions set confirmed_count = confirmed_count + 1 where id = v_session.id;
      update public.waitlist_entries set status = 'promoted', promoted_booking_id = v_booking, resolved_at = now()
       where id = v_entry.id;
    exception when others then
      v_failed := true;
    end;
    -- Variables are not rolled back with the subtransaction: re-read the session either way.
    select * into v_session from public.sessions where id = p_session_id;
    if v_failed then
      update public.waitlist_entries set status = 'skipped', skip_reason = 'promotion_failed', resolved_at = now()
       where id = v_entry.id;
      continue;
    end if;
    v_promoted := v_promoted || jsonb_build_array(jsonb_build_object(
      'entry_id', v_entry.id, 'user_id', v_entry.user_id, 'booking_id', v_booking));
  end loop;
  return v_promoted;
end $$;

-- The entry as the student sees it (join/leave answers).
create function private.waitlist_entry_json(p_entry public.waitlist_entries) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('entry_id', p_entry.id, 'session_id', p_entry.session_id, 'status', p_entry.status,
    'position', private.waitlist_position(p_entry.id), 'booking_id', p_entry.promoted_booking_id)
$$;

revoke execute on function private.waitlist_promotion_open(timestamptz, text) from public, anon, authenticated;
revoke execute on function private.waitlist_position(uuid) from public, anon, authenticated;
revoke execute on function private.lock_for_promotion(uuid, timestamptz, uuid[], boolean) from public, anon, authenticated;
revoke execute on function private.promote_waitlist_locked(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function private.waitlist_entry_json(public.waitlist_entries) from public, anon, authenticated;

-- (c) Student RPCs ------------------------------------------------------------------------------------------------
-- join_waitlist. Check order: replay → forbidden (anonymized, 42501) → profile_incomplete → waitlist_disabled →
-- not_found → session_cancelled → session_started → booking_not_open → booking_closed → waitlist_closed (inside the
-- cancellation window) → already_booked → existing waiting entry (ok, replayed) → session_not_full →
-- waitlist_full (50 waiting) → too_many_waitlists (10 active entries of hers) → too_many_changes (self-cancellations
-- in 24 h ≥ max_self_cancellations_24h, or joins of this session in 24 h ≥ max_session_bookings_24h) → insert.
-- A join is not a booking: it never counts against the booking throttle and debits nothing.
create function public.join_waitlist(p_session_id uuid, p_request_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_rules   public.studio_settings%rowtype;
  v_profile public.profiles%rowtype;
  v_session public.sessions%rowtype;
  v_entry   public.waitlist_entries%rowtype;
  v_opens   timestamptz;
  v_count   int;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_session_id is null or p_request_key is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Fast replay (same key): the entry's CURRENT state.
  select * into v_entry from public.waitlist_entries where user_id = v_uid and request_key = p_request_key;
  if found then
    if v_entry.session_id <> p_session_id then
      raise exception 'idempotency key reused for a different session' using errcode = '22023';
    end if;
    return jsonb_build_object('ok', true, 'code', null, 'replayed', true) || private.waitlist_entry_json(v_entry);
  end if;

  -- LOCK 0: own profile (serializes with admin_anonymize_student).
  select * into v_profile from public.profiles where id = v_uid for share;
  if not found or v_profile.anonymized_at is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not private.has_display_name(v_profile.display_name) then return private.fail('profile_incomplete'); end if;

  select * into v_rules from public.studio_settings where id = 1;
  if not v_rules.waitlist_enabled then return private.fail('waitlist_disabled'); end if;

  -- LOCK 1: the session (serializes with bookings, cancellations and promotions of this session).
  select * into v_session from public.sessions s
   where s.id = p_session_id and s.is_published
     and exists (select 1 from public.class_types ct where ct.id = s.class_type_id and ct.is_published)
     for update;
  if not found then return private.fail('not_found'); end if;

  select * into v_entry from public.waitlist_entries where user_id = v_uid and request_key = p_request_key;
  if found then
    return jsonb_build_object('ok', true, 'code', null, 'replayed', true) || private.waitlist_entry_json(v_entry);
  end if;

  v_opens := v_session.starts_at - make_interval(hours => 24 * v_rules.booking_opens_days);
  if v_session.status = 'cancelled' then return private.fail('session_cancelled'); end if;
  if now() >= v_session.starts_at then return private.fail('session_started'); end if;
  if now() < v_opens then
    return private.fail('booking_not_open', jsonb_build_object('opens_at', v_opens));
  end if;
  if now() >= v_session.starts_at - make_interval(mins => v_rules.booking_closes_minutes) then
    return private.fail('booking_closed');
  end if;
  if not private.waitlist_promotion_open(v_session.starts_at, v_session.status) then
    return private.fail('waitlist_closed');
  end if;

  if exists (select 1 from public.bookings b
              where b.session_id = v_session.id and b.user_id = v_uid and b.status = 'confirmed') then
    return private.fail('already_booked');
  end if;
  select * into v_entry from public.waitlist_entries
   where session_id = v_session.id and user_id = v_uid and status = 'waiting';
  if found then
    return jsonb_build_object('ok', true, 'code', null, 'replayed', true) || private.waitlist_entry_json(v_entry);
  end if;
  if v_session.confirmed_count < v_session.capacity then return private.fail('session_not_full'); end if;

  -- Size caps: a session's queue and one student's open entries.
  if (select count(*) from public.waitlist_entries w where w.session_id = v_session.id and w.status = 'waiting') >= 50 then
    return private.fail('waitlist_full');
  end if;
  if (select count(*) from public.waitlist_entries w join public.sessions s on s.id = w.session_id
       where w.user_id = v_uid and w.status = 'waiting' and s.starts_at > now()) >= 10 then
    return private.fail('too_many_waitlists');
  end if;

  -- Churn guards (ADR-019): her self-cancellations, and joins of THIS session, in the last 24 h (rows, not keys).
  if v_rules.max_self_cancellations_24h is not null then
    select count(*)::int into v_count from public.bookings b
     where b.user_id = v_uid and b.cancelled_at > now() - make_interval(hours => 24) and b.cancelled_by = v_uid;
    if v_count >= v_rules.max_self_cancellations_24h then
      return private.fail('too_many_changes', jsonb_build_object('limit', 'cancellations'));
    end if;
  end if;
  if v_rules.max_session_bookings_24h is not null then
    select count(*)::int into v_count from public.waitlist_entries w
     where w.user_id = v_uid and w.session_id = v_session.id and w.created_at > now() - make_interval(hours => 24);
    if v_count >= v_rules.max_session_bookings_24h then
      return private.fail('too_many_changes', jsonb_build_object('limit', 'waitlist_joins'));
    end if;
  end if;

  insert into public.waitlist_entries (session_id, user_id, request_key)
  values (v_session.id, v_uid, p_request_key)
  returning * into v_entry;

  return jsonb_build_object('ok', true, 'code', null, 'replayed', false) || private.waitlist_entry_json(v_entry);
end $$;

-- leave_waitlist. State-idempotent: no waiting entry left → ok with replayed = true and the latest entry's
-- status (left / promoted / skipped / closed), so a student promoted meanwhile learns it. No entry at all → not_found.
create function public.leave_waitlist(p_session_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_entry public.waitlist_entries%rowtype;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_session_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not coalesce((select st.waitlist_enabled from public.studio_settings st where st.id = 1), false) then
    return private.fail('waitlist_disabled');
  end if;

  -- Nothing of hers on this session → not_found without taking any lock.
  if not exists (select 1 from public.waitlist_entries w where w.session_id = p_session_id and w.user_id = v_uid) then
    return private.fail('not_found');
  end if;
  perform 1 from public.sessions where id = p_session_id for update;                            -- LOCK 1

  select * into v_entry from public.waitlist_entries                                              -- LOCK 3
   where session_id = p_session_id and user_id = v_uid and status = 'waiting'
     for update;
  if found then
    update public.waitlist_entries set status = 'left', resolved_at = now() where id = v_entry.id
    returning * into v_entry;
    return jsonb_build_object('ok', true, 'code', null, 'replayed', false) || private.waitlist_entry_json(v_entry);
  end if;

  select * into v_entry from public.waitlist_entries
   where session_id = p_session_id and user_id = v_uid
   order by created_at desc, id desc
   limit 1;
  if not found then return private.fail('not_found'); end if;
  return jsonb_build_object('ok', true, 'code', null, 'replayed', true) || private.waitlist_entry_json(v_entry);
end $$;

-- my_waitlist_entries: the caller's own entries (newest first, at most 100) with the session they belong to
-- and, while waiting, her place in the queue. Definer so the place can be computed without exposing anyone
-- else's entry, and so a session she cannot read through RLS (e.g. cancelled) still has its date.
-- Waitlist off → no entries (`enabled: false`).
create function public.my_waitlist_entries()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_enabled boolean;
  v_rows    jsonb;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select st.waitlist_enabled into v_enabled from public.studio_settings st where st.id = 1;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', true, 'code', null, 'enabled', false, 'entries', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', e.id, 'session_id', e.session_id, 'status', e.status, 'skip_reason', e.skip_reason,
           'close_reason', e.close_reason, 'position', private.waitlist_position(e.id),
           'booking_id', e.promoted_booking_id, 'created_at', e.created_at, 'resolved_at', e.resolved_at,
           'session', jsonb_build_object('id', s.id, 'class_type_id', s.class_type_id, 'class_type_name', ct.name,
                                         'starts_at', s.starts_at, 'ends_at', s.ends_at, 'capacity', s.capacity,
                                         'modality', s.modality, 'status', s.status,
                                         'instructor_name', s.instructor_name))
           order by e.created_at desc, e.id desc), '[]'::jsonb)
    into v_rows
    from (select * from public.waitlist_entries w where w.user_id = v_uid
           order by w.created_at desc, w.id desc limit 100) e
    join public.sessions s on s.id = e.session_id
    join public.class_types ct on ct.id = s.class_type_id;

  return jsonb_build_object('ok', true, 'code', null, 'enabled', true, 'entries', v_rows);
end $$;

-- (d) book_session ------------------------------------------------------------------------------------------------
-- Identical to migration 12 except: profile_incomplete right after LOCK 0; the per-session throttle ignores
-- bookings that came from the waitlist (the student did not make them); LOCK 3 on her own waiting entry of this
-- session before the grants, closed (`booked`) once the booking is written.
-- Check order: replay → forbidden → profile_incomplete → not_found → session_cancelled → session_started →
-- booking_not_open → booking_closed → already_booked → session_full → too_many_changes → no_valid_credit.
create or replace function public.book_session(p_session_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_rules   public.studio_settings%rowtype;
  v_session public.sessions%rowtype;
  v_prior   public.bookings%rowtype;
  v_grant   public.credit_grants%rowtype;
  v_profile public.profiles%rowtype;
  v_booking uuid;
  v_opens   timestamptz;
  v_count   int;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_session_id is null or p_idempotency_key is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- (a) Fast replay, no locks. A replay writes nothing, so it is never throttled.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  -- LOCK 0: the caller's own profile (FOR SHARE). Serializes with admin_anonymize_student only.
  select * into v_profile from public.profiles p where p.id = v_uid for share;
  if not found or v_profile.anonymized_at is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Owner decision 2026-10-14: a display name is required before the first booking.
  if not private.has_display_name(v_profile.display_name) then return private.fail('profile_incomplete'); end if;

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

  -- (e) Churn throttle (ADR-019). Rows, not keys. Only the student's own actions count: staff bookings,
  --     staff cancellations and waitlist promotions do not.
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
       and b.created_at > now() - make_interval(hours => 24) and b.created_by = v_uid and b.source <> 'waitlist';
    if v_count >= v_rules.max_session_bookings_24h then
      return private.fail('too_many_changes', jsonb_build_object('limit', 'session_rebookings'));
    end if;
  end if;

  -- LOCK 3: her own waiting entry of this session (closed below once the booking exists).
  perform 1 from public.waitlist_entries w
   where w.session_id = v_session.id and w.user_id = v_uid and w.status = 'waiting'
     for update;

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

  -- (g) Writes: booking, grant, ledger, counter, own waiting entry — one transaction, all or nothing.
  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited, source, created_by)
  values (v_session.id, v_uid, p_idempotency_key, v_grant.id, v_rules.credits_per_booking, 'student', v_uid)
  returning id into v_booking;

  update public.credit_grants set credits_remaining = credits_remaining - v_rules.credits_per_booking
   where id = v_grant.id;
  insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
  values (v_uid, v_grant.id, v_booking, 'booking_debit', -v_rules.credits_per_booking, v_uid);
  update public.sessions set confirmed_count = confirmed_count + 1 where id = v_session.id;
  update public.waitlist_entries set status = 'closed', close_reason = 'booked', resolved_at = now()
   where session_id = v_session.id and user_id = v_uid and status = 'waiting';

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

-- (e) admin_book_for -----------------------------------------------------------------------------------------------
-- Identical to migration 12 except LOCK 3 + close of the student's own waiting entry of this session (`booked`).
-- No display-name requirement (staff path).
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

  perform 1 from public.waitlist_entries w                                                     -- LOCK 3
   where w.session_id = v_session.id and w.user_id = p_user_id and w.status = 'waiting'
     for update;

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
  update public.waitlist_entries set status = 'closed', close_reason = 'booked', resolved_at = now()
   where session_id = v_session.id and user_id = p_user_id and status = 'waiting';

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

-- (f) cancel_booking --------------------------------------------------------------------------------------------------
-- Identical to migration 6 except the Phase 4 hooks: LOCK 3 waiting entries + LOCK 4 (refund grant + waiting
-- students' usable grants, one statement) through private.lock_for_promotion, then FIFO promotion.
create or replace function public.cancel_booking(p_booking_id uuid, p_idempotency_key uuid default null,
                                                 p_accept_late boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid        uuid := (select auth.uid());
  v_rules      public.studio_settings%rowtype;
  v_session    public.sessions%rowtype;
  v_booking    public.bookings%rowtype;
  v_session_id uuid;
  v_owner      uuid;
  v_late       boolean;
  v_refunded   boolean := false;
  v_promote    boolean;
  v_locked     uuid[];
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_booking_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;

  -- Unlocked read only to learn the session (lock order: session before booking).
  select session_id, user_id into v_session_id, v_owner from public.bookings where id = p_booking_id;
  if not found then return private.fail('not_found'); end if;
  if v_owner <> v_uid then return private.fail('not_owner'); end if;

  select * into v_rules   from public.studio_settings where id = 1;
  select * into v_session from public.sessions where id = v_session_id for update;   -- LOCK 1
  select * into v_booking from public.bookings where id = p_booking_id for update;   -- LOCK 2

  if v_booking.status <> 'confirmed' then                                            -- state replay
    return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id,
      'status', v_booking.status, 'refunded', v_booking.refunded, 'replayed', true);
  end if;
  if v_session.status = 'cancelled'
     or now() >= v_session.starts_at
     or not v_rules.student_cancellation_enabled
     or v_booking.attendance <> 'unknown' then
    return private.fail('cancellation_not_allowed');
  end if;

  v_late := now() > v_session.starts_at - make_interval(hours => v_rules.cancellation_window_hours);
  if v_late and v_rules.late_cancel_policy = 'deny' then
    return private.fail('cancellation_too_late', '{"refund": false, "confirm_required": false}'::jsonb);
  end if;
  if v_late and not coalesce(p_accept_late, false) then
    return private.fail('cancellation_too_late', '{"refund": false, "confirm_required": true}'::jsonb);
  end if;

  update public.bookings
     set status = case when v_late then 'late_cancelled' else 'cancelled' end,
         cancelled_at = now(), cancelled_by = v_uid, cancel_request_key = p_idempotency_key
   where id = v_booking.id;
  update public.sessions set confirmed_count = confirmed_count - 1 where id = v_session.id;

  -- LOCK 3 + LOCK 4 (one ordered grant statement): refund grant + waiting students' usable grants.
  v_promote := private.waitlist_promotion_open(v_session.starts_at, v_session.status);
  v_locked := private.lock_for_promotion(v_session.id, v_session.starts_at,
    case when not v_late and v_booking.credit_grant_id is not null then array[v_booking.credit_grant_id]
         else '{}'::uuid[] end,
    v_promote);

  if not v_late and v_booking.credit_grant_id is not null then
    update public.credit_grants set credits_remaining = credits_remaining + v_booking.credits_debited
     where id = v_booking.credit_grant_id and expires_at > now();
    if found then
      insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
      values (v_uid, v_booking.credit_grant_id, v_booking.id, 'cancel_refund', v_booking.credits_debited, v_uid);
      update public.bookings set refunded = true where id = v_booking.id;
      v_refunded := true;
    end if;
  end if;

  -- The freed spot goes to the first eligible waiting student (owner rule), in this same transaction.
  if v_promote then perform private.promote_waitlist_locked(v_session.id, v_locked); end if;

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id,
    'status', case when v_late then 'late_cancelled' else 'cancelled' end,
    'refunded', v_refunded, 'replayed', false);
end $$;

-- (g) admin_cancel_for ----------------------------------------------------------------------------------------------
-- Identical to migration 10 except LOCK 3/4 through private.lock_for_promotion and the FIFO promotion;
-- answers `promoted` (number of students moved from the waitlist into the freed spot).
create or replace function public.admin_cancel_for(p_booking_id uuid, p_refund boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff      uuid := (select auth.uid());
  v_session    public.sessions%rowtype;
  v_session_id uuid;
  v_booking    public.bookings%rowtype;
  v_refunded   boolean := false;
  v_skipped    boolean := false;
  v_refund     boolean := coalesce(p_refund, true);
  v_promote    boolean;
  v_locked     uuid[];
  v_promoted   jsonb := '[]'::jsonb;
begin
  perform private.assert_staff();
  if p_booking_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;

  -- Unlocked read only to learn the session (lock order: session before booking).
  select session_id into v_session_id from public.bookings where id = p_booking_id;
  if not found then return private.fail('not_found'); end if;

  select * into v_session from public.sessions where id = v_session_id for update;            -- LOCK 1
  select * into v_booking from public.bookings where id = p_booking_id for update;            -- LOCK 2

  if v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id, 'user_id', v_booking.user_id,
      'status', v_booking.status, 'refunded', v_booking.refunded, 'refund_skipped', false, 'replayed', true,
      'promoted', 0);
  end if;
  if v_booking.attendance <> 'unknown' then return private.fail('cancellation_not_allowed'); end if;

  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = v_staff
   where id = v_booking.id;
  update public.sessions set confirmed_count = confirmed_count - 1 where id = v_session_id;

  v_promote := private.waitlist_promotion_open(v_session.starts_at, v_session.status);
  v_locked := private.lock_for_promotion(v_session_id, v_session.starts_at,                  -- LOCK 3 + 4
    case when v_refund and v_booking.credit_grant_id is not null then array[v_booking.credit_grant_id]
         else '{}'::uuid[] end,
    v_promote);

  if v_refund and v_booking.credit_grant_id is not null then
    update public.credit_grants set credits_remaining = credits_remaining + v_booking.credits_debited
     where id = v_booking.credit_grant_id and expires_at > now();
    if found then
      insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
      values (v_booking.user_id, v_booking.credit_grant_id, v_booking.id, 'cancel_refund', v_booking.credits_debited, v_staff);
      update public.bookings set refunded = true where id = v_booking.id;
      v_refunded := true;
    else
      v_skipped := true;
    end if;
  end if;

  if v_promote then v_promoted := private.promote_waitlist_locked(v_session_id, v_locked); end if;

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id, 'user_id', v_booking.user_id,
    'status', 'cancelled', 'refunded', v_refunded, 'refund_skipped', v_skipped, 'replayed', false,
    'promoted', jsonb_array_length(v_promoted));
end $$;

-- (h) admin_update_session ----------------------------------------------------------------------------------------------
-- Identical to migration 9 except: a capacity INCREASE promotes from the waitlist (same rule, same transaction);
-- confirmed_count in the answer is the value after the promotions, plus `promoted`.
create or replace function public.admin_update_session(p_session_id uuid, p_capacity int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session  public.sessions%rowtype;
  v_promoted jsonb := '[]'::jsonb;
  v_locked   uuid[];
  v_count    int;
begin
  perform private.assert_staff();
  if p_session_id is null or p_capacity is null or p_capacity not between 1 and 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_session from public.sessions where id = p_session_id for update;            -- LOCK 1
  if not found then return private.fail('not_found'); end if;
  if v_session.status = 'cancelled' then return private.fail('session_cancelled'); end if;
  if now() >= v_session.starts_at then return private.fail('session_started'); end if;
  if p_capacity < v_session.confirmed_count then
    return private.fail('capacity_below_bookings', jsonb_build_object('confirmed_count', v_session.confirmed_count));
  end if;

  if p_capacity <> v_session.capacity then
    update public.sessions set capacity = p_capacity where id = v_session.id;
    if p_capacity > v_session.capacity and private.waitlist_promotion_open(v_session.starts_at, v_session.status) then
      v_locked := private.lock_for_promotion(v_session.id, v_session.starts_at, '{}'::uuid[], true);   -- LOCK 3 + 4
      v_promoted := private.promote_waitlist_locked(v_session.id, v_locked);
    end if;
  end if;
  select s.confirmed_count into v_count from public.sessions s where s.id = v_session.id;

  return jsonb_build_object('ok', true, 'code', null, 'session_id', v_session.id, 'capacity', p_capacity,
    'confirmed_count', v_count, 'changed', p_capacity <> v_session.capacity,
    'promoted', jsonb_array_length(v_promoted));
end $$;

-- (i) admin_cancel_session --------------------------------------------------------------------------------------------
-- Identical to migration 10 except LOCK 3: waiting entries (created_at, id) between the bookings and the grants;
-- they are closed (`closed`, session_cancelled). Answers `waitlist_closed` (entries closed).
create or replace function public.admin_cancel_session(p_session_id uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff     uuid := (select auth.uid());
  v_session   public.sessions%rowtype;
  v_booking   public.bookings%rowtype;
  v_note      text := pg_catalog.left(nullif(pg_catalog.btrim(p_reason), ''), 200);
  v_cancelled int := 0;
  v_refunded  int := 0;
  v_closed    int := 0;
  v_skipped   uuid[] := '{}'::uuid[];
begin
  perform private.assert_staff();
  if p_session_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;

  select * into v_session from public.sessions where id = p_session_id for update;            -- LOCK 1
  if not found then return private.fail('not_found'); end if;
  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'code', null, 'session_id', v_session.id, 'replayed', true,
      'cancelled_bookings', 0, 'refunded', 0, 'refunds_skipped', '[]'::jsonb, 'waitlist_closed', 0);
  end if;

  perform 1 from public.bookings b                                                             -- LOCK 2
   where b.session_id = v_session.id and b.status = 'confirmed' order by b.id for update;
  perform 1 from public.waitlist_entries w                                                     -- LOCK 3
   where w.session_id = v_session.id and w.status = 'waiting' order by w.created_at, w.id for update;
  perform 1 from public.credit_grants g                                                        -- LOCK 4
   where g.id in (select b.credit_grant_id from public.bookings b
                   where b.session_id = v_session.id and b.status = 'confirmed')
   order by g.id for update;

  for v_booking in
    select * from public.bookings b where b.session_id = v_session.id and b.status = 'confirmed' order by b.id
  loop
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = v_staff
     where id = v_booking.id;
    v_cancelled := v_cancelled + 1;

    if v_booking.credit_grant_id is not null then
      update public.credit_grants set credits_remaining = credits_remaining + v_booking.credits_debited
       where id = v_booking.credit_grant_id and expires_at > now();
      if found then
        insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id, note)
        values (v_booking.user_id, v_booking.credit_grant_id, v_booking.id, 'cancel_refund',
                v_booking.credits_debited, v_staff, v_note);
        update public.bookings set refunded = true where id = v_booking.id;
        v_refunded := v_refunded + 1;
      else
        v_skipped := v_skipped || v_booking.id;
      end if;
    end if;
  end loop;

  update public.waitlist_entries set status = 'closed', close_reason = 'session_cancelled', resolved_at = now()
   where session_id = v_session.id and status = 'waiting';
  get diagnostics v_closed = row_count;

  update public.sessions set status = 'cancelled', cancelled_at = now(), confirmed_count = 0
   where id = v_session.id;

  return jsonb_build_object('ok', true, 'code', null, 'session_id', v_session.id, 'replayed', false,
    'cancelled_bookings', v_cancelled, 'refunded', v_refunded, 'refunds_skipped', to_jsonb(v_skipped),
    'waitlist_closed', v_closed);
end $$;

-- (j) admin_anonymize_student -----------------------------------------------------------------------------------------
-- Identical to migration 12 except LOCK 3: her waiting entries (created_at, id) are locked BEFORE the
-- has_upcoming_bookings check and closed (`closed`, account_erased). A promotion of her in flight either commits
-- first (the check, a fresh statement, sees the new booking → has_upcoming_bookings) or waits on these locks and
-- then finds her entries closed. Answers `waitlist_closed`.
create or replace function public.admin_anonymize_student(p_user_id uuid, p_confirm_email text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_confirm  text := pg_catalog.lower(pg_catalog.btrim(p_confirm_email));
  v_profile  public.profiles%rowtype;
  v_upcoming int;
  v_grants   int;
  v_ledger   int;
  v_closed   int;
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
  if v_profile.email is not null then
    if pg_catalog.lower(v_profile.email) <> v_confirm then return private.fail('email_mismatch'); end if;
  elsif v_confirm <> v_profile.id::text
        and pg_catalog.btrim(p_confirm_email) is distinct from pg_catalog.btrim(v_profile.display_name) then
    return private.fail('email_mismatch');
  end if;

  perform 1 from public.waitlist_entries w                                                     -- LOCK 3
   where w.user_id = v_profile.id and w.status = 'waiting' order by w.created_at, w.id for update;

  -- Under LOCK 0 no booking of hers can start; under LOCK 3 no promotion of her can be in flight.
  select count(*)::int into v_upcoming
    from public.bookings b join public.sessions s on s.id = b.session_id
   where b.user_id = v_profile.id and b.status = 'confirmed' and s.status = 'scheduled' and s.ends_at > now();
  if v_upcoming > 0 then
    return private.fail('has_upcoming_bookings', jsonb_build_object('upcoming', v_upcoming));
  end if;

  update public.waitlist_entries set status = 'closed', close_reason = 'account_erased', resolved_at = now()
   where user_id = v_profile.id and status = 'waiting';
  get diagnostics v_closed = row_count;

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
    'replayed', false, 'grant_notes_erased', v_grants, 'ledger_notes_erased', v_ledger, 'waitlist_closed', v_closed);
end $$;

-- Privileges: Postgres grants EXECUTE to PUBLIC by default; revoking only anon is not enough.
-- CREATE OR REPLACE keeps existing grants; restated so this file is self-describing.
revoke execute on function public.join_waitlist(uuid, uuid) from public, anon;
grant  execute on function public.join_waitlist(uuid, uuid) to authenticated;
revoke execute on function public.leave_waitlist(uuid) from public, anon;
grant  execute on function public.leave_waitlist(uuid) to authenticated;
revoke execute on function public.my_waitlist_entries() from public, anon;
grant  execute on function public.my_waitlist_entries() to authenticated;
revoke execute on function public.book_session(uuid, uuid) from public, anon;
grant  execute on function public.book_session(uuid, uuid) to authenticated;
revoke execute on function public.admin_book_for(uuid, uuid, uuid) from public, anon;
grant  execute on function public.admin_book_for(uuid, uuid, uuid) to authenticated;
revoke execute on function public.cancel_booking(uuid, uuid, boolean) from public, anon;
grant  execute on function public.cancel_booking(uuid, uuid, boolean) to authenticated;
revoke execute on function public.admin_cancel_for(uuid, boolean) from public, anon;
grant  execute on function public.admin_cancel_for(uuid, boolean) to authenticated;
revoke execute on function public.admin_update_session(uuid, int) from public, anon;
grant  execute on function public.admin_update_session(uuid, int) to authenticated;
revoke execute on function public.admin_cancel_session(uuid, text) from public, anon;
grant  execute on function public.admin_cancel_session(uuid, text) to authenticated;
revoke execute on function public.admin_anonymize_student(uuid, text) from public, anon;
grant  execute on function public.admin_anonymize_student(uuid, text) to authenticated;

-- rollback (local only; production fixes forward):
--   update public.studio_settings set waitlist_enabled = false where id = 1;   -- flag off first: RPCs refuse, no promotion
--   re-run public.book_session / public.admin_book_for / public.admin_anonymize_student from migration 12,
--   public.cancel_booking from migration 6, public.admin_cancel_for / public.admin_cancel_session from migration 10,
--   public.admin_update_session from migration 9;
--   drop function public.my_waitlist_entries(); drop function public.leave_waitlist(uuid);
--   drop function public.join_waitlist(uuid, uuid);
--   drop function private.waitlist_entry_json(public.waitlist_entries); drop function private.promote_waitlist_locked(uuid, uuid[]);
--   drop function private.lock_for_promotion(uuid, timestamptz, uuid[], boolean);
--   drop function private.waitlist_position(uuid); drop function private.waitlist_promotion_open(timestamptz, text);
--   alter table public.profiles drop constraint profiles_display_name_visible; drop function private.has_display_name(text);
--   drop table public.waitlist_entries;   -- destructive once entries exist (keep it if it has data)
