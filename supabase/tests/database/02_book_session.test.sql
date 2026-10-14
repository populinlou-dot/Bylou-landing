-- Journeys A, B1, C (sequential) for book_session (DATA_MODEL §6.1, §12).
-- now() is fixed for the whole transaction, so "exactly at the boundary" cases are exact.
-- Domain semantics: opens inclusive, closes exclusive, grant invalid AT expires_at.
begin;
\ir _helpers.inc
select plan(42);

select tests.setup_people();
select tests.put('gA', tests.make_grant('A', 10, now() + interval '40 days')::text);
select tests.put('gB', tests.make_grant('B', 10, now() + interval '40 days')::text);
select tests.put('s1', tests.make_session(now() + interval '2 days', 5)::text);
select tests.put('s2', tests.make_session(now() + interval '3 days', 5)::text);

-- A1 happy path ------------------------------------------------------------------------
select tests.as_user('A');
select tests.put('r1', public.book_session(tests.v('s1'), 'aaaaaaaa-0000-4000-8000-000000000001')::text);
select is(tests.j('r1')->>'ok', 'true', 'A1 ok');
select ok(tests.j('r1')->'code' = 'null'::jsonb, 'A1 code null');
select is(tests.j('r1')->>'status', 'confirmed', 'A1 status confirmed');
select is(tests.j('r1')->>'replayed', 'false', 'A1 not a replay');
select is((tests.j('r1')->>'spots_left')::int, 4, 'A1 spots_left = capacity - 1');
select is((tests.j('r1')->>'credits_debited')::int, 1, 'A1 one credit debited');
select is((tests.j('r1')->>'remaining_credits')::int, 9, 'A1 remaining_credits = 9');
select tests.as_postgres();
select is((select count(*) from public.bookings where session_id = tests.v('s1') and status = 'confirmed'), 1::bigint,
  'A1 one confirmed booking');
select is((select credit_grant_id from public.bookings where id = (tests.j('r1')->>'booking_id')::uuid), tests.v('gA'),
  'A1 booking linked to the debited grant');
select is((select count(*) from public.credit_ledger where booking_id = (tests.j('r1')->>'booking_id')::uuid
            and reason = 'booking_debit' and delta = -1), 1::bigint, 'A1 one booking_debit ledger row');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 9, 'A1 grant −1');
select is((select confirmed_count from public.sessions where id = tests.v('s1')), 1, 'A1 confirmed_count +1');

-- C1 same key, sequential replay ----------------------------------------------------------
select tests.as_user('A');
select tests.put('r2', public.book_session(tests.v('s1'), 'aaaaaaaa-0000-4000-8000-000000000001')::text);
select is(tests.j('r2')->>'replayed', 'true', 'C1 replayed: true');
select is(tests.j('r2')->>'booking_id', tests.j('r1')->>'booking_id', 'C1 same booking_id');
select tests.as_postgres();
select is((select count(*) from public.credit_ledger where user_id = tests.uid('A') and reason = 'booking_debit'), 1::bigint,
  'C1 still exactly one debit');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 9, 'C1 grant debited once');

-- C3 different key, same session → already_booked ---------------------------------------
select tests.as_user('A');
select tests.put('r3', public.book_session(tests.v('s1'), gen_random_uuid())::text);
select is(tests.j('r3')->>'code', 'already_booked', 'C3 already_booked');
select is(tests.j('r3')->>'booking_id', tests.j('r1')->>'booking_id', 'C3 points to the existing booking');

-- C4 same key, different session → invalid_input (22023), no writes -------------------------
select throws_ok(format('select public.book_session(%L, %L)', tests.v('s2'), 'aaaaaaaa-0000-4000-8000-000000000001'),
  '22023', null, 'C4 key reused for another session → 22023');
select tests.as_postgres();
select is((select count(*) from public.bookings where session_id = tests.v('s2')), 0::bigint, 'C4 no booking written');

-- A2 booking window edges --------------------------------------------------------------------
select tests.put('s_open',     tests.make_session(now() + interval '30 days')::text);
select tests.put('s_notopen',  tests.make_session(now() + interval '30 days 1 second')::text);
select tests.put('s_started',  tests.make_session(now())::text);
select tests.put('s_past',     tests.make_session(now() - interval '1 hour')::text);
select tests.put('s_cancel',   tests.make_session(now() + interval '1 day')::text);
update public.sessions set status = 'cancelled', cancelled_at = now() where id = tests.v('s_cancel');
select tests.put('s_unpub',    tests.make_session(now() + interval '1 day', 5, false)::text);
select tests.put('s_close_at', tests.make_session(now() + interval '60 minutes')::text);
select tests.put('s_close_ok', tests.make_session(now() + interval '60 minutes 1 second')::text);

select tests.as_user('A');
select is(public.book_session(tests.v('s_open'), gen_random_uuid())->>'ok', 'true',
  'A2 bookable exactly when the window opens (inclusive)');
select tests.put('r4', public.book_session(tests.v('s_notopen'), gen_random_uuid())::text);
select is(tests.j('r4')->>'code', 'booking_not_open', 'A2 one second before opening → booking_not_open');
select ok((tests.j('r4')->>'opens_at')::timestamptz = now() + interval '1 second', 'A2 opens_at returned');
select is(public.book_session(tests.v('s_started'), gen_random_uuid())->>'code', 'session_started',
  'A2 exactly at start → session_started');
select is(public.book_session(tests.v('s_past'), gen_random_uuid())->>'code', 'session_started', 'A2 past → session_started');
select is(public.book_session(tests.v('s_cancel'), gen_random_uuid())->>'code', 'session_cancelled', 'A2 session_cancelled');
select is(public.book_session(tests.v('s_unpub'), gen_random_uuid())->>'code', 'not_found', 'A2 unpublished → not_found');
select is(public.book_session(gen_random_uuid(), gen_random_uuid())->>'code', 'not_found', 'A2 unknown id → not_found');
select tests.as_postgres();
update public.studio_settings set booking_closes_minutes = 60 where id = 1;
select tests.as_user('A');
select is(public.book_session(tests.v('s_close_at'), gen_random_uuid())->>'code', 'booking_closed',
  'A2 exactly at close → booking_closed (exclusive)');
select is(public.book_session(tests.v('s_close_ok'), gen_random_uuid())->>'ok', 'true',
  'A2 one second before close → ok');
select tests.as_postgres();
update public.studio_settings set booking_closes_minutes = 0 where id = 1;
select is((select count(*) from public.bookings
            where session_id in (tests.v('s_notopen'), tests.v('s_started'), tests.v('s_past'), tests.v('s_cancel'),
                                 tests.v('s_unpub'), tests.v('s_close_at'))), 0::bigint,
  'A2 rejections write nothing');

-- A3 grant selection --------------------------------------------------------------------------
-- C: short (expires before the session), mid, long → mid is used.
select tests.put('s_a3', tests.make_session(now() + interval '5 days')::text);
select tests.put('gC_short', tests.make_grant('C', 3, now() + interval '3 days')::text);
select tests.put('gC_long',  tests.make_grant('C', 3, now() + interval '20 days')::text);
select tests.put('gC_mid',   tests.make_grant('C', 3, now() + interval '10 days')::text);
select tests.as_user('C');
select tests.put('r5', public.book_session(tests.v('s_a3'), gen_random_uuid())::text);
select tests.as_postgres();
select is((select credit_grant_id from public.bookings where id = (tests.j('r5')->>'booking_id')::uuid), tests.v('gC_mid'),
  'A3 earliest-expiring grant still valid at session start is consumed');
-- D: only a grant expiring exactly at the session start (invalid AT expires_at) → no_valid_credit.
select tests.put('s_a3b', tests.make_session(now() + interval '5 days')::text);
select tests.make_grant('D', 3, now() + interval '5 days');
select tests.as_user('D');
select is(public.book_session(tests.v('s_a3b'), gen_random_uuid())->>'code', 'no_valid_credit',
  'A3 grant expiring exactly at session start is not usable');
select tests.as_postgres();
select tests.make_grant('D', 3, now() + interval '3 days');
select tests.as_user('D');
select is(public.book_session(tests.v('s_a3b'), gen_random_uuid())->>'code', 'no_valid_credit',
  'A3 only short grants → no_valid_credit');
select tests.as_postgres();
-- Exhausted and not-yet-valid grants are ignored.
update public.credit_grants set credits_remaining = 0 where user_id = tests.uid('D');
select tests.make_grant('D', 2, now() + interval '20 days', now() + interval '1 minute');
-- (zeroing above breaks I6 on purpose for D only; restored below via ledger-consistent recompute)
select tests.as_user('D');
select is(public.book_session(tests.v('s_a3b'), gen_random_uuid())->>'code', 'no_valid_credit',
  'A3 exhausted or future grants → no_valid_credit');
select tests.as_postgres();
update public.credit_grants g set credits_remaining = (select sum(l.delta) from public.credit_ledger l where l.grant_id = g.id)
 where g.user_id = tests.uid('D');

-- B1 capacity 1: A books, then B → session_full ----------------------------------------------
select tests.put('s_b1', tests.make_session(now() + interval '1 day', 1)::text);
select tests.as_user('A');
select is(public.book_session(tests.v('s_b1'), gen_random_uuid())->>'ok', 'true', 'B1 A takes the only spot');
select tests.as_user('B');
select is(public.book_session(tests.v('s_b1'), gen_random_uuid())->>'code', 'session_full', 'B1 B → session_full');
select tests.as_postgres();
select is((select confirmed_count from public.sessions where id = tests.v('s_b1')), 1, 'B1 count stays 1');
select is((select credits_remaining from public.credit_grants where id = tests.v('gB')), 10, 'B1 B not debited');

-- Session available to anon reflects the counter.
select tests.as_anon();
select is((select spots_left from public.session_availability where id = tests.v('s_b1')), 0, 'B1 spots_left 0 for anon');
select tests.as_postgres();

-- D8 reconciliation -----------------------------------------------------------------------------
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D8 grants reconcile with ledger');
select is(tests.session_count_mismatches(), 0::bigint, 'D8 counters reconcile with bookings');

select * from finish();
rollback;
