-- Journey D (sequential) + C6 + E8 for cancel_booking (DATA_MODEL §6.2, §12).
-- Refund deadline D = starts_at - 24 h, inclusive (domain cancellation-policy.ts).
-- The migration seeds Bylou rules: 24 h + 'deny'.
begin;
\ir _helpers.inc
select plan(39);

select tests.setup_people();
select tests.put('gA', tests.make_grant('A', 10, now() + interval '40 days')::text);
select tests.put('gB', tests.make_grant('B', 10, now() + interval '40 days')::text);
select tests.put('s_edge', tests.make_session(now() + interval '24 hours')::text);
select tests.put('s_late', tests.make_session(now() + interval '24 hours' - interval '1 second')::text);

select tests.as_user('A');
select tests.put('b_edge', public.book_session(tests.v('s_edge'), gen_random_uuid())->>'booking_id');
select tests.put('b_late', public.book_session(tests.v('s_late'), gen_random_uuid())->>'booking_id');
select tests.as_postgres();
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 8, 'setup: A debited twice');

-- D1 cancel exactly at the refund deadline → cancelled + refund ----------------------------------
select tests.as_user('A');
select tests.put('c1', public.cancel_booking(tests.v('b_edge'), gen_random_uuid())::text);
select is(tests.j('c1')->>'ok', 'true', 'D1 ok at exactly 24 h before start');
select is(tests.j('c1')->>'status', 'cancelled', 'D1 status cancelled');
select is(tests.j('c1')->>'refunded', 'true', 'D1 refunded');
select tests.as_postgres();
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 9, 'D1 grant +1');
select is((select count(*) from public.credit_ledger where booking_id = tests.v('b_edge') and reason = 'cancel_refund'),
  1::bigint, 'D1 one cancel_refund ledger row');
select is((select confirmed_count from public.sessions where id = tests.v('s_edge')), 0, 'D1 confirmed_count −1');
select results_eq(
  format('select status, refunded, cancelled_by from public.bookings where id = %L', tests.v('b_edge')),
  format('values (%L::text, true, %L::uuid)', 'cancelled', tests.uid('A')),
  'D1 booking row kept with audit fields');

-- C6 cancel twice → state replay, still one refund ---------------------------------------------------
select tests.as_user('A');
select tests.put('c2', public.cancel_booking(tests.v('b_edge'), gen_random_uuid())::text);
select is(tests.j('c2')->>'replayed', 'true', 'C6 second cancel is a replay');
select is(tests.j('c2')->>'refunded', 'true', 'C6 replay reports the original refund');
select tests.as_postgres();
select is((select count(*) from public.credit_ledger where booking_id = tests.v('b_edge') and reason = 'cancel_refund'),
  1::bigint, 'C6 exactly one refund');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 9, 'C6 grant refunded once');

-- D2b Bylou 'deny': one second inside the window → cancellation_too_late, no writes ----------------
select tests.as_user('A');
select tests.put('c3', public.cancel_booking(tests.v('b_late'))::text);
select is(tests.j('c3')->>'ok', 'false', 'D2b deny: rejected');
select is(tests.j('c3')->>'code', 'cancellation_too_late', 'D2b deny: cancellation_too_late');
select is(tests.j('c3')->>'confirm_required', 'false', 'D2b deny: confirm_required false');
select is(tests.j('c3')->>'refund', 'false', 'D2b deny: refund false');
select is(public.cancel_booking(tests.v('b_late'), gen_random_uuid(), true)->>'code', 'cancellation_too_late',
  'D2b deny: p_accept_late is ignored');
select tests.as_postgres();
select is((select status from public.bookings where id = tests.v('b_late')), 'confirmed', 'D2b booking still confirmed');
select is((select confirmed_count from public.sessions where id = tests.v('s_late')), 1, 'D2b count unchanged');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 9, 'D2b no refund');

-- D2 platform policy 'allow_without_refund' ------------------------------------------------------------
update public.studio_settings set late_cancel_policy = 'allow_without_refund' where id = 1;
select tests.as_user('A');
select tests.put('c4', public.cancel_booking(tests.v('b_late'))::text);
select is(tests.j('c4')->>'code', 'cancellation_too_late', 'D2 allow: too late without acceptance');
select is(tests.j('c4')->>'confirm_required', 'true', 'D2 allow: confirm_required true');
select tests.as_postgres();
select is((select status from public.bookings where id = tests.v('b_late')), 'confirmed', 'D2 no writes before acceptance');
select tests.as_user('A');
select tests.put('c5', public.cancel_booking(tests.v('b_late'), gen_random_uuid(), true)::text);
select is(tests.j('c5')->>'status', 'late_cancelled', 'D2 accepted → late_cancelled');
select is(tests.j('c5')->>'refunded', 'false', 'D2 accepted → no refund');
select tests.as_postgres();
select is((select confirmed_count from public.sessions where id = tests.v('s_late')), 0, 'D2 spot freed');
select is((select count(*) from public.credit_ledger where booking_id = tests.v('b_late') and reason = 'cancel_refund'),
  0::bigint, 'D2 no refund ledger row');
update public.studio_settings set late_cancel_policy = 'deny' where id = 1;

-- D3 cancellation_not_allowed: after start / attendance marked / student cancellation disabled ----------
select tests.put('s_started', tests.make_session(now() - interval '10 minutes')::text);
select tests.put('b_started', tests.make_booking('A', tests.v('s_started'))::text);
select tests.put('s_att', tests.make_session(now() + interval '3 days')::text);
select tests.put('b_att', tests.make_booking('A', tests.v('s_att'), null, 'attended')::text);
select tests.put('s_d3', tests.make_session(now() + interval '3 days')::text);
select tests.as_user('A');
select tests.put('b_d3', public.book_session(tests.v('s_d3'), gen_random_uuid())->>'booking_id');
select is(public.cancel_booking(tests.v('b_started'))->>'code', 'cancellation_not_allowed', 'D3 after start');
select is(public.cancel_booking(tests.v('b_att'))->>'code', 'cancellation_not_allowed', 'D3 attendance already marked');
select tests.as_postgres();
update public.studio_settings set student_cancellation_enabled = false where id = 1;
select tests.as_user('A');
select is(public.cancel_booking(tests.v('b_d3'))->>'code', 'cancellation_not_allowed', 'D3 student cancellation disabled');
select tests.as_postgres();
update public.studio_settings set student_cancellation_enabled = true where id = 1;

-- D4 original grant expired before an in-window cancel → cancelled, refunded false, no ledger row -------
select tests.put('s_d4', tests.make_session(now() + interval '3 days')::text);
select tests.as_user('B');
select tests.put('b_d4', public.book_session(tests.v('s_d4'), gen_random_uuid())->>'booking_id');
select tests.as_postgres();
update public.credit_grants set expires_at = now() - interval '1 second' where id = tests.v('gB');   -- time travel
select tests.as_user('B');
select tests.put('c6', public.cancel_booking(tests.v('b_d4'))::text);
select is(tests.j('c6')->>'status', 'cancelled', 'D4 cancelled');
select is(tests.j('c6')->>'refunded', 'false', 'D4 not refunded (grant expired)');
select tests.as_postgres();
select is((select count(*) from public.credit_ledger where booking_id = tests.v('b_d4') and reason = 'cancel_refund'),
  0::bigint, 'D4 no refund ledger row');
select is((select credits_remaining from public.credit_grants where id = tests.v('gB')), 9, 'D4 expired grant unchanged');

-- E8 A cancels B's booking → not_owner, no change; unknown id → not_found ------------------------------
select tests.put('s_e8', tests.make_session(now() + interval '3 days')::text);
select tests.make_grant('B', 2, now() + interval '30 days');
select tests.as_user('B');
select tests.put('b_e8', public.book_session(tests.v('s_e8'), gen_random_uuid())->>'booking_id');
select tests.as_user('A');
select is(public.cancel_booking(tests.v('b_e8'))->>'code', 'not_owner', 'E8 not_owner');
select is(public.cancel_booking(gen_random_uuid())->>'code', 'not_found', 'cancel unknown booking → not_found');
select tests.as_postgres();
select is((select status from public.bookings where id = tests.v('b_e8')), 'confirmed', 'E8 B booking unchanged');

-- D8 reconciliation --------------------------------------------------------------------------------------
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D8 grants reconcile with ledger');
select is(tests.session_count_mismatches(), 0::bigint, 'D8 counters reconcile with bookings');

select * from finish();
rollback;
