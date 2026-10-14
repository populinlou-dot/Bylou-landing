-- Phase 4.1 admin UI read/write contract (AD-01, AD-06, AD-07; Journey F).
-- The admin UI reads through EXISTING RLS (no new RPC): these tests pin the exact shapes the
-- Supabase adapter (booking/infrastructure/supabase/supabase-admin-repository.ts) relies on, and
-- that students/anon never get more than before. Attendance window edges for mark_attendance.
begin;
\ir _helpers.inc
select plan(21);

-- Fixtures (as postgres) -------------------------------------------------------------------------
select tests.setup_people();
select tests.put('s_day',   tests.make_session(now() + interval '2 hours', 8)::text);
select tests.put('s_hidden', tests.make_session(now() + interval '3 hours', 5, false)::text);
select tests.put('s_cx',    tests.make_session(now() + interval '4 hours')::text);
update public.sessions set status = 'cancelled', cancelled_at = now() where id = tests.v('s_cx');
select tests.put('bA', tests.make_booking('A', tests.v('s_day'))::text);
select tests.put('bB', tests.make_booking('B', tests.v('s_day'))::text);
update public.profiles set display_name = '<script>alert(1)</script>' where id = tests.uid('B');
update public.profiles set display_name = null where id = tests.uid('C');
select tests.put('bC', tests.make_booking('C', tests.v('s_day'))::text);
-- Ended 6 days 23 h ago (inside the 7-day window) and 7 days 1 h ago (outside).
select tests.put('s_6d', tests.make_session(now() - interval '7 days', 5, true, 60)::text);
select tests.put('b_6d', tests.make_booking('A', tests.v('s_6d'))::text);
select tests.put('s_7d', tests.make_session(now() - interval '7 days 2 hours', 5, true, 60)::text);
select tests.put('b_7d', tests.make_booking('A', tests.v('s_7d'))::text);

-- Adapter contract: the roster embed hint names this exact FK ---------------------------------------
select is((select count(*) from pg_constraint
            where conrelid = 'public.bookings'::regclass and conname = 'bookings_user_id_fkey'
              and confrelid = 'public.profiles'::regclass), 1::bigint,
  'F6 bookings_user_id_fkey (bookings.user_id → profiles) exists for the roster embed');

-- Role check (StaffGuard): each user reads only her own role ---------------------------------------
select tests.as_user('staff');
select is((select role from public.profiles where id = tests.uid('staff')), 'staff', 'F6 staff reads own role = staff');
select tests.as_user('A');
select is((select role from public.profiles where id = tests.uid('A')), 'student', 'F6 student reads own role = student');
select is((select count(*) from public.profiles where id <> tests.uid('A')), 0::bigint,
  'AD-01 student cannot read any other profile (no names, emails or roles)');

-- "Hoy": staff sees every session of the day, any status / publication --------------------------------
select tests.as_user('staff');
select is((select count(*) from public.sessions
            where id in (tests.v('s_day'), tests.v('s_hidden'), tests.v('s_cx'))), 3::bigint,
  'F6 staff day query sees scheduled, unpublished and cancelled sessions');
select results_eq(
  format('select s.confirmed_count, s.capacity, ct.name from public.sessions s
            join public.class_types ct on ct.id = s.class_type_id where s.id = %L', tests.v('s_day')),
  $$values (3, 8, 'Test type'::text)$$,
  'F6 staff reads occupancy and class type name');
select tests.as_user('A');
select is((select count(*) from public.sessions where id in (tests.v('s_hidden'), tests.v('s_cx'))), 0::bigint,
  'AD-01 student does not see unpublished or cancelled sessions she did not book');

-- Roster: bookings ⋈ profiles via user_id ----------------------------------------------------------
select tests.as_user('staff');
select results_eq(
  format('select p.display_name, p.email from public.bookings b
            join public.profiles p on p.id = b.user_id
           where b.session_id = %L order by p.email', tests.v('s_day')),
  $$values ('test-a'::text, 'test-a@example.test'::text),
           ('<script>alert(1)</script>', 'test-b@example.test'),
           (null, 'test-c@example.test')$$,
  'F6 staff roster returns raw display_name (escaped by the UI) and the email fallback');
select tests.as_user('A');
select is((select count(*) from public.bookings where session_id = tests.v('s_day')), 1::bigint,
  'AD-01 student roster read returns only her own booking');
select is((select count(*) from public.bookings b join public.profiles p on p.id = b.user_id
            where b.session_id = tests.v('s_day')), 1::bigint,
  'AD-01 student roster join leaks no other names');
select tests.as_user('B');
select is((select count(*) from public.bookings where id = tests.v('bA')), 0::bigint,
  'AD-01 student B cannot read student A''s booking');

-- anon: no reads, no admin RPC -----------------------------------------------------------------------
select tests.as_anon();
select throws_ok('select role from public.profiles', '42501', null, 'AD-01 anon cannot read roles');
select throws_ok('select id from public.bookings', '42501', null, 'AD-01 anon cannot read the roster');
select throws_ok(format('select public.mark_attendance(%L, %L)', tests.v('bA'), 'attended'), '42501', null,
  'AD-01 anon cannot execute mark_attendance');

-- Students cannot write attendance, directly or via RPC ------------------------------------------------
select tests.as_user('A');
select throws_ok(format('select public.mark_attendance(%L, %L)', tests.v('bA'), 'attended'), '42501', 'forbidden',
  'AD-01 student mark_attendance on her own booking → forbidden');
select throws_ok(format('update public.bookings set attendance = %L where id = %L', 'attended', tests.v('bA')),
  '42501', null, 'AD-01 student cannot update attendance directly');

-- AD-07 window edges (server is the authority) ----------------------------------------------------------
select tests.as_user('staff');
select is(public.mark_attendance(tests.v('b_6d'), 'attended')->>'ok', 'true',
  'AD-07 staff can still edit attendance ~6 days 23 h after the end');
select is(public.mark_attendance(tests.v('b_6d'), 'unknown')->>'attendance', 'unknown',
  'AD-07 staff can reset attendance to unknown inside the window');
select is(public.mark_attendance(tests.v('b_7d'), 'attended')->>'code', 'attendance_window_closed',
  'AD-07 more than 7 days after the end → attendance_window_closed');
select is(public.mark_attendance(tests.v('bA'), 'attended')->>'code', 'attendance_window_closed',
  'AD-07 two hours before the start → attendance_window_closed');
select tests.as_postgres();
select results_eq(format('select attendance from public.bookings where id in (%L, %L) order by id', tests.v('b_7d'), tests.v('bA')),
  $$values ('unknown'::text), ('unknown'::text)$$,
  'AD-07 refused calls change nothing');

select * from finish();
rollback;
