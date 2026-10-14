-- Phase 4.4 waitlist (PRD ST-12, ADR-011 / ADR-021) + required display name. Migration 20261014001300_waitlist.
--   W0  structure, flag, privileges          W1  join rules and refusals          W2  FIFO + skip no credit + debit once
--   W3  inside the cancellation window       W4  capacity increase promotes       W5  skip already booked
--   W6  flag off                             W7  session cancel closes entries    W8  leave / rejoin / churn guard
--   W9  required display name                W10 anonymization closes entries     W11 RLS / privileges
-- now() is fixed for the whole transaction; entries take clock_timestamp(), so join order = statement order.
begin;
\ir _helpers.inc
select plan(138);

select tests.setup_people();
-- Two more students (E, F) with names, like every fixture student.
select tests.create_user('f0000000-0000-4000-8000-00000000000e', 'test-e@example.test');
select tests.create_user('f0000000-0000-4000-8000-00000000000f', 'test-f@example.test');
create function tests.as_id(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function tests.as_id(uuid) to anon, authenticated;
select tests.put('E', 'f0000000-0000-4000-8000-00000000000e');
select tests.put('F', 'f0000000-0000-4000-8000-00000000000f');

select tests.put('gA', tests.make_grant('A', 10, now() + interval '60 days')::text);
select tests.put('gB', tests.make_grant('B', 10, now() + interval '60 days')::text);
select tests.put('gC', tests.make_grant('C', 10, now() + interval '60 days')::text);
-- D: no pack at all. E: a pack.
insert into public.credit_grants (user_id, credits_total, credits_remaining, valid_from, expires_at, granted_by, idempotency_key)
values (tests.v('E'), 10, 10, now() - interval '1 day', now() + interval '60 days', tests.uid('staff'), gen_random_uuid());
insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id)
select user_id, id, 'grant', 10, tests.uid('staff') from public.credit_grants where user_id = tests.v('E');

-- W0 structure, flag, privileges ---------------------------------------------------------------------------------
select has_table('public', 'waitlist_entries', 'W0 table waitlist_entries exists');
select ok((select relrowsecurity from pg_class where oid = 'public.waitlist_entries'::regclass), 'W0 RLS enabled');
select has_index('public', 'waitlist_entries', 'waitlist_one_waiting', 'W0 one waiting entry per student per session');
select is((select waitlist_enabled from public.studio_settings where id = 1), true, 'W0 Bylou has the waitlist on');
select ok(not has_table_privilege('anon', 'public.waitlist_entries', 'SELECT'), 'W0 anon cannot read entries');
select ok(has_table_privilege('authenticated', 'public.waitlist_entries', 'SELECT')
          and not has_table_privilege('authenticated', 'public.waitlist_entries', 'INSERT')
          and not has_table_privilege('authenticated', 'public.waitlist_entries', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.waitlist_entries', 'DELETE'),
  'W0 authenticated may only SELECT (RPCs are the write path)');
select ok(not has_function_privilege('anon', 'public.join_waitlist(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.leave_waitlist(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.my_waitlist_entries()', 'execute'),
  'W0 anon cannot execute the waitlist RPCs');
select ok(not has_function_privilege('authenticated', 'private.promote_waitlist_locked(uuid, uuid[])', 'execute')
          and not has_function_privilege('authenticated', 'private.lock_for_promotion(uuid, timestamptz, uuid[], boolean)', 'execute'),
  'W0 promotion helpers are not callable through the API');
select ok(exists (select 1 from pg_constraint
                   where conname = 'waitlist_entries_user_id_fkey' and conrelid = 'public.waitlist_entries'::regclass),
  'W0 FK name the staff waitlist embed depends on (profiles!waitlist_entries_user_id_fkey)');

-- Sessions ------------------------------------------------------------------------------------------------------------
select tests.put('s1', tests.make_session(now() + interval '3 days', 2)::text);   -- main FIFO scenario
select tests.put('s2', tests.make_session(now() + interval '10 hours', 1)::text); -- inside the 24 h window
select tests.put('s3', tests.make_session(now() + interval '30 hours', 1)::text); -- window set to 48 h later
select tests.put('s4', tests.make_session(now() + interval '4 days', 1)::text);   -- capacity increase
select tests.put('s5', tests.make_session(now() + interval '5 days', 1)::text);   -- skip already booked
select tests.put('s6', tests.make_session(now() + interval '6 days', 1)::text);   -- flag off, then session cancel
select tests.put('s7', tests.make_session(now() + interval '7 days', 1)::text);   -- leave / rejoin
select tests.put('s8', tests.make_session(now() + interval '8 days', 1)::text);   -- anonymization
select tests.put('s_open', tests.make_session(now() + interval '9 days', 5)::text);
select tests.put('s_past', tests.make_session(now() - interval '2 hours', 1)::text);
select tests.put('s_cxl', tests.make_session(now() + interval '9 days', 1)::text);
update public.sessions set status = 'cancelled', cancelled_at = now() where id = tests.v('s_cxl');

-- W1 join rules ---------------------------------------------------------------------------------------------------------
select tests.as_user('A');
select is(public.join_waitlist(tests.v('s_open'), gen_random_uuid())->>'code', 'session_not_full', 'W1 not full → session_not_full');
select is(public.join_waitlist(tests.v('s_cxl'), gen_random_uuid())->>'code', 'session_cancelled', 'W1 cancelled session → session_cancelled');
select is(public.join_waitlist(tests.v('s_past'), gen_random_uuid())->>'code', 'session_started', 'W1 started session → session_started');
select is(public.join_waitlist(gen_random_uuid(), gen_random_uuid())->>'code', 'not_found', 'W1 unknown session → not_found');
select is(public.join_waitlist(tests.v('s2'), gen_random_uuid())->>'code', 'waitlist_closed',
  'W1 inside the cancellation window → waitlist_closed (nobody could be promoted)');
select throws_ok(format('select public.join_waitlist(%L, null)', tests.v('s1')), '22023', null, 'W1 null key → invalid_input');
select tests.as_postgres();
select is((select count(*) from public.waitlist_entries w where w.user_id in (tests.uid('A'), tests.uid('B'), tests.uid('C'), tests.uid('D'), tests.v('E'), tests.v('F'))), 0::bigint, 'W1 refusals wrote nothing');

-- Fill s1 (capacity 2) with C and E.
select tests.as_user('C');
select tests.put('bC1', public.book_session(tests.v('s1'), gen_random_uuid())->>'booking_id');
select tests.as_id(tests.v('E'));
select tests.put('bE1', public.book_session(tests.v('s1'), gen_random_uuid())->>'booking_id');
select tests.as_user('C');
select is(public.join_waitlist(tests.v('s1'), gen_random_uuid())->>'code', 'already_booked', 'W1 she holds a booking → already_booked');

-- W2 FIFO: D (no pack) → A → B --------------------------------------------------------------------------------------------
select tests.as_user('D');
select tests.put('jD', public.join_waitlist(tests.v('s1'), 'dddd0000-0000-4000-8000-000000000001')::text);
select is(tests.j('jD')->>'ok', 'true', 'W2 D joins the full session');
select is((tests.j('jD')->>'position')::int, 1, 'W2 D is 1st');
select tests.as_user('A');
select tests.put('jA', public.join_waitlist(tests.v('s1'), 'aaaa0000-0000-4000-8000-000000000001')::text);
select is((tests.j('jA')->>'position')::int, 2, 'W2 A is 2nd');
select is(tests.j('jA')->>'replayed', 'false', 'W2 first join is not a replay');
select tests.put('jA2', public.join_waitlist(tests.v('s1'), 'aaaa0000-0000-4000-8000-000000000001')::text);
select is(tests.j('jA2')->>'replayed', 'true', 'W2 same key → replayed');
select is(tests.j('jA2')->>'entry_id', tests.j('jA')->>'entry_id', 'W2 same key → same entry');
select tests.put('jA3', public.join_waitlist(tests.v('s1'), gen_random_uuid())::text);
select is(tests.j('jA3')->>'entry_id', tests.j('jA')->>'entry_id', 'W2 another key while waiting → her existing entry');
select throws_ok(format('select public.join_waitlist(%L, %L)', tests.v('s7'), 'aaaa0000-0000-4000-8000-000000000001'),
  '22023', null, 'W2 key reused for another session → invalid_input');
select is(public.book_session(tests.v('s1'), gen_random_uuid())->>'code', 'session_full', 'W2 waiting does not book');
select tests.as_user('B');
select is((public.join_waitlist(tests.v('s1'), gen_random_uuid())->>'position')::int, 3, 'W2 B is 3rd');
select tests.as_postgres();
select is((select count(*) from public.waitlist_entries where session_id = tests.v('s1')), 3::bigint, 'W2 one entry per student');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('A') and reason = 'booking_debit'), 0::bigint,
  'W2 joining debits nothing');

-- My own read: position while waiting.
select tests.as_user('B');
select tests.put('mineB', public.my_waitlist_entries()::text);
select is(jsonb_array_length(tests.j('mineB')->'entries'), 1, 'W2 my_waitlist_entries lists only her entries');
select is((tests.j('mineB')->'entries'->0->>'position')::int, 3, 'W2 my_waitlist_entries shows her place');
select is(tests.j('mineB')->'entries'->0->'session'->>'id', tests.v('s1')::text, 'W2 entry carries its session');

-- C cancels (> 24 h ahead): D is skipped (no pack), A is promoted, B moves up.
select tests.as_user('C');
select tests.put('cC', public.cancel_booking(tests.v('bC1'))::text);
select is(tests.j('cC')->>'refunded', 'true', 'W2 the canceller is refunded');
select tests.as_postgres();
select is((select status || '/' || skip_reason from public.waitlist_entries where id = (tests.j('jD')->>'entry_id')::uuid),
  'skipped/no_valid_credit', 'W2 D without a pack is skipped');
select is((select status from public.waitlist_entries where id = (tests.j('jA')->>'entry_id')::uuid), 'promoted', 'W2 A is promoted');
select tests.put('bA', (select promoted_booking_id::text from public.waitlist_entries where id = (tests.j('jA')->>'entry_id')::uuid));
select results_eq(
  format('select status, source, credit_grant_id, credits_debited, created_by, idempotency_key <> %L from public.bookings where id = %L',
         tests.j('jA')->>'entry_id', tests.v('bA')),
  format('values (%L::text, %L::text, %L::uuid, 1, %L::uuid, true)', 'confirmed', 'waitlist', tests.v('gA'), tests.uid('A')),
  'W2 promoted booking: confirmed, source waitlist, earliest pack, created_by the student, random key');
select results_eq(format('select delta, actor_id is null from public.credit_ledger where booking_id = %L and reason = ''booking_debit''', tests.v('bA')),
  $$values (-1, true)$$, 'W2 exactly one debit for the promoted booking, by the system');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 9, 'W2 A''s pack debited once');
select is((select confirmed_count from public.sessions where id = tests.v('s1')), 2, 'W2 the freed spot was refilled (count = capacity)');
select tests.as_user('B');
select is((public.my_waitlist_entries()->'entries'->0->>'position')::int, 1, 'W2 B moves up to 1st');
select tests.as_user('A');
select tests.put('mineA', public.my_waitlist_entries()::text);
select is(tests.j('mineA')->'entries'->0->>'status', 'promoted', 'W2 A sees her entry promoted');
select is(tests.j('mineA')->'entries'->0->>'booking_id', tests.v('bA')::text, 'W2 A sees the promoted booking id');
select ok(tests.j('mineA')->'entries'->0->'position' = 'null'::jsonb, 'W2 a resolved entry has no place');
select is(public.leave_waitlist(tests.v('s1'))->>'status', 'promoted', 'W2 leaving after promotion → tells her she was promoted');
-- Replay of the cancellation promotes nobody else.
select tests.as_user('C');
select is(public.cancel_booking(tests.v('bC1'))->>'replayed', 'true', 'W2 cancel replay');
select tests.as_postgres();
select is((select count(*) from public.bookings where session_id = tests.v('s1') and source = 'waitlist'), 1::bigint,
  'W2 a replayed cancel promotes nobody else');
-- E cancels: B is promoted.
select tests.as_id(tests.v('E'));
select public.cancel_booking(tests.v('bE1'));
select tests.as_postgres();
select is((select status from public.waitlist_entries where session_id = tests.v('s1') and user_id = tests.uid('B')), 'promoted',
  'W2 next cancellation promotes B');
select is((select count(*) from public.waitlist_entries where session_id = tests.v('s1') and status = 'waiting'), 0::bigint,
  'W2 nobody left waiting');
select is((select confirmed_count from public.sessions where id = tests.v('s1')), 2, 'W2 never over capacity');

-- W3 inside the cancellation window ---------------------------------------------------------------------------------------
-- s2 starts in 10 h: entries can only exist from before the window (fixture insert), promotion must not happen.
select tests.as_user('C');
select tests.put('bC2', public.book_session(tests.v('s2'), gen_random_uuid())->>'booking_id');
select tests.as_postgres();
insert into public.waitlist_entries (session_id, user_id, request_key, created_at)
values (tests.v('s2'), tests.uid('B'), gen_random_uuid(), now() - interval '2 days');
select tests.as_user('staff');
select tests.put('cfC2', public.admin_cancel_for(tests.v('bC2'))::text);
select is((tests.j('cfC2')->>'promoted')::int, 0, 'W3 inside the window nobody is promoted');
select tests.as_postgres();
select is((select status from public.waitlist_entries where session_id = tests.v('s2')), 'waiting', 'W3 her entry stays waiting');
select is((select confirmed_count from public.sessions where id = tests.v('s2')), 0, 'W3 the spot stays open');
select tests.as_user('B');
select is(public.book_session(tests.v('s2'), gen_random_uuid())->>'ok', 'true', 'W3 the open spot is bookable first-come');
select tests.as_postgres();
select is((select status || '/' || close_reason from public.waitlist_entries where session_id = tests.v('s2')), 'closed/booked',
  'W3 booking directly closes her own waiting entry');

-- s3 starts in 30 h: open with a 24 h window, closed once the studio sets 48 h (the setting, not a constant).
select tests.as_user('C');
select tests.put('bC3', public.book_session(tests.v('s3'), gen_random_uuid())->>'booking_id');
select tests.as_user('A');
select is(public.join_waitlist(tests.v('s3'), gen_random_uuid())->>'ok', 'true', 'W3 30 h ahead with a 24 h window → join ok');
select tests.as_postgres();
update public.studio_settings set cancellation_window_hours = 48 where id = 1;
select tests.as_user('B');
select is(public.join_waitlist(tests.v('s3'), gen_random_uuid())->>'code', 'waitlist_closed', 'W3 window 48 h → join closed');
select tests.as_user('staff');
select is((public.admin_cancel_for(tests.v('bC3'))->>'promoted')::int, 0, 'W3 window 48 h → no promotion at 30 h');
select tests.as_postgres();
update public.studio_settings set cancellation_window_hours = 24 where id = 1;
select is((select status from public.waitlist_entries where session_id = tests.v('s3') and user_id = tests.uid('A')), 'waiting',
  'W3 entry still waiting');

-- W4 capacity increase promotes in FIFO order ---------------------------------------------------------------------------------
select tests.as_user('C');
select public.book_session(tests.v('s4'), gen_random_uuid());
select tests.as_user('A');
select tests.put('j4A', public.join_waitlist(tests.v('s4'), gen_random_uuid())::text);
select tests.as_user('B');
select tests.put('j4B', public.join_waitlist(tests.v('s4'), gen_random_uuid())::text);
select tests.as_id(tests.v('E'));
select tests.put('j4E', public.join_waitlist(tests.v('s4'), gen_random_uuid())::text);
select tests.as_user('staff');
select tests.put('u4', public.admin_update_session(tests.v('s4'), 3)::text);
select is((tests.j('u4')->>'promoted')::int, 2, 'W4 +2 spots → 2 promoted');
select is((tests.j('u4')->>'confirmed_count')::int, 3, 'W4 answer carries the count after promotion');
select tests.as_postgres();
select results_eq(format('select user_id, status from public.waitlist_entries where session_id = %L order by created_at', tests.v('s4')),
  format('values (%L::uuid, %L::text), (%L::uuid, %L::text), (%L::uuid, %L::text)',
         tests.uid('A'), 'promoted', tests.uid('B'), 'promoted', tests.v('E'), 'waiting'),
  'W4 the first two in line are promoted, the third keeps waiting');
select tests.as_user('staff');
select is((public.admin_update_session(tests.v('s4'), 3)->>'promoted')::int, 0, 'W4 same capacity again → no change, no promotion');
select is(public.admin_update_session(tests.v('s4'), 2)->>'code', 'capacity_below_bookings', 'W4 cannot go below bookings');

-- W5 a waiting student who already holds a booking is skipped -----------------------------------------------------------------
select tests.as_user('C');
select tests.put('bC5', public.book_session(tests.v('s5'), gen_random_uuid())->>'booking_id');
select tests.as_user('A');
select tests.put('j5A', public.join_waitlist(tests.v('s5'), gen_random_uuid())::text);
select tests.as_user('B');
select tests.put('j5B', public.join_waitlist(tests.v('s5'), gen_random_uuid())::text);
-- Fixture: A also holds a confirmed booking (state no RPC path produces; the guard must still hold).
select tests.as_postgres();
update public.sessions set capacity = 2 where id = tests.v('s5');
select tests.make_booking('A', tests.v('s5'), tests.v('gA'));
select tests.as_user('C');
select public.cancel_booking(tests.v('bC5'));
select tests.as_postgres();
select is((select status || '/' || skip_reason from public.waitlist_entries where id = (tests.j('j5A')->>'entry_id')::uuid),
  'skipped/already_booked', 'W5 already booked → skipped');
select is((select status from public.waitlist_entries where id = (tests.j('j5B')->>'entry_id')::uuid), 'promoted', 'W5 next in line promoted');
select is((select count(*) from public.bookings where session_id = tests.v('s5') and user_id = tests.uid('A') and status = 'confirmed'),
  1::bigint, 'W5 never two active bookings');

-- W6 flag off ----------------------------------------------------------------------------------------------------------------
select tests.as_user('C');
select tests.put('bC6', public.book_session(tests.v('s6'), gen_random_uuid())->>'booking_id');
select tests.as_user('A');
select tests.put('j6A', public.join_waitlist(tests.v('s6'), gen_random_uuid())::text);
select tests.as_postgres();
update public.studio_settings set waitlist_enabled = false where id = 1;
select tests.as_user('B');
select is(public.join_waitlist(tests.v('s6'), gen_random_uuid())->>'code', 'waitlist_disabled', 'W6 off → join refused');
select tests.as_user('A');
select is(public.leave_waitlist(tests.v('s6'))->>'code', 'waitlist_disabled', 'W6 off → leave refused');
select is(public.my_waitlist_entries()->>'enabled', 'false', 'W6 off → read says disabled');
select is(jsonb_array_length(public.my_waitlist_entries()->'entries'), 0, 'W6 off → no entries');
select tests.as_user('C');
select public.cancel_booking(tests.v('bC6'));
select tests.as_postgres();
select is((select status from public.waitlist_entries where id = (tests.j('j6A')->>'entry_id')::uuid), 'waiting', 'W6 off → nobody promoted');
select is((select confirmed_count from public.sessions where id = tests.v('s6')), 0, 'W6 off → spot stays open');
update public.studio_settings set waitlist_enabled = true where id = 1;

-- W7 session cancel closes waiting entries --------------------------------------------------------------------------------------
select tests.as_user('C');
select public.book_session(tests.v('s6'), gen_random_uuid());
select tests.as_user('B');
select public.join_waitlist(tests.v('s6'), gen_random_uuid());
select tests.as_user('staff');
select tests.put('x6', public.admin_cancel_session(tests.v('s6'), 'W7')::text);
select is((tests.j('x6')->>'waitlist_closed')::int, 2, 'W7 both waiting entries closed');
select tests.as_postgres();
select is((select array_agg(distinct status || '/' || close_reason) from public.waitlist_entries where session_id = tests.v('s6')),
  array['closed/session_cancelled'], 'W7 closed with reason session_cancelled');
select tests.as_user('staff');
select is((public.admin_cancel_session(tests.v('s6'))->>'waitlist_closed')::int, 0, 'W7 replay closes nothing more');

-- W8 leave / rejoin / churn guard -------------------------------------------------------------------------------------------------
select tests.as_user('C');
select public.book_session(tests.v('s7'), gen_random_uuid());
select tests.as_user('A');
select is(public.leave_waitlist(tests.v('s7'))->>'code', 'not_found', 'W8 leave without an entry → not_found');
select public.join_waitlist(tests.v('s7'), gen_random_uuid());
select tests.as_user('B');
select public.join_waitlist(tests.v('s7'), gen_random_uuid());
select tests.as_user('A');
select tests.put('l7', public.leave_waitlist(tests.v('s7'))::text);
select is(tests.j('l7')->>'status', 'left', 'W8 leave → left');
select is(tests.j('l7')->>'replayed', 'false', 'W8 first leave is not a replay');
select tests.put('l7b', public.leave_waitlist(tests.v('s7'))::text);
select is(tests.j('l7b')->>'replayed', 'true', 'W8 second leave → replayed');
select is(tests.j('l7b')->>'status', 'left', 'W8 second leave → still left');
select tests.as_user('B');
select is((public.my_waitlist_entries()->'entries'->0->>'position')::int, 1, 'W8 B moves up when A leaves');
select tests.as_user('A');
select is((public.join_waitlist(tests.v('s7'), gen_random_uuid())->>'position')::int, 2, 'W8 rejoining goes to the end');
select public.leave_waitlist(tests.v('s7'));
select is(public.join_waitlist(tests.v('s7'), gen_random_uuid())->>'ok', 'true', 'W8 3rd join of the same session in 24 h → ok');
select public.leave_waitlist(tests.v('s7'));
select is(public.join_waitlist(tests.v('s7'), gen_random_uuid())->>'code', 'too_many_changes',
  'W8 4th join of the same session in 24 h → too_many_changes');
select is(public.join_waitlist(tests.v('s7'), gen_random_uuid())->>'limit', 'waitlist_joins', 'W8 limit = waitlist_joins');
select tests.as_postgres();
select is((select count(*) from public.waitlist_entries where session_id = tests.v('s7') and user_id = tests.uid('A')), 3::bigint,
  'W8 the refusal wrote nothing');
select is((select count(*) from public.bookings where user_id = tests.uid('A') and session_id = tests.v('s7')), 0::bigint,
  'W8 joins never create bookings');

-- W9 required display name ---------------------------------------------------------------------------------------------------------
select tests.as_postgres();
update public.profiles set display_name = null where id = tests.uid('D');
select tests.as_user('D');
select is(public.book_session(tests.v('s_open'), gen_random_uuid())->>'code', 'profile_incomplete', 'W9 no name → book refused');
select is(public.join_waitlist(tests.v('s7'), gen_random_uuid())->>'code', 'profile_incomplete', 'W9 no name → join refused');
select throws_ok(format('update public.profiles set display_name = %L where id = %L', '   ', tests.uid('D')), '23514', null,
  'W9 a blank name cannot be stored (CHECK profiles_display_name_visible)');
select tests.as_postgres();
select is((select count(*) from public.bookings where user_id = tests.uid('D')), 0::bigint, 'W9 refusals wrote nothing');
update public.profiles set display_name = null where id = tests.v('E');
select tests.as_user('staff');
select is(public.admin_book_for(tests.v('E'), tests.v('s_open'), gen_random_uuid())->>'ok', 'true',
  'W9 staff can still book for a student without a name');
select tests.as_postgres();
update public.profiles set display_name = 'Dana' where id = tests.uid('D');
select tests.make_grant('D', 2, now() + interval '60 days');
select tests.as_user('D');
select is(public.book_session(tests.v('s_open'), gen_random_uuid())->>'ok', 'true', 'W9 with a name → book ok');

-- W10 anonymization closes her waiting entries ---------------------------------------------------------------------------------------
select tests.as_user('C');
select public.book_session(tests.v('s8'), gen_random_uuid());
select tests.as_id(tests.v('F'));
select tests.put('j8F', public.join_waitlist(tests.v('s8'), gen_random_uuid())::text);
select tests.as_user('staff');
select tests.put('anF', public.admin_anonymize_student(tests.v('F'), 'test-f@example.test')::text);
select is(tests.j('anF')->>'ok', 'true', 'W10 erasure ok');
select is((tests.j('anF')->>'waitlist_closed')::int, 1, 'W10 her waiting entry closed');
select tests.as_postgres();
select is((select status || '/' || close_reason from public.waitlist_entries where id = (tests.j('j8F')->>'entry_id')::uuid),
  'closed/account_erased', 'W10 closed with reason account_erased');
select tests.as_id(tests.v('F'));
select throws_ok(format('select public.join_waitlist(%L, gen_random_uuid())', tests.v('s8')), '42501', null,
  'W10 an erased student cannot join');

-- W11 RLS and privileges ------------------------------------------------------------------------------------------------------------
select tests.as_anon();
select throws_ok('select count(*) from public.waitlist_entries', '42501', null, 'W11 anon cannot read entries');
select throws_ok(format('select public.join_waitlist(%L, gen_random_uuid())', tests.v('s8')), '42501', null, 'W11 anon cannot join');
select tests.as_user('B');
select is((select count(*) from public.waitlist_entries where user_id <> tests.uid('B')), 0::bigint, 'W11 a student sees only her own entries');
select ok((select count(*) from public.waitlist_entries) > 0, 'W11 … and does see them');
select throws_ok(format('insert into public.waitlist_entries (session_id, user_id, request_key) values (%L, %L, gen_random_uuid())',
  tests.v('s8'), tests.uid('B')), '42501', null, 'W11 a student cannot insert entries');
select throws_ok('update public.waitlist_entries set status = ''left''', '42501', null, 'W11 a student cannot update entries');
select throws_ok('delete from public.waitlist_entries', '42501', null, 'W11 a student cannot delete entries');
select throws_ok(format('select private.promote_waitlist_locked(%L, ''{}''::uuid[])', tests.v('s8')), '42501', null,
  'W11 a student cannot run the promotion');
select tests.as_user('staff');
select is((select count(*) from public.waitlist_entries w where w.user_id in (tests.uid('A'), tests.uid('B'), tests.uid('C'), tests.uid('D'), tests.v('E'), tests.v('F'))), 17::bigint, 'W11 staff see every student''s entries');
select tests.as_postgres();
select is((select count(*) from public.waitlist_entries w where w.session_id in (tests.v('s1'), tests.v('s2'), tests.v('s3'), tests.v('s4'), tests.v('s5'), tests.v('s6'), tests.v('s7'), tests.v('s8'))), 17::bigint, 'W11 total fixture entries (sanity)');

-- W12 security-review fixes (HIGH-1, MEDIUM-1, LOW-1…6) -----------------------------------------------------------------
select tests.as_postgres();
select tests.create_user('f0000000-0000-4000-8000-000000000010', 'test-g@example.test');
select tests.create_user('f0000000-0000-4000-8000-000000000011', 'test-h@example.test');
select tests.create_user('f0000000-0000-4000-8000-000000000012', 'test-i@example.test');
select tests.put('G', 'f0000000-0000-4000-8000-000000000010');
select tests.put('H', 'f0000000-0000-4000-8000-000000000011');
select tests.put('I', 'f0000000-0000-4000-8000-000000000012');
create function tests.pack_for(p_user uuid, p_credits int) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.credit_grants (user_id, credits_total, credits_remaining, valid_from, expires_at, granted_by, idempotency_key)
  values (p_user, p_credits, p_credits, now() - interval '1 day', now() + interval '60 days', tests.uid('staff'), gen_random_uuid())
  returning id into v_id;
  insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id) values (p_user, v_id, 'grant', p_credits, tests.uid('staff'));
  return v_id;
end $$;
select tests.put('gG', tests.pack_for(tests.v('G'), 20)::text);
select tests.pack_for(tests.v('H'), 20);
select tests.pack_for(tests.v('I'), 20);

-- HIGH-1: she pre-uses her entry id as a book_session key elsewhere; the promotion must still go through.
select tests.put('s9', tests.make_session(now() + interval '5 days', 1)::text);
select tests.as_id(tests.v('H'));
select tests.put('bH9', public.book_session(tests.v('s9'), gen_random_uuid())->>'booking_id');
select tests.as_id(tests.v('G'));
select tests.put('j9', public.join_waitlist(tests.v('s9'), gen_random_uuid())::text);
select is(public.book_session(tests.v('s_open'), (tests.j('j9')->>'entry_id')::uuid)->>'ok', 'true',
  'W12 HIGH-1 setup: her entry id used as an idempotency key on another session');
select tests.as_id(tests.v('H'));
select is(public.cancel_booking(tests.v('bH9'))->>'ok', 'true', 'W12 HIGH-1 the cancellation still succeeds');
select tests.as_postgres();
select is((select status from public.waitlist_entries where id = (tests.j('j9')->>'entry_id')::uuid), 'promoted',
  'W12 HIGH-1 she is promoted anyway');
select ok((select b.idempotency_key <> e.id from public.waitlist_entries e join public.bookings b on b.id = e.promoted_booking_id
            where e.id = (tests.j('j9')->>'entry_id')::uuid), 'W12 HIGH-1 promotion keys are random, never the entry id');

-- HIGH-1 containment: a promotion that fails to write skips only that entry; the cancellation commits.
select tests.put('s10', tests.make_session(now() + interval '5 days', 1)::text);
select tests.as_id(tests.v('H'));
select tests.put('bH10', public.book_session(tests.v('s10'), gen_random_uuid())->>'booking_id');
select tests.as_id(tests.v('G'));
select tests.put('j10G', public.join_waitlist(tests.v('s10'), gen_random_uuid())::text);
select tests.as_id(tests.v('I'));
select tests.put('j10I', public.join_waitlist(tests.v('s10'), gen_random_uuid())::text);
select tests.as_postgres();
create function tests.fail_promotion_of_g() returns trigger language plpgsql as $$
begin
  if new.source = 'waitlist' and new.user_id = tests.v('G') then raise exception 'simulated failure'; end if;
  return new;
end $$;
create trigger tests_fail_promotion before insert on public.bookings for each row execute function tests.fail_promotion_of_g();
select tests.put('gG_before', (select credits_remaining::text from public.credit_grants where id = tests.v('gG')));
select tests.as_id(tests.v('H'));
select tests.put('c10', public.cancel_booking(tests.v('bH10'))::text);
select is(tests.j('c10')->>'ok', 'true', 'W12 containment: the cancellation commits');
select is(tests.j('c10')->>'refunded', 'true', 'W12 containment: and refunds');
select tests.as_postgres();
drop trigger tests_fail_promotion on public.bookings;
select is((select status || '/' || skip_reason from public.waitlist_entries where id = (tests.j('j10G')->>'entry_id')::uuid),
  'skipped/promotion_failed', 'W12 containment: the failing entry is skipped (promotion_failed)');
select is((select status from public.waitlist_entries where id = (tests.j('j10I')->>'entry_id')::uuid), 'promoted',
  'W12 containment: the next one is promoted');
select is((select credits_remaining::text from public.credit_grants where id = tests.v('gG')), tests.j('gG_before')::text,
  'W12 containment: the failed promotion debited nothing');
select is((select count(*) from public.bookings where session_id = tests.v('s10') and user_id = tests.v('G')), 0::bigint,
  'W12 containment: no half-written booking');

-- MEDIUM-1: the self-cancellation throttle applies to joins and to promotion.
update public.studio_settings set max_self_cancellations_24h = 1 where id = 1;
select tests.put('s11', tests.make_session(now() + interval '6 days', 1)::text);
select tests.as_id(tests.v('I'));
select tests.put('bI11', public.book_session(tests.v('s11'), gen_random_uuid())->>'booking_id');
select tests.as_id(tests.v('H'));   -- H cancelled twice herself in this transaction
select tests.put('j11H', public.join_waitlist(tests.v('s11'), gen_random_uuid())::text);
select is(tests.j('j11H')->>'code', 'too_many_changes', 'W12 MEDIUM-1 join refused after too many self-cancellations');
select is(tests.j('j11H')->>'limit', 'cancellations', 'W12 MEDIUM-1 limit = cancellations');
select tests.as_postgres();
insert into public.waitlist_entries (session_id, user_id, request_key, created_at)
values (tests.v('s11'), tests.v('H'), gen_random_uuid(), now() - interval '1 day');
select tests.as_id(tests.v('G'));
select tests.put('j11G', public.join_waitlist(tests.v('s11'), gen_random_uuid())::text);
select tests.as_postgres();
-- H has cancelled twice herself; with a limit of 2 she is over it, the canceller I (0 before) is not.
update public.studio_settings set max_self_cancellations_24h = 2 where id = 1;
select tests.as_id(tests.v('I'));
select public.cancel_booking(tests.v('bI11'));
select tests.as_postgres();
update public.studio_settings set max_self_cancellations_24h = 6 where id = 1;
select is((select status || '/' || skip_reason from public.waitlist_entries where session_id = tests.v('s11') and user_id = tests.v('H')),
  'skipped/too_many_changes', 'W12 MEDIUM-1 a waiting student over the limit is skipped at promotion');
select is((select status from public.waitlist_entries where id = (tests.j('j11G')->>'entry_id')::uuid), 'promoted',
  'W12 MEDIUM-1 the next one is promoted');

-- LOW-1/2: invisible names (tab, NBSP, zero-width, Hangul filler) are no name.
select tests.as_id(tests.v('H'));
select throws_ok(format('update public.profiles set display_name = %L where id = %L', U&'\00A0\200B', tests.v('H')), '23514', null,
  'W12 LOW-1 NBSP + zero-width name rejected by the CHECK');
select throws_ok(format('update public.profiles set display_name = %L where id = %L', U&'\3164', tests.v('H')), '23514', null,
  'W12 LOW-1 Hangul filler name rejected by the CHECK');
select throws_ok(format('update public.profiles set display_name = %L where id = %L', E'\t', tests.v('H')), '23514', null,
  'W12 LOW-1 tab name rejected by the CHECK');
select tests.as_postgres();
select ok(not private.has_display_name(U&'\FEFF\2060 ') and private.has_display_name(U&'Ana\00A0'),
  'W12 LOW-1 has_display_name: invisible → false, a real name with trailing NBSP → true');
-- A legacy row stored before the CHECK (simulated: constraint dropped inside this test transaction).
alter table public.profiles drop constraint profiles_display_name_visible;
update public.profiles set display_name = U&'\00A0' where id = tests.v('H');
select tests.put('s12', tests.make_session(now() + interval '7 days', 1)::text);
select tests.as_id(tests.v('H'));
select is(public.book_session(tests.v('s_open'), gen_random_uuid())->>'code', 'profile_incomplete', 'W12 LOW-1 NBSP name → book refused');
select tests.as_id(tests.v('I'));
select tests.put('bI12', public.book_session(tests.v('s12'), gen_random_uuid())->>'booking_id');
select tests.as_id(tests.v('H'));
select is(public.join_waitlist(tests.v('s12'), gen_random_uuid())->>'code', 'profile_incomplete', 'W12 LOW-1 NBSP name → join refused');
select tests.as_postgres();
insert into public.waitlist_entries (session_id, user_id, request_key, created_at)
values (tests.v('s12'), tests.v('H'), gen_random_uuid(), now() - interval '1 day');
select tests.as_id(tests.v('G'));
select tests.put('j12G', public.join_waitlist(tests.v('s12'), gen_random_uuid())::text);
select tests.as_id(tests.v('I'));
select public.cancel_booking(tests.v('bI12'));
select tests.as_postgres();
select is((select status || '/' || skip_reason from public.waitlist_entries where session_id = tests.v('s12') and user_id = tests.v('H')),
  'skipped/profile_incomplete', 'W12 LOW-1 a waiting student without a visible name is skipped at promotion');
select is((select status from public.waitlist_entries where id = (tests.j('j12G')->>'entry_id')::uuid), 'promoted',
  'W12 LOW-1 the next one is promoted');

-- LOW-3: leave without any entry answers not_found (and locks nothing).
select tests.as_id(tests.v('G'));
select is(public.leave_waitlist(tests.v('s_open'))->>'code', 'not_found', 'W12 LOW-3 leave without an entry → not_found');

-- LOW-6: no promotion once booking has closed (booking_closes_minutes), even outside the cancellation window.
select tests.as_postgres();
update public.studio_settings set cancellation_window_hours = 0, booking_closes_minutes = 120 where id = 1;
select tests.put('s13', tests.make_session(now() + interval '60 minutes', 1)::text);
insert into public.waitlist_entries (session_id, user_id, request_key, created_at)
values (tests.v('s13'), tests.v('G'), gen_random_uuid(), now() - interval '1 day');
select tests.as_user('staff');
select tests.put('bI13', public.admin_book_for(tests.v('I'), tests.v('s13'), gen_random_uuid())->>'booking_id');
select is((public.admin_cancel_for(tests.v('bI13'))->>'promoted')::int, 0, 'W12 LOW-6 booking closed → nobody promoted');
select tests.as_postgres();
update public.studio_settings set cancellation_window_hours = 24, booking_closes_minutes = 0 where id = 1;
select is((select status from public.waitlist_entries where session_id = tests.v('s13')), 'waiting', 'W12 LOW-6 entry still waiting');

-- LOW-4/5: queue cap 50 per session, 10 open entries per student.
select tests.put('s14', tests.make_session(now() + interval '8 days', 1)::text);
select tests.as_user('staff');
select public.admin_book_for(tests.v('G'), tests.v('s14'), gen_random_uuid());
select tests.as_postgres();
insert into public.waitlist_entries (session_id, user_id, request_key)
select tests.make_session(now() + make_interval(days => 10 + n), 1), tests.v('I'), gen_random_uuid() from generate_series(1, 10) n;
select tests.as_id(tests.v('I'));
select is(public.join_waitlist(tests.v('s14'), gen_random_uuid())->>'code', 'too_many_waitlists', 'W12 LOW-5 an 11th open entry is refused');
select tests.as_postgres();
do $$
declare v_user uuid;
begin
  for n in 1 .. 50 loop
    v_user := tests.create_user(gen_random_uuid(), 'bulk-' || n || '@example.test');
    insert into public.waitlist_entries (session_id, user_id, request_key) values (tests.v('s14'), v_user, gen_random_uuid());
  end loop;
end $$;
select tests.as_user('D');
select is(public.join_waitlist(tests.v('s14'), gen_random_uuid())->>'code', 'waitlist_full', 'W12 LOW-4 a 51st waiting student is refused');

-- D8 reconciliation ---------------------------------------------------------------------------------------------------------------------
select tests.as_postgres();
select is(tests.grant_ledger_mismatches(), 0::bigint, 'W D8 grants reconcile with the ledger');
select is(tests.session_count_mismatches(), 0::bigint, 'W D8 counters reconcile with bookings');
select is((select count(*) from public.sessions where confirmed_count > capacity), 0::bigint, 'W D8 no session over capacity');
select is((select count(*) from public.waitlist_entries e
            where e.status = 'promoted'
              and (select count(*) from public.credit_ledger l where l.booking_id = e.promoted_booking_id and l.reason = 'booking_debit') <> 1),
  0::bigint, 'W D8 every promotion debited exactly once');

select * from finish();
rollback;
