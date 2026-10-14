-- Journey E (privacy / authorization) + F2 roster + B4 + E10 (DATA_MODEL §4, §12).
begin;
\ir _helpers.inc
select plan(45);

-- Fixtures (as postgres) ------------------------------------------------------
select tests.setup_people();
select tests.put('s1',       tests.make_session(now() + interval '3 days')::text);
select tests.put('s_unpub',  tests.make_session(now() + interval '3 days', 5, false)::text);
select tests.put('s_cancel', tests.make_session(now() + interval '3 days')::text);
update public.sessions set status = 'cancelled', cancelled_at = now() where id = tests.v('s_cancel');
insert into public.session_private_details (session_id, meeting_url, address)
values (tests.v('s1'), 'https://meet.example.test/room', 'Calle Falsa 123');
select tests.make_grant('A', 5, now() + interval '30 days');
select tests.make_grant('B', 5, now() + interval '30 days');

select tests.as_user('A');
select tests.put('bA', (public.book_session(tests.v('s1'), gen_random_uuid())->>'booking_id'));
select tests.as_user('B');
select tests.put('bB', (public.book_session(tests.v('s1'), gen_random_uuid())->>'booking_id'));
select tests.as_postgres();

-- E1 anon cannot read private tables --------------------------------------------
select tests.as_anon();
select throws_ok('select * from public.bookings',                '42501', null, 'E1 anon cannot read bookings');
select throws_ok('select * from public.profiles',                '42501', null, 'E1 anon cannot read profiles');
select throws_ok('select * from public.credit_grants',           '42501', null, 'E1 anon cannot read credit_grants');
select throws_ok('select * from public.credit_ledger',           '42501', null, 'E1 anon cannot read credit_ledger');
select throws_ok('select * from public.session_private_details', '42501', null, 'E1 anon cannot read private details');

-- E2 anon availability: only published + scheduled sessions -----------------------
select is((select count(*) from public.session_availability
            where id in (tests.v('s1'), tests.v('s_unpub'), tests.v('s_cancel'))), 1::bigint,
  'E2 anon sees only the published scheduled session');
select is((select spots_left from public.session_availability where id = tests.v('s1')), 3,
  'E2 anon sees spots_left without any booking access');
select is((select count(*) from public.session_availability where status <> 'scheduled'), 0::bigint,
  'E2 anon never sees cancelled sessions');

-- E7 anon cannot call RPCs ---------------------------------------------------------
select throws_ok(format('select public.book_session(%L, gen_random_uuid())', tests.v('s1')), '42501', null,
  'E7 anon cannot call book_session');
select throws_ok(format('select public.cancel_booking(%L)', tests.v('bA')), '42501', null,
  'E7 anon cannot call cancel_booking');
select throws_ok(format('select public.admin_cancel_session(%L)', tests.v('s1')), '42501', null,
  'E7 anon cannot call admin_cancel_session');
select tests.as_postgres();

-- E3 student A cannot read B's data ------------------------------------------------
select tests.as_user('A');
select is((select count(*) from public.bookings where user_id = tests.uid('B')), 0::bigint, 'E3 A cannot read B bookings');
select is((select count(*) from public.credit_grants where user_id = tests.uid('B')), 0::bigint, 'E3 A cannot read B grants');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('B')), 0::bigint, 'E3 A cannot read B ledger');
select is((select count(*) from public.profiles where id <> tests.uid('A')), 0::bigint, 'E3 A reads no other profile');
select is((select count(*) from public.bookings), 1::bigint, 'E3 A reads exactly own booking');
select is((select count(*) from public.sessions where id = tests.v('s_unpub')), 0::bigint,
  'A cannot see unpublished sessions it holds no booking for');

-- F2 roster: student sees only own; staff sees all with names ----------------------
select is((select count(*) from public.bookings b where b.session_id = tests.v('s1')), 1::bigint,
  'F2 student sees only own booking in the roster');
select tests.as_user('staff');
select is((select count(*) from public.bookings b join public.profiles p on p.id = b.user_id
            where b.session_id = tests.v('s1') and b.status = 'confirmed' and p.display_name is not null), 2::bigint,
  'F2 staff reads the full roster with names');
select is((select count(*) from public.session_private_details where session_id = tests.v('s1')), 1::bigint,
  'staff reads private details');
select throws_ok(format('update public.profiles set role = %L where id = %L', 'staff', tests.uid('A')), '42501', null,
  'E5 even staff cannot change roles through the API');

-- E4 student has no direct writes ---------------------------------------------------
select tests.as_user('A');
select throws_ok(format('insert into public.bookings (session_id, user_id, idempotency_key, created_by) values (%L, %L, gen_random_uuid(), %L)',
                        tests.v('s1'), tests.uid('A'), tests.uid('A')), '42501', null, 'E4 student cannot insert bookings');
select throws_ok(format('update public.bookings set status = %L where id = %L', 'cancelled', tests.v('bA')), '42501', null,
  'E4 student cannot update bookings');
select throws_ok(format('delete from public.bookings where id = %L', tests.v('bA')), '42501', null,
  'E4 student cannot delete bookings');
select throws_ok(format('update public.sessions set capacity = 100 where id = %L', tests.v('s1')), '42501', null,
  'E4 student cannot change session capacity');
select throws_ok(format('delete from public.sessions where id = %L', tests.v('s1')), '42501', null,
  'E4 student cannot delete sessions');
select throws_ok('update public.credit_grants set credits_remaining = 99', '42501', null,
  'E4 student cannot update credit_grants');
select throws_ok(format('insert into public.credit_ledger (user_id, grant_id, reason, delta) select %L, id, %L, 5 from public.credit_grants limit 1',
                        tests.uid('A'), 'admin_adjust'), '42501', null, 'E4 student cannot insert ledger rows');

-- E5 profile updates -----------------------------------------------------------------
select throws_ok(format('update public.profiles set role = %L where id = %L', 'staff', tests.uid('A')), '42501', null,
  'E5 student cannot update own role');
select throws_ok(format('update public.profiles set email = %L where id = %L', 'x@example.test', tests.uid('A')), '42501', null,
  'E5 student cannot update own email');
select lives_ok(format('update public.profiles set display_name = %L where id = %L', 'Nueva', tests.uid('A')),
  'E5 student updates own display_name');
update public.profiles set display_name = 'Hacked' where id = tests.uid('B');   -- RLS: 0 rows
-- Profile completion step (UX backlog #4) uses exactly this statement shape through PostgREST.
select lives_ok(format('update public.profiles set display_name = %L where id = %L returning display_name', 'Ana', tests.uid('A')),
  'E5 update … returning display_name (PostgREST update + select) is allowed on the own row');
select throws_ok(format('update public.profiles set display_name = %L where id = %L', '', tests.uid('A')), '23514', null,
  'E5 empty display_name rejected by the CHECK (1–80 chars)');
select throws_ok(format('update public.profiles set display_name = %L where id = %L', repeat('a', 81), tests.uid('A')), '23514', null,
  'E5 81-char display_name rejected by the CHECK');
update public.profiles set display_name = 'Nueva' where id = tests.uid('A');
select tests.as_anon();
select throws_ok(format('update public.profiles set display_name = %L where id = %L', 'Anon', tests.uid('A')), '42501', null,
  'E5 anon cannot update any profile');
select tests.as_postgres();
select is((select display_name from public.profiles where id = tests.uid('A')), 'Nueva', 'E5 own display_name changed');
select is((select display_name from public.profiles where id = tests.uid('B')), 'test-b', 'E5 other profile untouched');

-- E9 private details: none / confirmed / after cancel ----------------------------------
select tests.as_user('C');
select is((select count(*) from public.session_private_details where session_id = tests.v('s1')), 0::bigint,
  'E9 no booking → no private details');
select tests.as_user('A');
select is((select count(*) from public.session_private_details where session_id = tests.v('s1')), 1::bigint,
  'E9 confirmed booking → private details visible');
select is((public.cancel_booking(tests.v('bA'))->>'status'), 'cancelled', 'E9 A cancels (outside window)');
select is((select count(*) from public.session_private_details where session_id = tests.v('s1')), 0::bigint,
  'E9 after cancel → private details hidden');
select tests.as_postgres();

-- B4 counter backstop + E10 ledger append-only (even as table owner) --------------------
select throws_ok(format('update public.sessions set confirmed_count = capacity + 1 where id = %L', tests.v('s1')),
  '23514', null, 'B4 confirmed_count > capacity violates sessions_no_overbooking');
select throws_ok('update public.credit_ledger set delta = 100', '42501', 'credit_ledger is append-only',
  'E10 ledger UPDATE rejected for postgres');
select throws_ok('delete from public.credit_ledger', '42501', 'credit_ledger is append-only',
  'E10 ledger DELETE rejected for postgres');
select throws_ok('truncate public.credit_ledger cascade', '42501', 'credit_ledger is append-only',
  'E10 ledger TRUNCATE rejected for postgres');

select * from finish();
rollback;
