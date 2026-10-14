-- D10 credit-expiry job (DATA_MODEL §6.8, §8 "Expiry"). Migration 20261014001100_credit_expiry_job.
-- now() is fixed for the whole test transaction, so "time passing" is simulated by moving a pack's
-- validity into the past (as postgres) after its bookings were made while it was still valid.
begin;
\ir _helpers.inc
select plan(35);

select tests.setup_people();
-- A: pack gA (5) used for an upcoming class (book_session) and a class in progress, then it "expires".
--    Plus a later-expiring valid pack gA2 (2) that the job must not touch (book_session picks gA first).
select tests.put('gA', tests.make_grant('A', 5, now() + interval '60 days')::text);
select tests.put('gA2', tests.make_grant('A', 2, now() + interval '90 days')::text);
select tests.put('s_future', tests.make_session(now() + interval '3 days')::text);
select tests.put('s_live', tests.make_session(now() - interval '30 minutes')::text);
select tests.as_user('A');
select tests.put('b_future', public.book_session(tests.v('s_future'), gen_random_uuid())->>'booking_id');
select tests.as_postgres();
select tests.put('b_live', tests.make_booking('A', tests.v('s_live'), tests.v('gA'))::text);
update public.credit_grants set valid_from = now() - interval '40 days', expires_at = now() - interval '10 minutes'
 where id = tests.v('gA');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 3,
  'setup: gA has 3 unused credits and 2 held by confirmed bookings');
-- B: one pack that expired 1 minute ago (inside the 5-minute grace) and one valid until tomorrow.
select tests.put('gB_grace', tests.make_grant('B', 3, now() - interval '1 minute', now() - interval '30 days')::text);
select tests.put('gB_valid', tests.make_grant('B', 2, now() + interval '1 day')::text);
-- C: an expired pack that was fully used (nothing left to expire).
select tests.put('gC_used', tests.make_grant('C', 1, now() - interval '1 day', now() - interval '30 days')::text);
select tests.put('s_old', tests.make_session(now() - interval '5 days')::text);
select tests.make_booking('C', tests.v('s_old'), tests.v('gC_used'));
-- D: an expired pack never used.
select tests.put('gD', tests.make_grant('D', 4, now() - interval '2 days', now() - interval '40 days')::text);

-- Privileges: a system job, never reachable through the Data API ---------------------------------------
select ok(not has_function_privilege('anon', 'private.expire_credit_grants(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'private.expire_credit_grants(timestamptz)', 'execute')
          and not has_function_privilege('service_role', 'private.expire_credit_grants(timestamptz)', 'execute'),
  'D10 expire_credit_grants: no EXECUTE for anon, authenticated or service_role');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
            where p.oid = 'private.expire_credit_grants(timestamptz)'::regprocedure),
  'D10 expire_credit_grants: SECURITY DEFINER with search_path = ''''');
select tests.as_user('staff');
select throws_ok('select private.expire_credit_grants()', '42501', null, 'D10 staff cannot run the job through the API');
select tests.as_postgres();

-- First run ------------------------------------------------------------------------------------------
select tests.put('run1', private.expire_credit_grants()::text);
select is(current_setting('tests.run1')::int, 2, 'D10 first run expires exactly the two due packs (gA, gD)');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 0, 'D10 gA unused credits → 0');
select results_eq(
  format('select delta, actor_id, note, booking_id from public.credit_ledger where grant_id = %L and reason = %L',
         tests.v('gA'), 'expiry'),
  $$values (-3, null::uuid, null::text, null::uuid)$$,
  'D10 gA: one expiry row, delta −3 (unused only), system actor, no note');
select is((select credits_remaining from public.credit_grants where id = tests.v('gD')), 0, 'D10 gD unused credits → 0');
select is((select delta from public.credit_ledger where grant_id = tests.v('gD') and reason = 'expiry'), -4,
  'D10 gD: one expiry row, delta −4');
select is((select count(*) from public.credit_ledger where grant_id = tests.v('gC_used') and reason = 'expiry'), 0::bigint,
  'D10 a fully used expired pack gets no expiry row (delta must be ≠ 0)');

-- Not yet due: untouched ------------------------------------------------------------------------------
select is((select credits_remaining from public.credit_grants where id = tests.v('gA2')), 2, 'D10 valid pack gA2 untouched');
select is((select credits_remaining from public.credit_grants where id = tests.v('gB_valid')), 2, 'D10 valid pack gB_valid untouched');
select is((select credits_remaining from public.credit_grants where id = tests.v('gB_grace')), 3,
  'D10 a pack expired < 5 minutes ago is left for the next run (grace)');
select is((select count(*) from public.credit_ledger
            where grant_id in (tests.v('gA2'), tests.v('gB_valid'), tests.v('gB_grace')) and reason = 'expiry'), 0::bigint,
  'D10 no expiry row for packs not yet due');
select is(private.usable_balance(tests.uid('B')), 2, 'D10 lazy expiry: the grace pack already does not count for B');

-- p_now can only move the cut-off earlier: a future p_now never expires a valid pack.
select is(private.expire_credit_grants(now() + interval '400 days'), 0, 'D10 a future p_now expires nothing new');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA2')), 2,
  'D10 future p_now: valid pack gA2 still untouched');
select is(private.expire_credit_grants(now() - interval '3 days'), 0, 'D10 an earlier p_now is a narrower cut-off');

-- Idempotent ------------------------------------------------------------------------------------------
select is(private.expire_credit_grants(), 0, 'D10 second run expires nothing');
select is((select count(*) from public.credit_ledger where grant_id in (tests.v('gA'), tests.v('gD')) and reason = 'expiry'),
  2::bigint, 'D10 second run: still exactly one expiry row per pack');
select throws_ok(
  format('insert into public.credit_ledger (user_id, grant_id, reason, delta) values (%L, %L, %L, -1)',
         tests.uid('A'), tests.v('gA'), 'expiry'),
  '23505', null, 'D10 a second expiry row for the same pack is impossible (unique index)');

-- Ledger explains every credit ------------------------------------------------------------------------
select is((select sum(delta)::int from public.credit_ledger where user_id = tests.uid('A')), private.usable_balance(tests.uid('A')),
  'D10 A: Σ ledger = usable balance (2)');
select is((select coalesce(sum(delta), 0)::int from public.credit_ledger where user_id = tests.uid('C')),
  private.usable_balance(tests.uid('C')), 'D10 C: Σ ledger = usable balance (0)');
select is((select sum(delta)::int from public.credit_ledger where user_id = tests.uid('D')), private.usable_balance(tests.uid('D')),
  'D10 D: Σ ledger = usable balance (0)');
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D10 I6: every pack remaining = Σ its ledger after expiry');

-- Bookings on an expired pack stay confirmed ----------------------------------------------------------
select results_eq(
  format('select id, status, credits_debited from public.bookings where id in (%L, %L) order by id',
         tests.v('b_future'), tests.v('b_live')),
  format('select id, %L::text, 1 from (values (%L::uuid), (%L::uuid)) v(id) order by id',
         'confirmed', tests.v('b_future'), tests.v('b_live')),
  'D10 confirmed bookings paid by the expired pack stay confirmed and debited');
select is((select confirmed_count from public.sessions where id = tests.v('s_future')), 1,
  'D10 the upcoming session keeps its booking');

-- A cancel after expiry refunds nothing and keeps every constraint ------------------------------------
select tests.as_user('A');
select tests.put('c_future', public.cancel_booking(tests.v('b_future'), gen_random_uuid())::text);
select is(tests.j('c_future')->>'status', 'cancelled', 'D10 student in-window cancel after expiry → cancelled');
select is(tests.j('c_future')->>'refunded', 'false', 'D10 student cancel after expiry → refunded false');
select tests.as_user('staff');
select tests.put('c_live', public.admin_cancel_for(tests.v('b_live'))::text);
select is(tests.j('c_live')->>'ok', 'true', 'D10 admin_cancel_for after expiry → ok');
select is(tests.j('c_live')->>'refund_skipped', 'true', 'D10 admin_cancel_for after expiry → refund_skipped');
select tests.as_postgres();
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 0,
  'D10 expired pack stays at 0 after both cancels');
select is((select count(*) from public.credit_ledger where grant_id = tests.v('gA') and reason = 'cancel_refund'), 0::bigint,
  'D10 no refund row into an expired pack');
select is((select sum(delta)::int from public.credit_ledger where user_id = tests.uid('A')), private.usable_balance(tests.uid('A')),
  'D10 A after cancels: Σ ledger = usable balance');

-- Schedule (pg_cron is bundled with the local stack) --------------------------------------------------
select results_eq(
  $$select schedule, command, active from cron.job where jobname = 'expire-credit-grants'$$,
  $$values ('7 * * * *'::text, 'select private.expire_credit_grants()'::text, true)$$,
  'D10 pg_cron runs expire_credit_grants hourly (one job)');

select * from finish();
rollback;
