-- =============================================================================
-- LOCAL / PREVIEW SEED — FAKE DATA ONLY. Never run against production.
-- Runs on `supabase db reset` (local). All people, emails and phones are fictional
-- (example.test is a reserved TLD). Users have no password; local sign-in is via
-- email OTP captured by the local mail catcher.
-- =============================================================================

-- Studio rules = brands/bylou rules (ADR-011 / ADR-014): AR timezone, opens 30 d, closes 0 min,
-- free cancellation up to 24 h, late cancellation denied, 1 credit per booking, waitlist on (owner 2026-10-14).
insert into public.studio_settings (id, timezone, booking_opens_days, booking_closes_minutes,
  cancellation_window_hours, late_cancel_policy, student_cancellation_enabled, credits_per_booking, waitlist_enabled)
values (1, 'America/Argentina/Buenos_Aires', 30, 0, 24, 'deny', true, 1, true)
on conflict (id) do update set
  timezone = excluded.timezone, booking_opens_days = excluded.booking_opens_days,
  booking_closes_minutes = excluded.booking_closes_minutes,
  cancellation_window_hours = excluded.cancellation_window_hours,
  late_cancel_policy = excluded.late_cancel_policy,
  student_cancellation_enabled = excluded.student_cancellation_enabled,
  credits_per_booking = excluded.credits_per_booking, waitlist_enabled = excluded.waitlist_enabled;

-- Fake users (1 staff, 3 students). The on_auth_user_created trigger creates their profiles.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  from (values
    ('5eed0000-0000-4000-8000-000000000001'::uuid, 'staff@example.test'),
    ('5eed0000-0000-4000-8000-000000000011'::uuid, 'alumna1@example.test'),
    ('5eed0000-0000-4000-8000-000000000012'::uuid, 'alumna2@example.test'),
    ('5eed0000-0000-4000-8000-000000000013'::uuid, 'alumna3@example.test')
  ) as u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
  from auth.users u where u.email like '%@example.test';

-- Staff promotion is an owner-only SQL action (ADR-005); no API path changes roles.
update public.profiles set role = 'staff', display_name = 'Staff Demo' where id = '5eed0000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'Alumna Demo 1', phone = '+54 11 0000-0001' where id = '5eed0000-0000-4000-8000-000000000011';
update public.profiles set display_name = 'Alumna Demo 2' where id = '5eed0000-0000-4000-8000-000000000012';
update public.profiles set display_name = 'Alumna Demo 3' where id = '5eed0000-0000-4000-8000-000000000013';

insert into public.class_types (id, slug, name, description, default_duration_minutes, default_capacity,
                                default_modality, is_published, sort_order)
values
  ('5eed0000-0000-4000-8000-0000000000c1', 'hatha', 'Hatha Yoga', 'Clase demo de Hatha.', 60, 8, 'in_person', true, 1),
  ('5eed0000-0000-4000-8000-0000000000c2', 'vinyasa', 'Vinyasa', 'Clase demo de Vinyasa.', 75, 6, 'in_person', true, 2),
  ('5eed0000-0000-4000-8000-0000000000c3', 'yoga-online', 'Yoga online', 'Clase demo por videollamada.', 60, 10, 'online', true, 3);

-- Sessions, grants and bookings. Future data goes through the RPCs (same invariants as production);
-- past data is inserted directly with its matching ledger rows and counters.
do $seed$
declare
  c_tz      constant text := 'America/Argentina/Buenos_Aires';
  c_staff   constant uuid := '5eed0000-0000-4000-8000-000000000001';
  c_a1      constant uuid := '5eed0000-0000-4000-8000-000000000011';
  c_a2      constant uuid := '5eed0000-0000-4000-8000-000000000012';
  c_a3      constant uuid := '5eed0000-0000-4000-8000-000000000013';
  c_hatha   constant uuid := '5eed0000-0000-4000-8000-0000000000c1';
  c_vinyasa constant uuid := '5eed0000-0000-4000-8000-0000000000c2';
  c_online  constant uuid := '5eed0000-0000-4000-8000-0000000000c3';
  v_today   date := (now() at time zone c_tz)::date;
  v_r       jsonb;
  v_hatha   jsonb;
  v_full    uuid;
  v_cancel  uuid;
  v_old     uuid;
  v_expired uuid;
  v_past    uuid;
  v_past2   uuid;
  v_today_s uuid;
  v_bk      uuid;
begin
  -- Act as staff for admin RPCs.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c_staff, 'role', 'authenticated')::text, true);

  -- Grants: valid packs, one expiring tomorrow, one exhausted (alumna3), plus an expired one below.
  perform public.grant_credits(c_a1, 8, 30, 'Pack 8 · demo', '5eed0000-0000-4000-8000-00000000a001');
  perform public.grant_credits(c_a2, 4, 30, 'Pack 4 · demo', '5eed0000-0000-4000-8000-00000000a002');
  perform public.grant_credits(c_a2, 1, 2, 'Clase suelta · vence mañana', '5eed0000-0000-4000-8000-00000000a003');
  perform public.grant_credits(c_a3, 1, 30, 'Clase suelta · demo', '5eed0000-0000-4000-8000-00000000a004');

  -- Weekly series (next 2 weeks): Hatha Tue-like at 18:00 local, Vinyasa at 09:00, Online at 19:30.
  v_hatha := public.create_session('5eed0000-0000-4000-8000-00000000b001', c_hatha, v_today + 1, '18:00',
               p_location_label => 'Estudio', p_address => 'Calle Falsa 123 (demo)', p_repeat_weeks => 2,
               p_instructor_name => 'Lou');
  perform public.create_session('5eed0000-0000-4000-8000-00000000b002', c_vinyasa, v_today + 2, '09:00',
               p_location_label => 'Terraza', p_repeat_weeks => 2, p_instructor_name => 'Lou');
  perform public.create_session('5eed0000-0000-4000-8000-00000000b003', c_online, v_today + 3, '19:30',
               p_meeting_url => 'https://meet.example.test/demo-room', p_repeat_weeks => 2, p_instructor_name => 'Lou');
  -- Full session (1:1, capacity 1) and a session that will be cancelled by the studio.
  v_full   := (public.create_session('5eed0000-0000-4000-8000-00000000b004', c_hatha, v_today + 4, '10:00',
                 p_capacity => 1, p_location_label => 'Sesión 1:1', p_instructor_name => 'Lou')->'session_ids'->>0)::uuid;
  v_cancel := (public.create_session('5eed0000-0000-4000-8000-00000000b005', c_vinyasa, v_today + 5, '18:00',
                 p_location_label => 'Estudio', p_instructor_name => 'Lou')->'session_ids'->>0)::uuid;

  -- Students book through book_session.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c_a1, 'role', 'authenticated')::text, true);
  perform public.book_session((v_hatha->'session_ids'->>0)::uuid, '5eed0000-0000-4000-8000-00000000d001');
  perform public.book_session(v_cancel, '5eed0000-0000-4000-8000-00000000d002');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c_a2, 'role', 'authenticated')::text, true);
  perform public.book_session(v_full, '5eed0000-0000-4000-8000-00000000d003');
  perform public.book_session((v_hatha->'session_ids'->>0)::uuid, '5eed0000-0000-4000-8000-00000000d004');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c_a3, 'role', 'authenticated')::text, true);
  perform public.book_session((v_hatha->'session_ids'->>1)::uuid, '5eed0000-0000-4000-8000-00000000d005');  -- exhausts grant

  -- Studio cancels one session (refunds alumna1).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', c_staff, 'role', 'authenticated')::text, true);
  perform public.admin_cancel_session(v_cancel, 'Demo: profe con gripe');
  perform set_config('request.jwt.claims', '', true);

  -- Past and same-day data (direct inserts, ledger + counters kept consistent).
  insert into public.credit_grants (user_id, credits_total, credits_remaining, valid_from, expires_at, note,
                                    granted_by, idempotency_key, created_at)
  values (c_a1, 4, 2, now() - interval '20 days', (((v_today + 10)::timestamp) at time zone c_tz),
          'Pack 4 · demo anterior', c_staff, '5eed0000-0000-4000-8000-00000000a005', now() - interval '20 days')
  returning id into v_old;
  insert into public.credit_grants (user_id, credits_total, credits_remaining, valid_from, expires_at, note,
                                    granted_by, idempotency_key, created_at)
  values (c_a3, 4, 4, now() - interval '60 days', now() - interval '30 days',
          'Pack 4 · vencido (demo)', c_staff, '5eed0000-0000-4000-8000-00000000a006', now() - interval '60 days')
  returning id into v_expired;
  insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id, note, created_at)
  values (c_a1, v_old, 'grant', 4, c_staff, 'Pack 4 · demo anterior', now() - interval '20 days'),
         (c_a3, v_expired, 'grant', 4, c_staff, 'Pack 4 · vencido (demo)', now() - interval '60 days');

  insert into public.sessions (class_type_id, starts_at, ends_at, capacity, confirmed_count, modality,
                               instructor_name, location_label)
  values (c_hatha, (((v_today - 1) + time '18:00')::timestamp) at time zone c_tz,
          (((v_today - 1) + time '19:00')::timestamp) at time zone c_tz, 8, 1, 'in_person', 'Lou', 'Estudio')
  returning id into v_past;
  insert into public.sessions (class_type_id, starts_at, ends_at, capacity, confirmed_count, modality,
                               instructor_name, location_label)
  values (c_vinyasa, (((v_today - 3) + time '09:00')::timestamp) at time zone c_tz,
          (((v_today - 3) + time '10:15')::timestamp) at time zone c_tz, 6, 1, 'in_person', 'Lou', 'Terraza')
  returning id into v_past2;
  insert into public.sessions (class_type_id, starts_at, ends_at, capacity, modality, instructor_name, location_label)
  values (c_hatha, date_trunc('hour', now()) + interval '3 hours', date_trunc('hour', now()) + interval '4 hours',
          8, 'in_person', 'Lou', 'Estudio (hoy)')
  returning id into v_today_s;

  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited,
                               created_by, created_at, attendance, attendance_marked_at, attendance_marked_by)
  values (v_past, c_a1, '5eed0000-0000-4000-8000-00000000d006', v_old, 1, c_a1, now() - interval '5 days',
          'attended', now() - interval '1 day', c_staff)
  returning id into v_bk;
  insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id, created_at)
  values (c_a1, v_old, v_bk, 'booking_debit', -1, c_a1, now() - interval '5 days');
  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited,
                               created_by, created_at, attendance, attendance_marked_at, attendance_marked_by)
  values (v_past2, c_a1, '5eed0000-0000-4000-8000-00000000d007', v_old, 1, c_a1, now() - interval '7 days',
          'no_show', now() - interval '3 days', c_staff)
  returning id into v_bk;
  insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id, created_at)
  values (c_a1, v_old, v_bk, 'booking_debit', -1, c_a1, now() - interval '7 days');
end
$seed$;

-- Credit-expiry job (migration 11): record the expired demo pack in the ledger now instead of waiting
-- for the hourly pg_cron run, so Σ ledger = balance for every seeded student right after a reset.
select private.expire_credit_grants();
