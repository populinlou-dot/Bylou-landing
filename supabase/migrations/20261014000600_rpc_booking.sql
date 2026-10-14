-- Booking core · migration 6/7 · rpc_booking
-- DATA_MODEL §5 (conventions, lock order), §6.1, §6.2, §7, §8, §11 #6.
-- Semantics match booking/domain (booking-policy.ts, cancellation-policy.ts, credits.ts):
--   booking window: opens_at = S - opens_days*24h (inclusive), closes_at = S - closes_minutes (exclusive);
--   refund deadline D = S - window_hours (inclusive: now <= D refunds);
--   a grant is usable at instant t iff expires_at > t (invalid AT expires_at);
--   grant choice: earliest expires_at, then earliest created_at (= domain grantedAt), then id.
-- Durations use hours/minutes (absolute), never calendar days, so DST cannot shift them (§9).

-- Available credits right now: Σ remaining over grants with valid_from <= now() < expires_at.
create function private.usable_balance(p_user_id uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(g.credits_remaining), 0)::int
    from public.credit_grants g
   where g.user_id = p_user_id and g.valid_from <= now() and g.expires_at > now()
$$;

-- Same key + same session → original result with the booking's CURRENT status.
-- Same key + other session → client bug → invalid_input (22023).
create function private.booking_replay(p_prior public.bookings, p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_prior.session_id <> p_session_id then
    raise exception 'idempotency key reused for a different session' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'code', null, 'booking_id', p_prior.id,
    'session_id', p_prior.session_id, 'status', p_prior.status, 'replayed', true,
    'credits_debited', p_prior.credits_debited,
    'remaining_credits', private.usable_balance(p_prior.user_id));
end $$;

-- book_session ---------------------------------------------------------------
-- Check order: replay → not_found → session_cancelled → session_started → booking_not_open
--              → booking_closed → already_booked → session_full → no_valid_credit.
create function public.book_session(p_session_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_rules   public.studio_settings%rowtype;
  v_session public.sessions%rowtype;
  v_prior   public.bookings%rowtype;
  v_grant   public.credit_grants%rowtype;
  v_booking uuid;
  v_opens   timestamptz;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_session_id is null or p_idempotency_key is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- (a) Fast replay, no locks.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  select * into v_rules from public.studio_settings where id = 1;

  -- (b) LOCK 1: the session row. Serializes every booker (and canceller) of this session.
  select * into v_session from public.sessions where id = p_session_id and is_published for update;
  if not found then return private.fail('not_found'); end if;

  -- (c) Replay re-check: a concurrent call with the same key may have committed while we waited.
  --     Volatile plpgsql + READ COMMITTED → this statement takes a fresh snapshot.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  -- (d) Rules. v_session is the latest committed version (FOR UPDATE returns the updated row).
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

  -- (e) LOCK 4: every usable grant in ONE statement ordered by id (global lock order, §5.1),
  --     then pick earliest-expiring. The locking subquery is not flattened, so all candidates are
  --     locked and the WHERE is re-evaluated against each row's latest version.
  select * into v_grant from (
    select g.* from public.credit_grants g
     where g.user_id = v_uid
       and g.credits_remaining >= v_rules.credits_per_booking
       and g.valid_from <= now()
       and g.expires_at > v_session.starts_at          -- must still be valid when the class happens
     order by g.id
     for update
  ) usable
  order by usable.expires_at, usable.created_at, usable.id
  limit 1;
  if not found then return private.fail('no_valid_credit'); end if;

  -- (f) Writes: booking, grant, ledger, counter — one transaction, all or nothing.
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
    -- Backstop only (the session lock makes this unreachable for same-session races).
    -- The block's writes are rolled back; resolve to a replay or already_booked.
    select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return private.booking_replay(v_prior, p_session_id); end if;
    return private.fail('already_booked');
end $$;

-- cancel_booking -------------------------------------------------------------
-- Replay is state-based: a booking leaves 'confirmed' once; ledger_one_refund_per_booking backstops.
-- Inside the window (D < now < S):
--   'deny' (Bylou)          → cancellation_too_late, confirm_required false, no writes (p_accept_late ignored)
--   'allow_without_refund'  → cancellation_too_late, confirm_required true until p_accept_late → late_cancelled
create function public.cancel_booking(p_booking_id uuid, p_idempotency_key uuid default null,
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

  -- Phase 4: LOCK 3 waitlist entries (created_at, id) here, before grants.

  -- LOCK 4 (one ordered statement): the refund grant (+ Phase 4: waiting users' grants).
  if not v_late and v_booking.credit_grant_id is not null then
    perform 1 from public.credit_grants g where g.id = v_booking.credit_grant_id order by g.id for update;

    update public.credit_grants set credits_remaining = credits_remaining + v_booking.credits_debited
     where id = v_booking.credit_grant_id and expires_at > now();
    if found then
      insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
      values (v_uid, v_booking.credit_grant_id, v_booking.id, 'cancel_refund', v_booking.credits_debited, v_uid);
      update public.bookings set refunded = true where id = v_booking.id;
      v_refunded := true;
    end if;
  end if;

  -- Phase 4: perform private.promote_waitlist_locked(v_session.id);

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id,
    'status', case when v_late then 'late_cancelled' else 'cancelled' end,
    'refunded', v_refunded, 'replayed', false);
end $$;

-- Privileges: Postgres grants EXECUTE to PUBLIC by default; revoking only anon is not enough.
revoke execute on function private.usable_balance(uuid) from public, anon, authenticated;
revoke execute on function private.booking_replay(public.bookings, uuid) from public, anon, authenticated;
revoke execute on function public.book_session(uuid, uuid) from public, anon;
grant  execute on function public.book_session(uuid, uuid) to authenticated;
revoke execute on function public.cancel_booking(uuid, uuid, boolean) from public, anon;
grant  execute on function public.cancel_booking(uuid, uuid, boolean) to authenticated;

-- rollback (stateless, local only):
--   drop function public.cancel_booking(uuid, uuid, boolean); drop function public.book_session(uuid, uuid);
--   drop function private.booking_replay(public.bookings, uuid); drop function private.usable_balance(uuid);
