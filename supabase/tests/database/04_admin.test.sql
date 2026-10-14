-- Journey F (admin) + E6 + C7 + D5 (DATA_MODEL §6.3–6.6, §12).
begin;
\ir _helpers.inc
select plan(39);

select tests.setup_people();
select tests.put('ct', (select id from public.class_types where slug = 'hatha')::text);   -- seeded: 60 min, cap 8
select tests.put('gA', tests.make_grant('A', 10, now() + interval '40 days')::text);

-- E6 non-staff calling admin RPCs → 42501 ---------------------------------------------------------
select tests.as_user('A');
select throws_ok(format('select public.create_session(gen_random_uuid(), %L, current_date + 3, %L)', tests.v('ct'), '18:00'),
  '42501', 'forbidden', 'E6 student create_session → forbidden');
select throws_ok(format('select public.grant_credits(%L, 5, 30, null, gen_random_uuid())', tests.uid('A')),
  '42501', 'forbidden', 'E6 student grant_credits → forbidden');
select throws_ok('select public.mark_attendance(gen_random_uuid(), ''attended'')',
  '42501', 'forbidden', 'E6 student mark_attendance → forbidden');
select throws_ok('select public.admin_cancel_session(gen_random_uuid())',
  '42501', 'forbidden', 'E6 student admin_cancel_session → forbidden');
select tests.as_postgres();

-- F1 create_session: local 18:00 ART = 21:00 UTC; weekly ×4 shares series_id ---------------------------
select tests.put('d0', ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 2)::text);
select tests.as_user('staff');
select tests.put('f1', public.create_session('bbbbbbbb-0000-4000-8000-000000000001', tests.v('ct'),
  current_setting('tests.d0')::date, '18:00', p_meeting_url => 'https://meet.example.test/f1')::text);
select tests.put('f4', public.create_session('bbbbbbbb-0000-4000-8000-000000000004', tests.v('ct'),
  current_setting('tests.d0')::date, '18:00', p_repeat_weeks => 4, p_capacity => 3)::text);
select tests.put('f4r', public.create_session('bbbbbbbb-0000-4000-8000-000000000004', tests.v('ct'),
  current_setting('tests.d0')::date, '18:00', p_repeat_weeks => 4, p_capacity => 3)::text);
select tests.as_postgres();
select is(tests.j('f1')->>'ok', 'true', 'F1 single session created');
select results_eq(
  format('select (starts_at at time zone %L)::time, ends_at - starts_at, capacity from public.sessions where id = %L',
         'UTC', tests.j('f1')->'session_ids'->>0),
  $$values ('21:00'::time, interval '60 minutes', 8)$$,
  'F1 18:00 ART stored as 21:00 UTC; class-type defaults applied');
select is((select count(*) from public.session_private_details where session_id = (tests.j('f1')->'session_ids'->>0)::uuid),
  1::bigint, 'F1 private details stored separately');
select is(jsonb_array_length(tests.j('f4')->'session_ids'), 4, 'F1 weekly ×4 returns 4 ids');
select is((select count(*) from public.sessions where series_id = 'bbbbbbbb-0000-4000-8000-000000000004'
            and (starts_at at time zone 'UTC')::time = '21:00' and capacity = 3), 4::bigint,
  'F1 4 rows share series_id, all at 21:00 UTC');
select is((select max(starts_at) - min(starts_at) from public.sessions where series_id = 'bbbbbbbb-0000-4000-8000-000000000004'),
  interval '21 days', 'F1 weekly spacing');
-- C7 replay with the same request key
select is(tests.j('f4r')->>'replayed', 'true', 'C7 create_session replay flagged');
select is(tests.j('f4r')->'session_ids', tests.j('f4')->'session_ids', 'C7 create_session replay returns the same ids');
select tests.as_user('staff');
select throws_ok(format('select public.create_session(gen_random_uuid(), %L, %L::date, %L)', tests.v('ct'),
  ((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1), '18:00'), '22023', null, 'F1 start in the past → 22023');
select throws_ok(format('select public.create_session(gen_random_uuid(), %L, %L::date, %L, p_repeat_weeks => 13)',
  tests.v('ct'), current_setting('tests.d0'), '18:00'), '22023', null, 'F1 repeat_weeks > 12 → 22023');
select is(public.create_session(gen_random_uuid(), gen_random_uuid(), current_setting('tests.d0')::date, '18:00')->>'code',
  'not_found', 'F1 unknown class type → not_found');

-- F5 + C7 grant_credits ------------------------------------------------------------------------------------
select tests.put('g1', public.grant_credits(tests.uid('C'), 4, 30, 'Pack 4 · test', 'cccccccc-0000-4000-8000-000000000001')::text);
select tests.put('g2', public.grant_credits(tests.uid('C'), 4, 30, 'Pack 4 · test', 'cccccccc-0000-4000-8000-000000000001')::text);
select is(tests.j('g2')->>'replayed', 'true', 'C7 grant_credits replay flagged');
select is(tests.j('g2')->>'grant_id', tests.j('g1')->>'grant_id', 'C7 grant_credits replay returns the same grant');
select throws_ok(format('select public.grant_credits(%L, 4, 30, null, %L)', tests.uid('D'), 'cccccccc-0000-4000-8000-000000000001'),
  '22023', null, 'C7 same key for a different user → 22023');
select is(public.grant_credits(gen_random_uuid(), 1, 30, null, gen_random_uuid())->>'code', 'not_found',
  'F5 unknown user → not_found');
select throws_ok(format('select public.grant_credits(%L, 0, 30, null, gen_random_uuid())', tests.uid('C')),
  '22023', null, 'F5 zero credits → 22023');
select tests.as_postgres();
select is((select count(*) from public.credit_grants where user_id = tests.uid('C')), 1::bigint, 'C7 one grant');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('C') and reason = 'grant' and delta = 4),
  1::bigint, 'C7 one grant ledger entry');
select is((tests.j('g1')->>'expires_at')::timestamptz,
  (((now() at time zone 'America/Argentina/Buenos_Aires')::date + 30)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
  'F5 expires at local midnight after 30 local days');
select tests.as_user('C');
select results_eq(
  $$select sum(credits_remaining)::int, min(expires_at) from public.credit_grants
     where valid_from <= now() and expires_at > now() and credits_remaining > 0$$,
  format('values (4, %L::timestamptz)', tests.j('g1')->>'expires_at'),
  'F5 student balance and nextExpiry read via RLS');
select tests.as_postgres();

-- F3 mark_attendance ------------------------------------------------------------------------------------------
select tests.put('s_now',  tests.make_session(now() - interval '30 minutes')::text);
select tests.put('b_now',  tests.make_booking('A', tests.v('s_now'))::text);
select tests.put('s_old',  tests.make_session(now() - interval '8 days 2 hours')::text);
select tests.put('b_old',  tests.make_booking('A', tests.v('s_old'))::text);
select tests.put('s_soon', tests.make_session(now() + interval '1 hour')::text);
select tests.put('b_soon', tests.make_booking('B', tests.v('s_soon'))::text);
select tests.put('s_cx',   tests.make_session(now() + interval '3 days')::text);
select tests.as_user('A');
select tests.put('b_cx', public.book_session(tests.v('s_cx'), gen_random_uuid())->>'booking_id');
select public.cancel_booking(tests.v('b_cx'));
select tests.as_user('staff');
select is(public.mark_attendance(tests.v('b_now'), 'attended')->>'ok', 'true', 'F3 attended ok');
select is(public.mark_attendance(tests.v('b_now'), 'no_show')->>'attendance', 'no_show', 'F3 changed to no_show');
select is(public.mark_attendance(tests.v('b_cx'), 'attended')->>'code', 'not_found', 'F3 cancelled booking → not_found');
select is(public.mark_attendance(tests.v('b_old'), 'attended')->>'code', 'attendance_window_closed', 'F3 8 days later → closed');
select is(public.mark_attendance(tests.v('b_soon'), 'attended')->>'code', 'attendance_window_closed', 'F3 too early → closed');
select throws_ok(format('select public.mark_attendance(%L, %L)', tests.v('b_now'), 'late'), '22023', null,
  'F3 invalid attendance value → 22023');
select tests.as_postgres();
select results_eq(format('select attendance, attendance_marked_by from public.bookings where id = %L', tests.v('b_now')),
  format('values (%L::text, %L::uuid)', 'no_show', tests.uid('staff')), 'F3 attendance + marker recorded');

-- D5 admin_cancel_session: valid grant refunded, expired grant listed in refunds_skipped ------------------------
select tests.put('s_d5', tests.make_session(now() + interval '3 days')::text);
select tests.put('gB', tests.make_grant('B', 2, now() + interval '30 days')::text);
select tests.as_user('A');
select tests.put('b_d5a', public.book_session(tests.v('s_d5'), gen_random_uuid())->>'booking_id');
select tests.as_user('B');
select tests.put('b_d5b', public.book_session(tests.v('s_d5'), gen_random_uuid())->>'booking_id');
select tests.as_postgres();
update public.credit_grants set expires_at = now() - interval '1 second' where id = tests.v('gB');   -- time travel
select tests.as_user('staff');
select tests.put('x1', public.admin_cancel_session(tests.v('s_d5'), 'profe enferma')::text);
select tests.put('x2', public.admin_cancel_session(tests.v('s_d5'))::text);
select tests.as_postgres();
select is((tests.j('x1')->>'cancelled_bookings')::int, 2, 'D5 both bookings cancelled');
select is((tests.j('x1')->>'refunded')::int, 1, 'D5 one refund');
select is(tests.j('x1')->'refunds_skipped', jsonb_build_array(tests.v('b_d5b')), 'D5 expired grant listed in refunds_skipped');
select results_eq(format('select status, confirmed_count from public.sessions where id = %L', tests.v('s_d5')),
  $$values ('cancelled'::text, 0)$$, 'D5 session cancelled, count 0');
select is((select count(*) from public.bookings where session_id = tests.v('s_d5') and status = 'cancelled'), 2::bigint,
  'D5 booking rows kept as cancelled');
select is(tests.j('x2')->>'replayed', 'true', 'D5 second admin cancel is a replay');

-- D8 reconciliation ---------------------------------------------------------------------------------------------
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D8 grants reconcile with ledger');
select is(tests.session_count_mismatches(), 0::bigint, 'D8 counters reconcile with bookings');

select * from finish();
rollback;
