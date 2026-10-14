-- Phase 4.2 (AD-02 … AD-05): class types, recurring creation, capacity edit, cancel with refunds.
-- Migration 20261014000900_admin_sessions + create_session (migrations 7/8).
begin;
\ir _helpers.inc
select plan(69);

select tests.setup_people();
select tests.put('ct', (select id from public.class_types where slug = 'hatha')::text);   -- seeded: 60 min, cap 8
select tests.put('d0', ((now() at time zone 'America/Argentina/Buenos_Aires')::date + 2)::text);
select tests.make_grant('A', 20, now() + interval '120 days');
select tests.make_grant('B', 20, now() + interval '120 days');
select tests.make_grant('C', 20, now() + interval '120 days');

-- Privileges: students → forbidden, anon → no EXECUTE at all ------------------------------------------
select tests.as_user('A');
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, null, 60, 8, %L, true)', 'X', 'online'),
  '42501', 'forbidden', 'AD-02 student admin_upsert_class_type → forbidden');
select throws_ok('select public.admin_update_session(gen_random_uuid(), 5)',
  '42501', 'forbidden', 'AD-05 student admin_update_session → forbidden');
select tests.as_anon();
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, null, 60, 8, %L, true)', 'X', 'online'),
  '42501', null, 'AD-02 anon cannot execute admin_upsert_class_type');
select throws_ok('select public.admin_update_session(gen_random_uuid(), 5)',
  '42501', null, 'AD-05 anon cannot execute admin_update_session');
select throws_ok('select public.admin_cancel_session(gen_random_uuid())',
  '42501', null, 'AD-05 anon cannot execute admin_cancel_session');
select tests.as_postgres();
select ok(not has_function_privilege('anon', 'public.admin_upsert_class_type(uuid, text, text, int, int, text, boolean, int)', 'execute')
          and not has_function_privilege('anon', 'public.admin_update_session(uuid, int)', 'execute')
          and has_function_privilege('authenticated', 'public.admin_update_session(uuid, int)', 'execute'),
  'AD-02/05 EXECUTE granted to authenticated only');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
             from pg_proc p where p.oid in ('public.admin_upsert_class_type(uuid, text, text, int, int, text, boolean, int)'::regprocedure,
                                            'public.admin_update_session(uuid, int)'::regprocedure)),
  'AD-02/05 new RPCs are SECURITY DEFINER with search_path = ''''');

-- AD-02 class types: create, replay, edit, slug, validation ------------------------------------------
select tests.as_user('staff');
select tests.put('k1', public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000001', '  Práctica Ñandú  ', '   ',
  45, 6, 'online', true)::text);
select tests.put('k1r', public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000001', '  Práctica Ñandú  ', '   ',
  45, 6, 'online', true)::text);
select tests.put('k1e', public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000001', 'Práctica lenta',
  'Descripción <b>sin</b> HTML', 90, 4, 'in_person', true, 7)::text);
select tests.put('k2', public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000002', 'Práctica Ñandú', null,
  60, 8, 'in_person', false)::text);
select tests.as_postgres();
select is(tests.j('k1')->>'ok', 'true', 'AD-02 staff creates a class type');
select is(tests.j('k1')->>'created', 'true', 'AD-02 first call reports created');
select is(tests.j('k1r')->>'created', 'false', 'AD-02 retry with the same id does not insert again');
select is((select count(*) from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 1::bigint,
  'AD-02 one row after the retry');
select results_eq(
  $$select slug, name, description, default_duration_minutes, default_capacity, default_modality, is_published, sort_order
      from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  $$values ('practica-nandu'::text, 'Práctica lenta'::text, 'Descripción <b>sin</b> HTML'::text, 90, 4, 'in_person'::text, true, 7)$$,
  'AD-02 edit updates every field; slug derived once from the first name and kept; text stored verbatim');
select tests.as_user('staff');
select public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000003', 'Sin descripción', '   ', 60, 8, 'online', true);
select tests.as_postgres();
select is((select description from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000003'), null,
  'AD-02 a blank description is stored as null');
select ok((select slug ~ '^practica-nandu-[0-9a-f]{8}$' from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  'AD-02 slug collision gets a deterministic suffix');
select is((select is_published from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000002'), false,
  'AD-02 a class type can be created unpublished (draft)');
select ok((select sort_order > (select max(sort_order) from public.class_types
                                  where id not in ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'))
             from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  'AD-02 a new class type without sort order goes last');
-- Admin read (ADR-015): staff list every class type, drafts/archived included; students do not see drafts.
select tests.as_user('staff');
select is((select count(*) from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000002'), 1::bigint,
  'AD-02 staff read an unpublished class type through RLS');
select tests.as_user('B');
select is((select count(*) from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000002'), 0::bigint,
  'AD-02 a student cannot read an unpublished class type');
select tests.as_user('staff');
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, null, 5, 8, %L, true)', 'Corta', 'online'),
  '22023', null, 'AD-02 duration < 10 → 22023');
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, null, 60, 0, %L, true)', 'Vacía', 'online'),
  '22023', null, 'AD-02 capacity 0 → 22023');
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, null, 60, 8, %L, true)', 'Mixta', 'hybrid'),
  '22023', null, 'AD-02 unknown modality → 22023');
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, null, 60, 8, %L, true)', '   ', 'online'),
  '22023', null, 'AD-02 blank name → 22023');
select throws_ok(format('select public.admin_upsert_class_type(null, %L, null, 60, 8, %L, true)', 'Sin id', 'online'),
  '22023', null, 'AD-02 missing id → 22023');
select throws_ok(format('select public.admin_upsert_class_type(gen_random_uuid(), %L, %L, 60, 8, %L, true)', 'Larga', repeat('x', 2001), 'online'),
  '22023', null, 'AD-02 description > 2000 chars → 22023');

-- AD-02 archive: history kept, hidden from students/anon, unbookable, no new sessions ----------------
select tests.put('s_arch', (public.create_session(gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001',
  current_setting('tests.d0')::date, '10:00')->'session_ids'->>0));
select tests.as_user('A');
select tests.put('b_arch', public.book_session(tests.v('s_arch'), gen_random_uuid())->>'booking_id');
select tests.as_user('staff');
select tests.put('arch', public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000001', 'Práctica lenta',
  null, 90, 4, 'in_person', false)::text);
select is((tests.j('arch')->>'upcoming_sessions')::int, 1, 'AD-02 archive reports the upcoming sessions it hides');
select throws_ok(format('select public.create_session(gen_random_uuid(), %L, %L::date, %L)',
  'aaaaaaaa-0000-4000-8000-000000000001', current_setting('tests.d0'), '12:00'), '22023', null,
  'AD-02 no new sessions for an archived class type');
select tests.as_anon();
select is((select count(*) from public.class_types where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0::bigint,
  'AD-02 anon cannot see an archived class type');
select is((select count(*) from public.session_availability where id = tests.v('s_arch')), 0::bigint,
  'AD-02 anon agenda hides sessions of an archived class type');
select tests.as_user('B');
select is((select count(*) from public.sessions where id = tests.v('s_arch')), 0::bigint,
  'AD-02 a student without a booking cannot see the session');
select is(public.book_session(tests.v('s_arch'), gen_random_uuid())->>'code', 'not_found',
  'AD-02 sessions of an archived class type are unbookable');
select tests.as_user('A');
select is((select count(*) from public.session_availability where id = tests.v('s_arch')), 1::bigint,
  'AD-02 the student who booked still sees her class (history kept)');
select tests.as_postgres();
select is((select count(*) from public.bookings where id = tests.v('b_arch') and status = 'confirmed'), 1::bigint,
  'AD-02 archiving keeps existing bookings');
select tests.as_user('staff');
select public.admin_upsert_class_type('aaaaaaaa-0000-4000-8000-000000000001', 'Práctica lenta', null, 90, 4, 'in_person', true);
select tests.as_anon();
select is((select count(*) from public.session_availability where id = tests.v('s_arch')), 1::bigint,
  'AD-02 republishing shows the session again');

-- AD-03/04 creation: weekly ×12 in studio wall time; atomic; retry after failure is not a replay ----
select tests.as_user('staff');
select tests.put('w12', public.create_session('bbbbbbbb-0000-4000-8000-0000000000c1', tests.v('ct'),
  current_setting('tests.d0')::date, '18:00', p_repeat_weeks => 12, p_capacity => 4,
  p_address => 'Calle Falsa 123')::text);
select tests.as_postgres();
select is(jsonb_array_length(tests.j('w12')->'session_ids'), 12, 'AD-04 12 weeks → 12 sessions');
select is((select count(*) from public.sessions where series_id = 'bbbbbbbb-0000-4000-8000-0000000000c1'
             and (starts_at at time zone 'America/Argentina/Buenos_Aires')::time = '18:00'
             and ((starts_at at time zone 'America/Argentina/Buenos_Aires')::date - current_setting('tests.d0')::date) % 7 = 0),
  12::bigint, 'AD-04 every occurrence at 18:00 studio time, 7 local days apart');
select is((select count(distinct (starts_at at time zone 'America/Argentina/Buenos_Aires')::date)
             from public.sessions where series_id = 'bbbbbbbb-0000-4000-8000-0000000000c1'), 12::bigint,
  'AD-04 12 distinct local dates');
select is((select count(*) from public.session_private_details d join public.sessions s on s.id = d.session_id
            where s.series_id = 'bbbbbbbb-0000-4000-8000-0000000000c1' and d.address = 'Calle Falsa 123'), 12::bigint,
  'AD-03 private address stored for every occurrence');
select tests.put('w12_first', tests.j('w12')->'session_ids'->>0);
select tests.put('w12_second', tests.j('w12')->'session_ids'->>1);

-- Atomicity: a failure on the 3rd occurrence rolls back the whole batch.
create function tests.fail_third_occurrence() returns trigger language plpgsql as $$
begin
  if new.series_id = 'bbbbbbbb-0000-4000-8000-0000000000a7'
     and (select count(*) from public.sessions where series_id = new.series_id) >= 2 then
    raise exception 'simulated failure' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tests_fail_third before insert on public.sessions
  for each row execute function tests.fail_third_occurrence();
select tests.as_user('staff');
select throws_ok(format('select public.create_session(%L, %L, %L::date, %L, p_repeat_weeks => 4)',
  'bbbbbbbb-0000-4000-8000-0000000000a7', tests.v('ct'), current_setting('tests.d0'), '07:00'),
  'P0001', 'simulated failure', 'AD-04 a failing occurrence aborts the call');
select tests.as_postgres();
select is((select count(*) from public.sessions where series_id = 'bbbbbbbb-0000-4000-8000-0000000000a7'), 0::bigint,
  'AD-04 all or nothing: no partial series');
drop trigger tests_fail_third on public.sessions;
select tests.as_user('staff');
select tests.put('a7', public.create_session('bbbbbbbb-0000-4000-8000-0000000000a7', tests.v('ct'),
  current_setting('tests.d0')::date, '07:00', p_repeat_weeks => 4)::text);
select tests.as_postgres();
select is(tests.j('a7')->>'replayed', 'false', 'AD-04 retry with the same key after a failure creates the series');
select is(jsonb_array_length(tests.j('a7')->'session_ids'), 4, 'AD-04 retry creates all 4 occurrences');

-- Occurrences are independent afterwards.
select tests.as_user('staff');
select public.admin_cancel_session(tests.v('w12_first'));
select tests.as_postgres();
select results_eq(
  format('select status from public.sessions where id in (%L, %L) order by starts_at', tests.v('w12_first'), tests.v('w12_second')),
  $$values ('cancelled'::text), ('scheduled'::text)$$,
  'AD-04 cancelling one occurrence leaves the next one untouched');

-- AD-05.1 admin_update_session -----------------------------------------------------------------------
select tests.put('s_cap', tests.make_session(now() + interval '3 days', 3)::text);
select tests.as_user('A');
select public.book_session(tests.v('s_cap'), gen_random_uuid());
select tests.as_user('B');
select public.book_session(tests.v('s_cap'), gen_random_uuid());
select tests.as_user('staff');
select tests.put('u1', public.admin_update_session(tests.v('s_cap'), 2)::text);
select tests.put('u2', public.admin_update_session(tests.v('s_cap'), 2)::text);
select tests.put('u3', public.admin_update_session(tests.v('s_cap'), 1)::text);
select tests.as_postgres();
select is(tests.j('u1')->>'ok', 'true', 'AD-05.1 capacity down to the confirmed count is allowed');
select is(tests.j('u1')->>'changed', 'true', 'AD-05.1 first update reports a change');
select is(tests.j('u2')->>'changed', 'false', 'AD-05.1 same value again is a no-op');
select is(tests.j('u3')->>'code', 'capacity_below_bookings', 'AD-05.1 below confirmed → capacity_below_bookings');
select is((tests.j('u3')->>'confirmed_count')::int, 2, 'AD-05.1 refusal reports the confirmed count');
select is((select capacity from public.sessions where id = tests.v('s_cap')), 2, 'AD-05.1 refused update writes nothing');
select tests.as_user('C');
select is(public.book_session(tests.v('s_cap'), gen_random_uuid())->>'code', 'session_full',
  'AD-05.1 reduced capacity is enforced by book_session');
select tests.as_user('staff');
select is(public.admin_update_session(tests.v('s_cap'), 3)->>'capacity', '3', 'AD-05.1 capacity can grow again');
select tests.as_user('C');
select is(public.book_session(tests.v('s_cap'), gen_random_uuid())->>'ok', 'true', 'AD-05.1 the new spot is bookable');
select tests.as_user('staff');
select throws_ok(format('select public.admin_update_session(%L, 0)', tests.v('s_cap')), '22023', null,
  'AD-05.1 capacity 0 → 22023');
select throws_ok(format('select public.admin_update_session(%L, 101)', tests.v('s_cap')), '22023', null,
  'AD-05.1 capacity > 100 → 22023');
select is(public.admin_update_session(gen_random_uuid(), 5)->>'code', 'not_found', 'AD-05.1 unknown session → not_found');
select is(public.admin_update_session(tests.v('w12_first'), 5)->>'code', 'session_cancelled',
  'AD-05.1 cancelled session → session_cancelled');
select tests.as_postgres();
select tests.put('s_live', tests.make_session(now() - interval '10 minutes')::text);
select tests.put('s_done', tests.make_session(now() - interval '3 hours')::text);
select tests.as_user('staff');
select is(public.admin_update_session(tests.v('s_live'), 6)->>'code', 'session_started',
  'AD-05.1 in-progress session → session_started');
select is(public.admin_update_session(tests.v('s_done'), 6)->>'code', 'session_started',
  'AD-05.1 finished session → session_started');

-- AD-05.2 admin_cancel_session: inside the student window, all refunded, exactly once ----------------
select tests.as_postgres();
select tests.put('s_cx', tests.make_session(now() + interval '2 hours', 5)::text);      -- inside the 24 h window
select tests.as_user('A');
select public.book_session(tests.v('s_cx'), gen_random_uuid());
select tests.as_user('B');
select public.book_session(tests.v('s_cx'), gen_random_uuid());
select tests.as_user('C');
select public.book_session(tests.v('s_cx'), gen_random_uuid());
select tests.as_postgres();
select tests.put('bal_before', (select sum(credits_remaining) from public.credit_grants
                                where user_id in (tests.uid('A'), tests.uid('B'), tests.uid('C')))::text);
select tests.as_user('staff');
select tests.put('c1', public.admin_cancel_session(tests.v('s_cx'))::text);
select tests.put('c2', public.admin_cancel_session(tests.v('s_cx'))::text);
select tests.as_postgres();
select is((tests.j('c1')->>'cancelled_bookings')::int, 3, 'AD-05.2 every confirmed booking cancelled');
select is((tests.j('c1')->>'refunded')::int, 3, 'AD-05.2 every booking refunded regardless of the window');
select is(tests.j('c1')->'refunds_skipped', '[]'::jsonb, 'AD-05.2 no refund skipped with valid grants');
select is((select count(*) from public.credit_ledger l join public.bookings b on b.id = l.booking_id
            where b.session_id = tests.v('s_cx') and l.reason = 'cancel_refund' and l.delta = 1), 3::bigint,
  'AD-05.2 one cancel_refund ledger entry per booking');
select is((select count(*) from public.bookings where session_id = tests.v('s_cx')
             and status = 'cancelled' and refunded and cancelled_by = tests.uid('staff')), 3::bigint,
  'AD-05.2 bookings kept as cancelled + refunded, staff recorded as actor');
select is((select sum(credits_remaining) from public.credit_grants
            where user_id in (tests.uid('A'), tests.uid('B'), tests.uid('C')))::int,
  current_setting('tests.bal_before')::int + 3, 'AD-05.2 credits back in the packs');
select is(tests.j('c2')->>'replayed', 'true', 'AD-05.2 second cancel is a replay');
select is((tests.j('c2')->>'refunded')::int, 0, 'AD-05.2 replay refunds nothing');
select is((select count(*) from public.credit_ledger l join public.bookings b on b.id = l.booking_id
            where b.session_id = tests.v('s_cx') and l.reason = 'cancel_refund'), 3::bigint,
  'AD-05.2 still exactly one refund per booking after the replay');
select results_eq(format('select status, confirmed_count from public.sessions where id = %L', tests.v('s_cx')),
  $$values ('cancelled'::text, 0)$$, 'AD-05.2 session cancelled, counter 0');

-- D8 reconciliation ---------------------------------------------------------------------------------
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D8 grants reconcile with ledger');
select is(tests.session_count_mismatches(), 0::bigint, 'D8 counters reconcile with bookings');

select * from finish();
rollback;
