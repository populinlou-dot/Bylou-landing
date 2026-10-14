-- Booking core · migration 8 · db_hardening (Phase 3.3)
-- Fixes from the independent security review of migrations 1–7. Forward-only: earlier files untouched.
--   (a) profiles.email holds ONLY a confirmed address (no unverified-email spoofing).
--   (b) sessions of unpublished class types are invisible to anon/students and not bookable;
--       create_session rejects an unpublished class type.
--   (c) studio_settings.updated_by (staff identity) is not readable through the Data API.

-- (a) Confirmed email only ---------------------------------------------------------------------------
-- NULL = "no confirmed address yet". Unconfirmed sign-ups must never claim someone else's address.
alter table public.profiles alter column email drop not null;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Role is ALWAYS the column default; raw_user_meta_data is user-editable and ignored.
  insert into public.profiles (id, email)
  values (new.id, case when new.email_confirmed_at is not null then nullif(new.email, '') end);
  return new;
end $$;

-- Fires when the address is confirmed (email_confirmed_at becomes non-null) or changes. With
-- double_confirm_changes, GoTrue writes auth.users.email only once the change is confirmed.
create or replace function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set email = case when new.email_confirmed_at is not null then nullif(new.email, '') end
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_synced after update of email, email_confirmed_at on auth.users
  for each row
  when (old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function private.sync_user_email();

revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.sync_user_email() from public, anon, authenticated;

-- Backfill: clear any address copied before confirmation (and the old '' placeholder).
update public.profiles p
   set email = case when u.email_confirmed_at is not null then nullif(u.email, '') end
  from auth.users u
 where u.id = p.id
   and p.email is distinct from (case when u.email_confirmed_at is not null then nullif(u.email, '') end);

-- (b) Unpublished class types ----------------------------------------------------------------------
-- SECURITY DEFINER breaks the policy cycle sessions → class_types → (bookings ⋈ sessions) that a
-- plain subquery would hit for `authenticated` ("infinite recursion detected in policy").
create function private.class_type_is_published(p_class_type_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select ct.is_published from public.class_types ct where ct.id = p_class_type_id), false)
$$;
revoke execute on function private.class_type_is_published(uuid) from public, anon;
grant  execute on function private.class_type_is_published(uuid) to authenticated;   -- policies call it as the caller

-- anon: class_types RLS for anon is `is_published` only (no cycle), so a plain subquery is enough and
-- anon keeps zero EXECUTE / no private schema usage.
drop policy sessions_select_public on public.sessions;
create policy sessions_select_public on public.sessions for select to anon
  using (is_published and status = 'scheduled'
         and exists (select 1 from public.class_types ct where ct.id = sessions.class_type_id and ct.is_published));

-- authenticated: the public branch now requires a published class type. A student still sees the
-- sessions she booked (history), matching class_types_select_auth. Staff unaffected.
drop policy sessions_select_auth on public.sessions;
create policy sessions_select_auth on public.sessions for select to authenticated
  using ((is_published and status = 'scheduled' and private.class_type_is_published(class_type_id))
         or (select private.is_staff())
         or exists (select 1 from public.bookings b
                     where b.session_id = sessions.id and b.user_id = (select auth.uid())));

-- book_session: identical to migration 6 except (b): a session whose class type is unpublished is
-- `not_found` (same as an unpublished session; nothing about its existence leaks).
create or replace function public.book_session(p_session_id uuid, p_idempotency_key uuid)
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

  -- (e) LOCK 4: every usable grant in ONE statement ordered by id, then pick earliest-expiring.
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
    select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return private.booking_replay(v_prior, p_session_id); end if;
    return private.fail('already_booked');
end $$;

-- create_session: identical to migration 7 except (b): an unpublished class type is invalid_input
-- (22023), raised after the replay check so a replay of an earlier valid call still succeeds.
create or replace function public.create_session(
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('create_session:' || p_request_key::text, 0));
  select array_agg(s.id order by s.starts_at) into v_ids from public.sessions s where s.series_id = p_request_key;
  if v_ids is not null then
    return jsonb_build_object('ok', true, 'code', null, 'session_ids', to_jsonb(v_ids), 'replayed', true);
  end if;

  select * into v_type from public.class_types where id = p_class_type_id;
  if not found then return private.fail('not_found'); end if;
  if not v_type.is_published then
    raise exception 'invalid_input: class type is not published' using errcode = '22023';
  end if;
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

-- CREATE OR REPLACE keeps existing grants; restated so this file is self-describing.
revoke execute on function public.book_session(uuid, uuid) from public, anon;
grant  execute on function public.book_session(uuid, uuid) to authenticated;
revoke execute on function public.create_session(uuid, uuid, date, time, int, int, text, text, text, text, text, int, boolean) from public, anon;
grant  execute on function public.create_session(uuid, uuid, date, time, int, int, text, text, text, text, text, int, boolean) to authenticated;

-- (c) studio_settings.updated_by ---------------------------------------------------------------------
-- Column-level SELECT: every rule column stays public; updated_by (a staff profile id) does not.
-- Postgres/service_role keep full access. Column privileges cannot distinguish staff from students
-- (both are `authenticated`), so staff also lose API read of updated_by — a future staff RPC
-- (admin_update_settings) is the place to return it. `select *` through the API now fails: callers
-- must name columns (the app already does). New columns are NOT readable until granted explicitly.
revoke select on public.studio_settings from anon, authenticated;
grant select (id, timezone, booking_opens_days, booking_closes_minutes, cancellation_window_hours,
              late_cancel_policy, student_cancellation_enabled, credits_per_booking, waitlist_enabled, updated_at)
  on public.studio_settings to anon, authenticated;

-- rollback (local only; production fixes forward):
--   grant select on public.studio_settings to anon, authenticated;
--   re-run the bodies of public.create_session (migration 7) and public.book_session (migration 6);
--   drop policy sessions_select_auth / sessions_select_public on public.sessions; recreate them from migration 5;
--   drop function private.class_type_is_published(uuid);
--   drop trigger on_auth_user_email_synced on auth.users; recreate on_auth_user_email_changed (migration 2);
--   re-run private.handle_new_user / private.sync_user_email from migration 2;
--   update public.profiles set email = '' where email is null; alter table public.profiles alter column email set not null;
