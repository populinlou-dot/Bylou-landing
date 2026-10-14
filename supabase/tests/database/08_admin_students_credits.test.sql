-- Phase 4.3 (AD-08 … AD-10): student search + summary, credit adjustments, book / cancel on behalf.
-- Migration 20261014001000_admin_students_credits (grant_credits itself is covered by 04_admin).
begin;
\ir _helpers.inc
select plan(90);

select tests.setup_people();
-- A: one 10-credit pack valid for 120 days. B: 1 credit. C: an expired pack. D: no pack at all.
select tests.put('gA', tests.make_grant('A', 10, now() + interval '120 days')::text);
select tests.put('gB', tests.make_grant('B', 1, now() + interval '120 days')::text);
select tests.put('gC_exp', tests.make_grant('C', 4, now() - interval '1 hour', now() - interval '40 days')::text);
select tests.put('gC', tests.make_grant('C', 4, now() + interval '120 days')::text);
update public.profiles set display_name = 'Ana Pérez' where id = tests.uid('A');

-- Privileges: students → forbidden, anon → no EXECUTE at all ------------------------------------------------
select tests.as_user('A');
select throws_ok('select public.admin_search_students(null)', '42501', 'forbidden', 'AD-09 student search → forbidden');
select throws_ok(format('select public.admin_student_summary(%L)', tests.uid('A')), '42501', 'forbidden',
  'AD-09 student summary → forbidden');
select throws_ok(format('select public.admin_adjust_credits(%L, 1, %L, gen_random_uuid())', tests.v('gA'), 'x'),
  '42501', 'forbidden', 'AD-08 student admin_adjust_credits → forbidden');
select throws_ok(format('select public.admin_book_for(%L, gen_random_uuid(), gen_random_uuid())', tests.uid('A')),
  '42501', 'forbidden', 'AD-10 student admin_book_for → forbidden');
select throws_ok('select public.admin_cancel_for(gen_random_uuid())', '42501', 'forbidden',
  'AD-10 student admin_cancel_for → forbidden');
select tests.as_anon();
select throws_ok('select public.admin_search_students(null)', '42501', null, 'AD-09 anon cannot execute admin_search_students');
select throws_ok('select public.admin_student_summary(gen_random_uuid())', '42501', null,
  'AD-09 anon cannot execute admin_student_summary');
select throws_ok('select public.admin_adjust_credits(gen_random_uuid(), 1, ''x'', gen_random_uuid())', '42501', null,
  'AD-08 anon cannot execute admin_adjust_credits');
select throws_ok('select public.admin_book_for(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())', '42501', null,
  'AD-10 anon cannot execute admin_book_for');
select throws_ok('select public.admin_cancel_for(gen_random_uuid())', '42501', null, 'AD-10 anon cannot execute admin_cancel_for');
select tests.as_postgres();
select ok((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
                           and p.prosecdef and p.proconfig @> array['search_path=""'])
             from pg_proc p
            where p.oid in ('public.admin_search_students(text, int)'::regprocedure,
                            'public.admin_student_summary(uuid)'::regprocedure,
                            'public.admin_adjust_credits(uuid, int, text, uuid)'::regprocedure,
                            'public.admin_book_for(uuid, uuid, uuid)'::regprocedure,
                            'public.admin_cancel_for(uuid, boolean)'::regprocedure)),
  'AD-08/09/10 new RPCs: SECURITY DEFINER, search_path = '''', EXECUTE to authenticated only');
select ok(not has_function_privilege('authenticated', 'private.student_summary(uuid)', 'execute'),
  'private.student_summary is not callable through the API');

-- AD-09 search + summary --------------------------------------------------------------------------------------
select tests.put('s_next', tests.make_session(now() + interval '3 days', 5)::text);
select tests.make_booking('A', tests.v('s_next'), tests.v('gA'));
select tests.as_user('staff');
select tests.put('q_email', public.admin_search_students('TEST-A@example')::text);
select tests.put('q_name', public.admin_search_students('  pérez ')::text);
select tests.put('q_wild', public.admin_search_students('%')::text);
select tests.put('q_staff', public.admin_search_students('test-staff')::text);
select tests.put('q_all', public.admin_search_students(null, 100)::text);
select tests.put('sum_a', public.admin_student_summary(tests.uid('A'))::text);
select tests.put('sum_d', public.admin_student_summary(tests.uid('D'))::text);
select tests.put('sum_staff', public.admin_student_summary(tests.uid('staff'))::text);
select tests.put('sum_none', public.admin_student_summary(gen_random_uuid())::text);
select throws_ok(format('select public.admin_search_students(%L)', repeat('x', 101)), '22023', null,
  'AD-09 query longer than 100 chars → 22023');
select throws_ok('select public.admin_search_students(null, 0)', '22023', null, 'AD-09 limit 0 → 22023');
select tests.as_postgres();
select is((select array_agg(s->>'user_id') from jsonb_array_elements(tests.j('q_email')->'students') s),
  array[tests.uid('A')::text], 'AD-09 search by email is case-insensitive');
select is((select array_agg(s->>'user_id') from jsonb_array_elements(tests.j('q_name')->'students') s),
  array[tests.uid('A')::text], 'AD-09 search by display name (trimmed, case-insensitive)');
select is(jsonb_array_length(tests.j('q_wild')->'students'), 0, 'AD-09 LIKE wildcards are matched literally');
select is(jsonb_array_length(tests.j('q_staff')->'students'), 0, 'AD-09 staff profiles are not listed as students');
select is((select count(*) from jsonb_array_elements(tests.j('q_all')->'students') s
            where (s->>'balance')::int <> private.usable_balance((s->>'user_id')::uuid)), 0::bigint,
  'AD-09 every listed balance equals the server definition (private.usable_balance)');
select is((tests.j('sum_a')->'student'->>'balance')::int, 9, 'AD-09 summary balance = usable credits (10 − 1 booked)');
select is(tests.j('sum_a')->'student'->'next_booking'->>'session_id', tests.v('s_next')::text,
  'AD-09 summary shows the next booking');
select ok((tests.j('sum_a')->'student'->>'next_expiry')::timestamptz > now(), 'AD-09 summary shows the next expiry');
select is(tests.j('sum_d')->'student'->'next_booking', 'null'::jsonb, 'AD-09 no upcoming booking → null');
select is((tests.j('sum_d')->'student'->>'balance')::int, 0, 'AD-09 no pack → balance 0');
select is(tests.j('sum_staff')->>'code', 'not_found', 'AD-09 a staff profile is not a student → not_found');
select is(tests.j('sum_none')->>'code', 'not_found', 'AD-09 unknown id → not_found');

-- AD-08.2 admin_adjust_credits ---------------------------------------------------------------------------------
select tests.as_user('staff');
select tests.put('adj1', public.admin_adjust_credits(tests.v('gA'), -2, '  Clase tomada fuera de la app  ',
  'cccccccc-0000-4000-8000-000000000001')::text);
select tests.put('adj1r', public.admin_adjust_credits(tests.v('gA'), -2, 'otro texto', 'cccccccc-0000-4000-8000-000000000001')::text);
select throws_ok(format('select public.admin_adjust_credits(%L, -3, %L, %L)', tests.v('gA'), 'x', 'cccccccc-0000-4000-8000-000000000001'),
  '22023', null, 'AD-08.2 same key, different delta → 22023');
select throws_ok(format('select public.admin_adjust_credits(%L, 1, null, gen_random_uuid())', tests.v('gA')), '22023', null,
  'AD-08.2 reason is required (null)');
select throws_ok(format('select public.admin_adjust_credits(%L, 1, %L, gen_random_uuid())', tests.v('gA'), '   '), '22023', null,
  'AD-08.2 reason is required (blank)');
select throws_ok(format('select public.admin_adjust_credits(%L, 1, %L, gen_random_uuid())', tests.v('gA'), repeat('x', 201)),
  '22023', null, 'AD-08.2 reason longer than 200 chars → 22023');
select throws_ok(format('select public.admin_adjust_credits(%L, 0, %L, gen_random_uuid())', tests.v('gA'), 'x'), '22023', null,
  'AD-08.2 delta 0 → 22023');
select throws_ok(format('select public.admin_adjust_credits(%L, -1, %L, null)', tests.v('gA'), 'x'), '22023', null,
  'AD-08.2 request key is required');
select tests.put('adj_neg', public.admin_adjust_credits(tests.v('gA'), -8, 'x', gen_random_uuid())::text);
select tests.put('adj_over', public.admin_adjust_credits(tests.v('gA'), 4, 'x', gen_random_uuid())::text);
select tests.put('adj_up', public.admin_adjust_credits(tests.v('gA'), 2, 'Devolución por ausencia justificada', gen_random_uuid())::text);
select tests.put('adj_exp', public.admin_adjust_credits(tests.v('gC_exp'), -1, 'x', gen_random_uuid())::text);
select tests.put('adj_404', public.admin_adjust_credits(gen_random_uuid(), -1, 'x', gen_random_uuid())::text);
select tests.as_postgres();
select is(tests.j('adj1')->>'ok', 'true', 'AD-08.2 staff removes credits from a pack');
select is((tests.j('adj1')->>'credits_remaining')::int, 7, 'AD-08.2 pack remaining 9 → 7');
select is((tests.j('adj1')->>'balance')::int, 7, 'AD-08.2 returns the server balance');
select results_eq(
  format('select reason, delta, note, actor_id, request_key from public.credit_ledger where grant_id = %L and reason = %L order by id limit 1',
         tests.v('gA'), 'admin_adjust'),
  format('values (%L::text, -2, %L::text, %L::uuid, %L::uuid)', 'admin_adjust', 'Clase tomada fuera de la app', tests.uid('staff'),
         'cccccccc-0000-4000-8000-000000000001'),
  'AD-08.2 admin_adjust ledger entry: trimmed reason as note, staff actor, request key');
select is(tests.j('adj1r')->>'replayed', 'true', 'AD-08.2 same key → replayed');
select is(tests.j('adj1r')->>'ledger_id', tests.j('adj1')->>'ledger_id', 'AD-08.2 replay returns the original entry');
select is((select count(*) from public.credit_ledger where request_key = 'cccccccc-0000-4000-8000-000000000001'), 1::bigint,
  'AD-08.2 replay writes no second entry');
select is(tests.j('adj_neg')->>'code', 'insufficient_balance', 'AD-08.2 below zero → insufficient_balance');
select is((tests.j('adj_neg')->>'credits_remaining')::int, 7, 'AD-08.2 refusal reports what is left');
select is(tests.j('adj_over')->>'code', 'adjust_exceeds_pack', 'AD-08.2 above the pack size → adjust_exceeds_pack');
select is((tests.j('adj_up')->>'credits_remaining')::int, 9, 'AD-08.2 positive adjustment up to size − booked (10 − 1)');
select is(tests.j('adj_exp')->>'code', 'grant_expired', 'AD-08.2 an expired pack is not adjustable');
select is(tests.j('adj_404')->>'code', 'not_found', 'AD-08.2 unknown pack → not_found');
select is((select count(*) from public.credit_ledger where grant_id = tests.v('gA') and reason = 'admin_adjust'), 2::bigint,
  'AD-08.2 refusals write nothing');
select ok(private.usable_balance(tests.uid('A')) >= 0 and private.usable_balance(tests.uid('B')) >= 0,
  'AD-08.2 usable balance never negative');
select throws_ok(format('insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id, request_key) values (%L, %L, %L, 1, %L, gen_random_uuid())',
  tests.uid('A'), tests.v('gA'), 'grant', tests.uid('staff')), '23514', null, 'request_key only on admin_adjust entries');
select ok(not has_table_privilege('authenticated', 'public.credit_ledger', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.credit_ledger', 'DELETE')
          and not has_table_privilege('authenticated', 'public.credit_ledger', 'INSERT'),
  'I8 ledger stays append-only through the API (no INSERT/UPDATE/DELETE grants)');
select throws_ok('update public.credit_ledger set note = null where reason = ''admin_adjust''', '42501', 'credit_ledger is append-only',
  'I8 an admin_adjust entry cannot be edited, even by the owner');

-- AD-10 admin_book_for ----------------------------------------------------------------------------------------
select tests.put('s_far', tests.make_session(now() + interval '40 days', 3)::text);   -- not open for students yet
select tests.put('s_far2', tests.make_session(now() + interval '41 days', 3)::text);
select tests.put('s_one', tests.make_session(now() + interval '2 days', 1)::text);
select tests.put('s_past', tests.make_session(now() - interval '10 minutes', 5)::text);
select tests.put('s_canc', tests.make_session(now() + interval '5 days', 5)::text);
update public.sessions set status = 'cancelled', cancelled_at = now() where id = tests.v('s_canc');
select tests.as_user('A');
select tests.put('own_far', public.book_session(tests.v('s_far'), gen_random_uuid())::text);
select tests.as_user('B');
select public.book_session(tests.v('s_one'), gen_random_uuid());
select tests.as_user('staff');
select tests.put('bf1', public.admin_book_for(tests.uid('A'), tests.v('s_far'), 'dddddddd-0000-4000-8000-000000000001')::text);
select tests.put('bf1r', public.admin_book_for(tests.uid('A'), tests.v('s_far'), 'dddddddd-0000-4000-8000-000000000001')::text);
select throws_ok(format('select public.admin_book_for(%L, %L, %L)', tests.uid('A'), tests.v('s_far2'), 'dddddddd-0000-4000-8000-000000000001'),
  '22023', null, 'AD-10 same key for another session → 22023');
select tests.put('bf_again', public.admin_book_for(tests.uid('A'), tests.v('s_far'), gen_random_uuid())::text);
select tests.put('bf_full', public.admin_book_for(tests.uid('C'), tests.v('s_one'), gen_random_uuid())::text);
select tests.put('bf_past', public.admin_book_for(tests.uid('C'), tests.v('s_past'), gen_random_uuid())::text);
select tests.put('bf_canc', public.admin_book_for(tests.uid('C'), tests.v('s_canc'), gen_random_uuid())::text);
select tests.put('bf_nocredit', public.admin_book_for(tests.uid('D'), tests.v('s_far'), gen_random_uuid())::text);
select tests.put('bf_staff', public.admin_book_for(tests.uid('staff'), tests.v('s_far'), gen_random_uuid())::text);
select tests.put('bf_nosession', public.admin_book_for(tests.uid('A'), gen_random_uuid(), gen_random_uuid())::text);
select throws_ok(format('select public.admin_book_for(%L, %L, null)', tests.uid('A'), tests.v('s_far')), '22023', null,
  'AD-10 request key is required');
select tests.as_postgres();
select is(tests.j('own_far')->>'code', 'booking_not_open', 'AD-10 (contrast) the student herself cannot book yet');
select is(tests.j('bf1')->>'ok', 'true', 'AD-10 staff books for a student outside the booking window');
select results_eq(
  format('select user_id, source, created_by, status from public.bookings where id = %L', tests.j('bf1')->>'booking_id'),
  format('values (%L::uuid, %L::text, %L::uuid, %L::text)', tests.uid('A'), 'staff', tests.uid('staff'), 'confirmed'),
  'AD-10 booking belongs to the student, source staff, actor recorded in created_by');
select results_eq(
  format('select reason, delta, actor_id from public.credit_ledger where booking_id = %L', tests.j('bf1')->>'booking_id'),
  format('values (%L::text, -1, %L::uuid)', 'booking_debit', tests.uid('staff')),
  'AD-10 one credit debited, staff as ledger actor');
select is(tests.j('bf1r')->>'replayed', 'true', 'AD-10 same key → replayed');
select is(tests.j('bf1r')->>'booking_id', tests.j('bf1')->>'booking_id', 'AD-10 replay returns the original booking');
select is(tests.j('bf_again')->>'code', 'already_booked', 'AD-10 one active booking per student per session');
select is(tests.j('bf_full')->>'code', 'session_full', 'AD-10 capacity is never bypassed');
select is((select confirmed_count from public.sessions where id = tests.v('s_one')), 1, 'AD-10 a full session stays at capacity');
select is(tests.j('bf_past')->>'code', 'session_started', 'AD-10 no booking once the session started');
select is(tests.j('bf_canc')->>'code', 'session_cancelled', 'AD-10 no booking into a cancelled session');
select is(tests.j('bf_nocredit')->>'code', 'no_valid_credit', 'AD-10 the student needs a valid pack');
select is(tests.j('bf_staff')->>'code', 'not_found', 'AD-10 only students can be booked for');
select is(tests.j('bf_nosession')->>'code', 'not_found', 'AD-10 unknown session → not_found');

-- AD-10 admin_cancel_for --------------------------------------------------------------------------------------
-- Inside Bylou's 24 h window (deny policy): the student cannot cancel, staff can, with a refund.
select tests.put('s_soon', tests.make_session(now() + interval '2 hours', 5)::text);
select tests.put('bk_soon', tests.make_booking('C', tests.v('s_soon'), tests.v('gC'))::text);
select tests.put('bk_norefund', tests.make_booking('A', tests.make_session(now() + interval '3 hours', 5), tests.v('gA'))::text);
select tests.put('bk_marked', tests.make_booking('B', tests.make_session(now() - interval '5 minutes', 5), null, 'attended')::text);
select tests.put('g_short', tests.make_grant('D', 2, now() + interval '30 minutes')::text);
select tests.put('bk_short', tests.make_booking('D', tests.make_session(now() + interval '20 minutes', 5), tests.v('g_short'))::text);
select tests.as_user('C');
select tests.put('own_cancel', public.cancel_booking(tests.v('bk_soon'), gen_random_uuid())::text);
select tests.as_user('staff');
select tests.put('cf1', public.admin_cancel_for(tests.v('bk_soon'))::text);
select tests.put('cf1r', public.admin_cancel_for(tests.v('bk_soon'))::text);
select tests.put('cf_norefund', public.admin_cancel_for(tests.v('bk_norefund'), false)::text);
select tests.put('cf_marked', public.admin_cancel_for(tests.v('bk_marked'))::text);
select tests.put('cf_404', public.admin_cancel_for(gen_random_uuid())::text);
select throws_ok('select public.admin_cancel_for(null)', '22023', null, 'AD-10 booking id is required');
select tests.as_postgres();
-- Expire the short pack between booking and cancellation (now() is fixed inside the transaction).
update public.credit_grants set expires_at = now() - interval '1 second', valid_from = now() - interval '2 days'
 where id = tests.v('g_short');
select tests.as_user('staff');
select tests.put('cf_expired', public.admin_cancel_for(tests.v('bk_short'))::text);
select tests.as_postgres();
select is(tests.j('own_cancel')->>'code', 'cancellation_too_late', 'AD-10 (contrast) the student is inside the window');
select is(tests.j('cf1')->>'refunded', 'true', 'AD-10 staff cancels inside the window and the credit goes back');
select results_eq(
  format('select status, cancelled_by, refunded from public.bookings where id = %L', tests.v('bk_soon')),
  format('values (%L::text, %L::uuid, true)', 'cancelled', tests.uid('staff')),
  'AD-10 cancelled_by records the staff member');
select results_eq(
  format('select delta, actor_id from public.credit_ledger where booking_id = %L and reason = %L', tests.v('bk_soon'), 'cancel_refund'),
  format('values (1, %L::uuid)', tests.uid('staff')),
  'AD-10 refund ledger entry with the staff actor');
select is((select confirmed_count from public.sessions where id = tests.v('s_soon')), 0, 'AD-10 the spot is released');
select is(tests.j('cf1r')->>'replayed', 'true', 'AD-10 second cancel → replayed');
select is((select count(*) from public.credit_ledger where booking_id = tests.v('bk_soon') and reason = 'cancel_refund'), 1::bigint,
  'AD-10 a replay never refunds twice');
select is(tests.j('cf_norefund')->>'refunded', 'false', 'AD-10 p_refund = false cancels without a refund');
select is((select count(*) from public.credit_ledger where booking_id = tests.v('bk_norefund') and reason = 'cancel_refund'), 0::bigint,
  'AD-10 no refund entry when p_refund = false');
select is(tests.j('cf_marked')->>'code', 'cancellation_not_allowed', 'AD-10 a booking with attendance marked is not cancellable');
select is(tests.j('cf_404')->>'code', 'not_found', 'AD-10 unknown booking → not_found');
select is(tests.j('cf_expired')->>'refund_skipped', 'true', 'AD-10 an expired pack is reported as refund_skipped');

-- M1: the adjustment cap keeps room for credits held by confirmed bookings, so refunds never break
-- grants_remaining_bounds (remaining ≤ total).
select tests.put('gD5', tests.make_grant('D', 5, now() + interval '120 days')::text);
select tests.put('s_m1', tests.make_session(now() + interval '3 days', 5)::text);
select tests.put('s_m2', tests.make_session(now() + interval '4 days', 5)::text);
select tests.put('s_m3', tests.make_session(now() + interval '5 days', 5)::text);
select tests.as_user('D');
select tests.put('bk_m1', public.book_session(tests.v('s_m1'), gen_random_uuid())->>'booking_id');
select public.book_session(tests.v('s_m2'), gen_random_uuid());
select public.book_session(tests.v('s_m3'), gen_random_uuid());
select tests.as_user('staff');
select tests.put('adj_held', public.admin_adjust_credits(tests.v('gD5'), 1, 'x', gen_random_uuid())::text);
select tests.as_user('D');
select tests.put('m1_cancel', public.cancel_booking(tests.v('bk_m1'), gen_random_uuid())::text);
select tests.as_user('staff');
select tests.put('m2_cancel', public.admin_cancel_session(tests.v('s_m2'), '  Demo: profe con gripe  ')::text);
select tests.put('m3_cancel', public.admin_cancel_session(tests.v('s_m3'))::text);
select tests.as_postgres();
select is(tests.j('adj_held')->>'code', 'adjust_exceeds_pack', 'M1 +1 on a 5-pack with 3 booked (2 left) → adjust_exceeds_pack');
select is((tests.j('adj_held')->>'credits_booked')::int, 3, 'M1 refusal reports the credits held by confirmed bookings');
select is(tests.j('m1_cancel')->>'refunded', 'true', 'M1 a student refund still fits in the pack');
select is((tests.j('m2_cancel')->>'refunded')::int, 1, 'M1 admin_cancel_session still refunds');
select is((tests.j('m3_cancel')->>'refunded')::int, 1, 'M1 the last refund fills the pack exactly');
select is((select credits_remaining from public.credit_grants where id = tests.v('gD5')), 5, 'M1 remaining back to the pack size, never above');
select results_eq(
  format('select l.note from public.credit_ledger l join public.bookings b on b.id = l.booking_id
           where b.session_id in (%L, %L) and l.reason = %L order by b.session_id = %L desc',
         tests.v('s_m2'), tests.v('s_m3'), 'cancel_refund', tests.v('s_m2')),
  $$values ('Demo: profe con gripe'::text), (null::text)$$,
  'admin_cancel_session refund note = the trimmed reason only (no English prefix), or null');

-- Ledger visibility + D8 reconciliation ---------------------------------------------------------------------
select tests.as_user('A');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('A') and reason = 'admin_adjust'), 2::bigint,
  'AD-08.3 the student reads her own adjustments (reason included)');
select tests.as_user('B');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('A')), 0::bigint,
  'AD-08.3 another student cannot read them');
select tests.as_postgres();
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D8 every pack remaining = Σ ledger delta');
select is(tests.session_count_mismatches(), 0::bigint, 'D8 every confirmed_count = count(confirmed)');

select * from finish();
rollback;
