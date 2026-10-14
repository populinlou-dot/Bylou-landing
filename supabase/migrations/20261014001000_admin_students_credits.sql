-- Booking core · migration 10 · admin_students_credits (Phase 4.3: AD-08 … AD-10)
-- Forward-only: earlier files untouched.
--   (a) credit_ledger.request_key: idempotency key of an admin_adjust entry (one per staff member + key).
--       Adding a column is DDL, not an UPDATE: the append-only trigger and the grants are unchanged.
--   (b) Staff read RPCs admin_search_students / admin_student_summary: the balance they return is the
--       server definition (private.usable_balance), so the panel can never drift from what book_session
--       accepts. Grants, bookings and the ledger themselves stay plain RLS reads (ADR-015).
--   (c) admin_adjust_credits: ± credits on ONE pack with a mandatory reason → `admin_adjust` ledger entry.
--   (d) admin_book_for / admin_cancel_for: book or cancel on a student's behalf. Bypass the booking and
--       cancellation windows (AD-10), never capacity; the acting staff member is recorded in
--       bookings.created_by / cancelled_by and credit_ledger.actor_id (columns from migration 4).
--   (f) admin_cancel_session: same body as migration 9, except the refund ledger note stores only the
--       staff reason (or null). It used to be prefixed with English text ("session cancelled: …") that
--       students and staff read; the UI labels the entry from its kind (cancel_refund).
-- Lock order (DATA_MODEL §5.1) is the one book_session / cancel_booking use:
--   session → booking → grants (one statement, ordered by id). admin_adjust_credits locks one grant only.

-- (a) credit_ledger.request_key ------------------------------------------------------------------------
alter table public.credit_ledger add column request_key uuid;
alter table public.credit_ledger
  add constraint ledger_request_key_adjust_only check (request_key is null or reason = 'admin_adjust');
create unique index ledger_adjust_request_key on public.credit_ledger (actor_id, request_key)
  where request_key is not null;

-- (b) Student summaries -----------------------------------------------------------------------------------
-- One student as the panel lists her. Next booking = earliest confirmed booking of a scheduled session
-- that has not ended yet. Internal helper: no EXECUTE for anyone; callers assert staff first.
create function private.student_summary(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'display_name', p.display_name,
    'email', p.email,
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

-- Search by display name or confirmed email (case-insensitive substring; LIKE wildcards are escaped).
-- Students only, alphabetical (name, else email), at most p_limit rows. A blank query lists everyone.
create function public.admin_search_students(p_query text default null, p_limit int default 50)
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
           where p.role = 'student'
             and (v_query is null or p.display_name ilike v_pattern or p.email ilike v_pattern)
           order by 2, 3, p.id
           limit p_limit) m;

  return jsonb_build_object('ok', true, 'code', null, 'students', v_rows);
end $$;

create function public.admin_student_summary(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_staff();
  if p_user_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'student') then
    return private.fail('not_found');
  end if;
  return jsonb_build_object('ok', true, 'code', null, 'student', private.student_summary(p_user_id));
end $$;

-- (c) admin_adjust_credits -------------------------------------------------------------------------------
-- Adjusts ONE pack: 0 ≤ remaining + delta ≤ total − credits held by its confirmed bookings, so no pack and
-- therefore no usable balance can go negative, and a later refund of those bookings (cancel_booking,
-- admin_cancel_for, admin_cancel_session) can never push remaining above total (grants_remaining_bounds).
-- More credits than that is a new pack (grant_credits), not an adjustment. Expired packs are not adjustable (worthless; the audit stays explained by the ledger).
-- The reason is stored as the ledger note, which the student can read (her own ledger, RLS).
-- Replay on (staff, request key): same grant + delta → original entry; anything else → 22023.
create function public.admin_adjust_credits(p_grant_id uuid, p_delta int, p_reason text, p_request_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff  uuid := (select auth.uid());
  v_reason text := pg_catalog.btrim(p_reason);
  v_prior  public.credit_ledger%rowtype;
  v_grant  public.credit_grants%rowtype;
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

  -- LOCK 4 only: one grant, one statement. FOR UPDATE returns the latest committed version, so a
  -- concurrent book_session debit of this grant is seen before the bounds are checked.
  select * into v_grant from public.credit_grants where id = p_grant_id for update;
  if not found then return private.fail('not_found'); end if;
  if v_grant.expires_at <= now() then return private.fail('grant_expired'); end if;
  if v_grant.credits_remaining + p_delta < 0 then
    return private.fail('insufficient_balance', jsonb_build_object('credits_remaining', v_grant.credits_remaining));
  end if;
  -- Credits still out on confirmed bookings come back on a refund: reserve room for them. Read under the
  -- grant lock: a debit commits while holding it; a refund in flight (booking already cancelled, refund
  -- waiting on this lock) is still seen as confirmed here, which only lowers the cap (safe side).
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

-- (d) admin_book_for ------------------------------------------------------------------------------------
-- book_session for a student, by staff. Differences: the booking window is NOT checked (override), the
-- session may be unpublished, the booking is `source = 'staff'`, `created_by` and the debit's actor_id are
-- the staff member. Same as book_session: one credit from the earliest-expiring pack still valid at the
-- session start, no booking once the session started, capacity is never exceeded (session row lock).
-- Replay: same (student, request key) → original booking; key reused for another session → 22023.
create function public.admin_book_for(p_user_id uuid, p_session_id uuid, p_request_key uuid)
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

  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'student') then
    return private.fail('not_found');
  end if;
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
    -- Backstop only (the session lock serializes same-session calls).
    select * into v_prior from public.bookings where user_id = p_user_id and idempotency_key = p_request_key;
    if found then return private.booking_replay(v_prior, p_session_id); end if;
    return private.fail('already_booked');
end $$;

-- (e) admin_cancel_for ----------------------------------------------------------------------------------
-- cancel_booking for a student, by staff: any time, no window (AD-10). Refunds by default (p_refund) into
-- the original pack while it is still valid now; an expired pack is reported as refund_skipped (grant by
-- hand). A booking whose attendance was already marked is not cancellable (unmark it first).
-- Replay is state-based, like cancel_booking: a booking leaves 'confirmed' once.
create function public.admin_cancel_for(p_booking_id uuid, p_refund boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff      uuid := (select auth.uid());
  v_session_id uuid;
  v_booking    public.bookings%rowtype;
  v_refunded   boolean := false;
  v_skipped    boolean := false;
begin
  perform private.assert_staff();
  if p_booking_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;

  -- Unlocked read only to learn the session (lock order: session before booking).
  select session_id into v_session_id from public.bookings where id = p_booking_id;
  if not found then return private.fail('not_found'); end if;

  perform 1 from public.sessions where id = v_session_id for update;                           -- LOCK 1
  select * into v_booking from public.bookings where id = p_booking_id for update;            -- LOCK 2

  if v_booking.status <> 'confirmed' then
    return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id, 'user_id', v_booking.user_id,
      'status', v_booking.status, 'refunded', v_booking.refunded, 'refund_skipped', false, 'replayed', true);
  end if;
  if v_booking.attendance <> 'unknown' then return private.fail('cancellation_not_allowed'); end if;

  update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = v_staff
   where id = v_booking.id;
  update public.sessions set confirmed_count = confirmed_count - 1 where id = v_session_id;

  if coalesce(p_refund, true) and v_booking.credit_grant_id is not null then
    perform 1 from public.credit_grants g where g.id = v_booking.credit_grant_id order by g.id for update;  -- LOCK 4
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

  -- Phase 4.4: perform private.promote_waitlist_locked(v_session_id);

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id, 'user_id', v_booking.user_id,
    'status', 'cancelled', 'refunded', v_refunded, 'refund_skipped', v_skipped, 'replayed', false);
end $$;

-- (f) admin_cancel_session ------------------------------------------------------------------------------
-- Identical to migration 9 except v_note: only the staff reason (trimmed, ≤ 200 chars) or null.
create or replace function public.admin_cancel_session(p_session_id uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff     uuid := (select auth.uid());
  v_session   public.sessions%rowtype;
  v_booking   public.bookings%rowtype;
  v_note      text := pg_catalog.left(nullif(pg_catalog.btrim(p_reason), ''), 200);
  v_cancelled int := 0;
  v_refunded  int := 0;
  v_skipped   uuid[] := '{}'::uuid[];
begin
  perform private.assert_staff();
  if p_session_id is null then raise exception 'invalid_input' using errcode = '22023'; end if;

  select * into v_session from public.sessions where id = p_session_id for update;            -- LOCK 1
  if not found then return private.fail('not_found'); end if;
  if v_session.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'code', null, 'session_id', v_session.id, 'replayed', true,
      'cancelled_bookings', 0, 'refunded', 0, 'refunds_skipped', '[]'::jsonb);
  end if;

  perform 1 from public.bookings b                                                             -- LOCK 2
   where b.session_id = v_session.id and b.status = 'confirmed' order by b.id for update;
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

  update public.sessions set status = 'cancelled', cancelled_at = now(), confirmed_count = 0
   where id = v_session.id;

  return jsonb_build_object('ok', true, 'code', null, 'session_id', v_session.id, 'replayed', false,
    'cancelled_bookings', v_cancelled, 'refunded', v_refunded, 'refunds_skipped', to_jsonb(v_skipped));
end $$;

-- Privileges: Postgres grants EXECUTE to PUBLIC by default; revoking only anon is not enough.
revoke execute on function private.student_summary(uuid) from public, anon, authenticated;
revoke execute on function public.admin_search_students(text, int) from public, anon;
grant  execute on function public.admin_search_students(text, int) to authenticated;
revoke execute on function public.admin_student_summary(uuid) from public, anon;
grant  execute on function public.admin_student_summary(uuid) to authenticated;
revoke execute on function public.admin_adjust_credits(uuid, int, text, uuid) from public, anon;
grant  execute on function public.admin_adjust_credits(uuid, int, text, uuid) to authenticated;
revoke execute on function public.admin_book_for(uuid, uuid, uuid) from public, anon;
grant  execute on function public.admin_book_for(uuid, uuid, uuid) to authenticated;
revoke execute on function public.admin_cancel_for(uuid, boolean) from public, anon;
grant  execute on function public.admin_cancel_for(uuid, boolean) to authenticated;
-- CREATE OR REPLACE keeps existing grants; restated so this file is self-describing.
revoke execute on function public.admin_cancel_session(uuid, text) from public, anon;
grant  execute on function public.admin_cancel_session(uuid, text) to authenticated;

-- rollback (local only; production fixes forward):
--   drop function public.admin_cancel_for(uuid, boolean); drop function public.admin_book_for(uuid, uuid, uuid);
--   drop function public.admin_adjust_credits(uuid, int, text, uuid);
--   drop function public.admin_student_summary(uuid); drop function public.admin_search_students(text, int);
--   drop function private.student_summary(uuid);
--   re-run the body of public.admin_cancel_session from migration 9;
--   drop index public.ledger_adjust_request_key;
--   alter table public.credit_ledger drop constraint ledger_request_key_adjust_only;
--   alter table public.credit_ledger drop column request_key;   -- destructive once adjustments exist
