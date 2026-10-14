-- Booking core · migration 7/7 · rpc_admin
-- DATA_MODEL §6.3–6.6, §11 #7. Phase 3 subset: create_session, grant_credits, mark_attendance,
-- admin_cancel_session. Deferred (Phase 3.x/4): admin_update_session, admin_update_settings,
-- admin_upsert_class_type, admin_adjust_credits.
-- Every admin RPC starts with private.assert_staff() (42501 for anon / non-staff).

-- create_session --------------------------------------------------------------
-- Times are built in studio LOCAL wall time, then converted (keeps 18:00 local across DST).
-- Replay: any session with series_id = p_request_key → same ids, replayed: true.
create function public.create_session(
  p_request_key      uuid,
  p_class_type_id    uuid,
  p_local_date       date,
  p_local_start      time,
  p_duration_minutes int     default null,
  p_capacity         int     default null,
  p_modality         text    default null,
  p_instructor_name  text    default null,
  p_location_label   text    default null,
  p_meeting_url      text    default null,
  p_address          text    default null,
  p_repeat_weeks     int     default 1,
  p_is_published     boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rules    public.studio_settings%rowtype;
  v_type     public.class_types%rowtype;
  v_ids      uuid[];
  v_duration int;
  v_capacity int;
  v_modality text;
  v_starts   timestamptz;
  v_id       uuid;
begin
  perform private.assert_staff();
  if p_request_key is null or p_class_type_id is null or p_local_date is null or p_local_start is null
     or p_repeat_weeks is null or p_repeat_weeks not between 1 and 12 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Serialize calls sharing a request key (double click), then replay.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create_session:' || p_request_key::text, 0));
  select array_agg(s.id order by s.starts_at) into v_ids from public.sessions s where s.series_id = p_request_key;
  if v_ids is not null then
    return jsonb_build_object('ok', true, 'code', null, 'session_ids', to_jsonb(v_ids), 'replayed', true);
  end if;

  select * into v_type from public.class_types where id = p_class_type_id;
  if not found then return private.fail('not_found'); end if;
  select * into v_rules from public.studio_settings where id = 1;

  v_duration := coalesce(p_duration_minutes, v_type.default_duration_minutes);
  v_capacity := coalesce(p_capacity, v_type.default_capacity);
  v_modality := coalesce(p_modality, v_type.default_modality);
  if v_duration not between 10 and 480 or v_capacity not between 1 and 100
     or v_modality not in ('in_person', 'online')
     or (p_meeting_url is not null and p_meeting_url !~ '^https://') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  v_ids := '{}';
  for i in 0 .. p_repeat_weeks - 1 loop
    v_starts := ((p_local_date + 7 * i) + p_local_start) at time zone v_rules.timezone;
    if v_starts <= now() then
      raise exception 'invalid_input: session starts in the past' using errcode = '22023';
    end if;
    insert into public.sessions (class_type_id, series_id, starts_at, ends_at, capacity, modality,
                                 instructor_name, location_label, is_published)
    values (v_type.id, p_request_key, v_starts, v_starts + make_interval(mins => v_duration), v_capacity,
            v_modality, p_instructor_name, p_location_label, coalesce(p_is_published, true))
    returning id into v_id;
    if p_meeting_url is not null or p_address is not null then
      insert into public.session_private_details (session_id, meeting_url, address)
      values (v_id, p_meeting_url, p_address);
    end if;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('ok', true, 'code', null, 'session_ids', to_jsonb(v_ids), 'replayed', false);
end $$;

-- grant_credits ---------------------------------------------------------------
-- expires_at = local midnight after (grant local date + p_valid_days - 1): a "30-day pack" granted
-- Oct 13 is valid through Nov 11 inclusive (studio timezone).
create function public.grant_credits(p_user_id uuid, p_credits int, p_valid_days int,
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

  if not exists (select 1 from public.profiles where id = p_user_id) then
    return private.fail('not_found');
  end if;

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

-- mark_attendance -------------------------------------------------------------
-- Locks one booking without its session: it never waits on anything else (cannot close a cycle).
-- Window: starts_at - 15 min <= now() <= ends_at + 7 days. No credit effect in MVP.
create function public.mark_attendance(p_booking_id uuid, p_attendance text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff   uuid := (select auth.uid());
  v_booking public.bookings%rowtype;
  v_session public.sessions%rowtype;
begin
  perform private.assert_staff();
  if p_booking_id is null or p_attendance is null or p_attendance not in ('unknown', 'attended', 'no_show') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'confirmed' then return private.fail('not_found'); end if;

  select * into v_session from public.sessions where id = v_booking.session_id;
  if now() < v_session.starts_at - interval '15 minutes' or now() > v_session.ends_at + interval '7 days' then
    return private.fail('attendance_window_closed');
  end if;

  update public.bookings
     set attendance = p_attendance, attendance_marked_at = now(), attendance_marked_by = v_staff
   where id = v_booking.id;

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id, 'attendance', p_attendance);
end $$;

-- admin_cancel_session --------------------------------------------------------
-- Lock order: session → confirmed bookings (by id) → (Phase 4: waiting entries) → grants (one statement, by id).
-- Refunds regardless of the window, to the original grant if still valid now; else refunds_skipped.
-- Allowed after start. p_reason is recorded on the refund ledger entries (no session column in MVP).
create function public.admin_cancel_session(p_session_id uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_staff     uuid := (select auth.uid());
  v_session   public.sessions%rowtype;
  v_booking   public.bookings%rowtype;
  v_note      text := left('session cancelled' || coalesce(': ' || p_reason, ''), 200);
  v_cancelled int := 0;
  v_refunded  int := 0;
  v_skipped   uuid[] := '{}';
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

revoke execute on function public.create_session(uuid, uuid, date, time, int, int, text, text, text, text, text, int, boolean) from public, anon;
grant  execute on function public.create_session(uuid, uuid, date, time, int, int, text, text, text, text, text, int, boolean) to authenticated;
revoke execute on function public.grant_credits(uuid, int, int, text, uuid) from public, anon;
grant  execute on function public.grant_credits(uuid, int, int, text, uuid) to authenticated;
revoke execute on function public.mark_attendance(uuid, text) from public, anon;
grant  execute on function public.mark_attendance(uuid, text) to authenticated;
revoke execute on function public.admin_cancel_session(uuid, text) from public, anon;
grant  execute on function public.admin_cancel_session(uuid, text) to authenticated;

-- rollback (stateless, local only):
--   drop function public.admin_cancel_session(uuid, text); drop function public.mark_attendance(uuid, text);
--   drop function public.grant_credits(uuid, int, int, text, uuid);
--   drop function public.create_session(uuid, uuid, date, time, int, int, text, text, text, text, text, int, boolean);
