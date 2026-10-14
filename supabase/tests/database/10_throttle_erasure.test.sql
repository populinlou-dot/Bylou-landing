-- Pre-release hardening (ADR-019 / ADR-020). Migration 20261014001200_throttle_and_erasure.
--   T*: book_session churn throttle (too_many_changes).
--   R*: admin_anonymize_student (account erasure, pseudonymous history).
-- now() is fixed for the whole transaction, so every booking/cancellation below is "within 24 h".
begin;
\ir _helpers.inc
select plan(85);

select tests.setup_people();
select tests.put('gA', tests.make_grant('A', 20, now() + interval '60 days')::text);
select tests.put('gB', tests.make_grant('B', 20, now() + interval '60 days')::text);
select tests.put('gC', tests.make_grant('C', 20, now() + interval '60 days')::text);
select tests.put('s1', tests.make_session(now() + interval '3 days', 5)::text);
select tests.put('s2', tests.make_session(now() + interval '4 days', 5)::text);
select tests.put('s3', tests.make_session(now() + interval '5 days', 5)::text);
select tests.put('s4', tests.make_session(now() + interval '6 days', 5)::text);
select tests.put('s5', tests.make_session(now() + interval '7 days', 5)::text);
select tests.put('s6', tests.make_session(now() + interval '8 days', 5)::text);
select tests.put('s7', tests.make_session(now() + interval '9 days', 5)::text);

-- Settings ---------------------------------------------------------------------------------------------
select results_eq('select max_self_cancellations_24h, max_session_bookings_24h from public.studio_settings',
  $$values (6, 3)$$, 'T0 defaults: 6 self-cancellations, 3 bookings per session (rolling 24 h)');
select ok(not has_column_privilege('authenticated', 'public.studio_settings', 'max_self_cancellations_24h', 'SELECT')
          and not has_column_privilege('anon', 'public.studio_settings', 'max_session_bookings_24h', 'SELECT'),
  'T0 throttle limits are not readable through the Data API');
select throws_ok('update public.studio_settings set max_session_bookings_24h = 0 where id = 1', '23514', null,
  'T0 a limit below 1 is rejected (null = off)');
select has_index('public', 'bookings', 'bookings_user_cancelled_idx', 'T0 index for the cancellation count');
select has_index('public', 'bookings', 'bookings_user_session_idx', 'T0 index for the per-session count');

-- T1 per-session rebookings: book/cancel s1 three times, the 4th booking is refused ------------------------------
select tests.as_user('A');
select tests.put('a1', public.book_session(tests.v('s1'), 'a1a1a1a1-0000-4000-8000-000000000001')::text);
select is(public.cancel_booking((tests.j('a1')->>'booking_id')::uuid)->>'status', 'cancelled', 'T1 1st cancel');
select tests.put('a2', public.book_session(tests.v('s1'), 'a1a1a1a1-0000-4000-8000-000000000002')::text);
select is(tests.j('a2')->>'ok', 'true', 'T1 2nd booking of the same session (below limit) → ok');
select is(public.cancel_booking((tests.j('a2')->>'booking_id')::uuid)->>'status', 'cancelled', 'T1 2nd cancel');
select tests.put('a3', public.book_session(tests.v('s1'), 'a1a1a1a1-0000-4000-8000-000000000003')::text);
select is(tests.j('a3')->>'ok', 'true', 'T1 3rd booking of the same session → ok');
select is(public.cancel_booking((tests.j('a3')->>'booking_id')::uuid)->>'status', 'cancelled', 'T1 3rd cancel');
select tests.put('a4', public.book_session(tests.v('s1'), gen_random_uuid())::text);
select is(tests.j('a4')->>'ok', 'false', 'T1 4th booking of the same session → refused');
select is(tests.j('a4')->>'code', 'too_many_changes', 'T1 code too_many_changes');
select is(tests.j('a4')->>'limit', 'session_rebookings', 'T1 limit = session_rebookings');
select is(public.book_session(tests.v('s1'), gen_random_uuid())->>'code', 'too_many_changes',
  'T1 another fresh idempotency key does not reset the limit');
select is(public.book_session(tests.v('s2'), gen_random_uuid())->>'ok', 'true',
  'T1 other sessions stay bookable (3 cancellations < 6)');
-- Replay of an existing request still returns the original result.
select tests.put('a3r', public.book_session(tests.v('s1'), 'a1a1a1a1-0000-4000-8000-000000000003')::text);
select is(tests.j('a3r')->>'replayed', 'true', 'T1 replay while throttled → original result');
select is(tests.j('a3r')->>'booking_id', tests.j('a3')->>'booking_id', 'T1 replay returns the original booking id');
select tests.as_postgres();
select is((select count(*) from public.bookings where session_id = tests.v('s1') and user_id = tests.uid('A')), 3::bigint,
  'T1 refusals wrote nothing');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 19,
  'T1 refunds intact: only the s2 booking is debited');

-- T2 self-cancellations: 6 in 24 h → no new booking anywhere -------------------------------------------------------
select tests.as_user('B');
select tests.put('b_last', public.book_session(tests.v('s1'), gen_random_uuid())->>'booking_id');
select public.cancel_booking(tests.v('b_last'));
select tests.put('b_last', public.book_session(tests.v('s2'), gen_random_uuid())->>'booking_id');
select public.cancel_booking(tests.v('b_last'));
select tests.put('b_last', public.book_session(tests.v('s3'), gen_random_uuid())->>'booking_id');
select public.cancel_booking(tests.v('b_last'));
select tests.put('b_last', public.book_session(tests.v('s4'), gen_random_uuid())->>'booking_id');
select public.cancel_booking(tests.v('b_last'));
select tests.put('b_last', public.book_session(tests.v('s5'), gen_random_uuid())->>'booking_id');
select public.cancel_booking(tests.v('b_last'));
select tests.put('b6', public.book_session(tests.v('s6'), 'b6b6b6b6-0000-4000-8000-000000000006')::text);
select is(tests.j('b6')->>'ok', 'true', 'T2 booking after 5 self-cancellations (below limit) → ok');
select is(public.cancel_booking((tests.j('b6')->>'booking_id')::uuid)->>'status', 'cancelled', 'T2 6th self-cancellation');
select tests.put('b7', public.book_session(tests.v('s7'), gen_random_uuid())::text);
select is(tests.j('b7')->>'code', 'too_many_changes', 'T2 7th booking after 6 self-cancellations → too_many_changes');
select is(tests.j('b7')->>'limit', 'cancellations', 'T2 limit = cancellations');
select is(public.book_session(tests.v('s6'), 'b6b6b6b6-0000-4000-8000-000000000006')->>'replayed', 'true',
  'T2 replay of an earlier request still answers');
select tests.as_postgres();
select is((select count(*) from public.bookings where session_id = tests.v('s7')), 0::bigint, 'T2 refusal wrote nothing');

-- T3 staff paths: not throttled, and staff cancellations do not count against the student ------------------
select tests.as_user('staff');
select is(public.admin_book_for(tests.uid('B'), tests.v('s7'), gen_random_uuid())->>'ok', 'true',
  'T3 admin_book_for ignores the student''s self-cancellation limit');
select tests.put('a_s1', public.admin_book_for(tests.uid('A'), tests.v('s1'), gen_random_uuid())::text);
select is(tests.j('a_s1')->>'ok', 'true', 'T3 admin_book_for ignores the per-session limit');
select is(public.admin_cancel_for((tests.j('a_s1')->>'booking_id')::uuid)->>'status', 'cancelled', 'T3 staff cancels it');
select tests.as_postgres();
update public.studio_settings set max_self_cancellations_24h = 1 where id = 1;
select tests.as_user('staff');
select tests.put('c1', public.admin_book_for(tests.uid('C'), tests.v('s1'), gen_random_uuid())::text);
select public.admin_cancel_for((tests.j('c1')->>'booking_id')::uuid);
select tests.as_user('C');
select is(public.book_session(tests.v('s2'), gen_random_uuid())->>'ok', 'true',
  'T3 a cancellation by staff does not count (limit 1, C has 0 self-cancellations)');
select tests.as_postgres();
update public.studio_settings set max_self_cancellations_24h = 6 where id = 1;

-- T4 null disables each limit ---------------------------------------------------------------------------------
update public.studio_settings set max_self_cancellations_24h = null where id = 1;
select tests.as_user('B');
select is(public.book_session(tests.v('s5'), gen_random_uuid())->>'ok', 'true', 'T4 cancellation limit null → off');
select tests.as_postgres();
update public.studio_settings set max_session_bookings_24h = null where id = 1;
select tests.as_user('A');
select is(public.book_session(tests.v('s1'), gen_random_uuid())->>'ok', 'true', 'T4 per-session limit null → off');
select tests.as_postgres();
update public.studio_settings set max_self_cancellations_24h = 6, max_session_bookings_24h = 3 where id = 1;
select is(tests.grant_ledger_mismatches(), 0::bigint, 'T D8 grants reconcile with the ledger');
select is(tests.session_count_mismatches(), 0::bigint, 'T D8 counters reconcile with bookings');

-- R: account erasure ---------------------------------------------------------------------------------------------
-- D: a past attended class, an upcoming booking, a pack with a note, an adjustment with a reason, a phone.
select tests.put('gD', tests.make_grant('D', 10, now() + interval '60 days')::text);
update public.credit_grants set note = 'Pack 10 · transferencia de Dana' where id = tests.v('gD');
update public.profiles set display_name = 'Dana Test', phone = '+54 11 5555-0000' where id = tests.uid('D');
select tests.put('s_past', tests.make_session(now() - interval '2 days')::text);
select tests.put('bD_past', tests.make_booking('D', tests.v('s_past'), tests.v('gD'), 'attended')::text);
select tests.as_user('staff');
select is(public.admin_adjust_credits(tests.v('gD'), -1, 'Dana pidió devolver una clase', gen_random_uuid())->>'ok', 'true',
  'R setup: adjustment with a personal reason');
select tests.as_user('D');
select tests.put('bD_next', public.book_session(tests.v('s3'), 'dddddddd-0000-4000-8000-000000000001')->>'booking_id');
select tests.as_postgres();

-- Privileges.
select tests.as_user('A');
select throws_ok(format('select public.admin_anonymize_student(%L, %L)', tests.uid('D'), 'test-d@example.test'),
  '42501', 'forbidden', 'R student → forbidden');
select tests.as_user('D');
select throws_ok(format('select public.admin_anonymize_student(%L, %L)', tests.uid('D'), 'test-d@example.test'),
  '42501', 'forbidden', 'R a student cannot erase herself through the RPC');
select tests.as_anon();
select throws_ok(format('select public.admin_anonymize_student(%L, %L)', tests.uid('D'), 'test-d@example.test'),
  '42501', null, 'R anon has no EXECUTE');

select tests.as_user('staff');
select throws_ok(format('select public.admin_anonymize_student(%L, null)', tests.uid('D')), '22023', null,
  'R missing confirmation email → invalid_input');
select throws_ok(format('select public.admin_anonymize_student(%L, %L)', tests.uid('D'), '   '), '22023', null,
  'R blank confirmation email → invalid_input');
select is(public.admin_anonymize_student(gen_random_uuid(), 'x@example.test')->>'code', 'not_found', 'R unknown id → not_found');
select is(public.admin_anonymize_student(tests.uid('staff'), 'test-staff@example.test')->>'code', 'not_found',
  'R a staff profile is not a student → not_found');
select is(public.admin_anonymize_student(tests.uid('D'), 'test-a@example.test')->>'code', 'email_mismatch',
  'R another student''s email → email_mismatch');
select tests.put('r_up', public.admin_anonymize_student(tests.uid('D'), 'test-d@example.test')::text);
select is(tests.j('r_up')->>'code', 'has_upcoming_bookings', 'R upcoming confirmed booking → has_upcoming_bookings');
select is((tests.j('r_up')->>'upcoming')::int, 1, 'R reports how many upcoming bookings to cancel');
select tests.as_postgres();
select results_eq(format('select display_name, email, anonymized_at from public.profiles where id = %L', tests.uid('D')),
  $$values ('Dana Test'::text, 'test-d@example.test'::text, null::timestamptz)$$, 'R refusals change nothing');

-- Staff cancels the upcoming booking, then erases with the email typed in another case.
select tests.as_user('staff');
select is(public.admin_cancel_for(tests.v('bD_next'))->>'refunded', 'true', 'R staff cancels the upcoming booking first');
select tests.as_postgres();
select tests.put('ledger_before', (select count(*) from public.credit_ledger where user_id = tests.uid('D'))::text);
select tests.put('balance_before', private.usable_balance(tests.uid('D'))::text);
select tests.as_user('staff');
select tests.put('r_ok', public.admin_anonymize_student(tests.uid('D'), '  Test-D@Example.TEST ')::text);
select is(tests.j('r_ok')->>'ok', 'true', 'R confirmation email matches case-insensitively → ok');
select is(tests.j('r_ok')->>'replayed', 'false', 'R first call is not a replay');
select is((tests.j('r_ok')->>'grant_notes_erased')::int, 1, 'R one pack note erased');
select is((tests.j('r_ok')->>'ledger_notes_erased')::int, 1, 'R one ledger note erased');

select tests.as_postgres();
select results_eq(format('select display_name, phone, email, role from public.profiles where id = %L', tests.uid('D')),
  $$values (null::text, null::text, null::text, 'student'::text)$$, 'R profile name, phone and email nulled');
select ok((select anonymized_at = now() from public.profiles where id = tests.uid('D')), 'R anonymized_at stamped');
select is((select count(*) from public.credit_grants where user_id = tests.uid('D') and note is not null), 0::bigint,
  'R pack notes nulled');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('D') and note is not null), 0::bigint,
  'R ledger notes nulled');
select results_eq(format('select reason, delta, note_erased_at = now() from public.credit_ledger where user_id = %L and reason = %L',
                         tests.uid('D'), 'admin_adjust'),
  $$values ('admin_adjust'::text, -1, true)$$, 'R the adjustment row is kept, its note marked erased');
select is((select count(*) from public.credit_ledger where user_id = tests.uid('D'))::text, current_setting('tests.ledger_before'),
  'R history preserved: every ledger row kept');
select is((select count(*) from public.bookings where user_id = tests.uid('D')), 2::bigint,
  'R history preserved: the attended and the cancelled booking are kept');
select is(private.usable_balance(tests.uid('D'))::text, current_setting('tests.balance_before'),
  'R balance unchanged');
select is(tests.grant_ledger_mismatches(), 0::bigint, 'R D8 grants still reconcile with the ledger');

-- Idempotent second call.
select tests.as_user('staff');
select tests.put('r_again', public.admin_anonymize_student(tests.uid('D'), 'test-d@example.test')::text);
select is(tests.j('r_again')->>'ok', 'true', 'R second call → ok');
select is(tests.j('r_again')->>'replayed', 'true', 'R second call is a replay');
select ok((tests.j('r_again')->>'anonymized_at')::timestamptz = (tests.j('r_ok')->>'anonymized_at')::timestamptz,
  'R replay keeps the original timestamp');

-- Audit: who erased.
select tests.as_postgres();
select is((select anonymized_by from public.profiles where id = tests.uid('D')), tests.uid('staff'), 'R anonymized_by = the staff member');
select throws_ok(format('update public.profiles set anonymized_by = null where id = %L', tests.uid('D')), '23514', null,
  'R anonymized_at and anonymized_by go together');
select tests.as_user('staff');

-- No further packs or adjustments for an erased student (no notes after the sweep).
select is(public.grant_credits(tests.uid('D'), 4, 30, 'Pack para Dana', gen_random_uuid())->>'code', 'not_found',
  'R grant_credits to an anonymized student → not_found');
select is(public.admin_adjust_credits(tests.v('gD'), -1, 'Dana otra vez', gen_random_uuid())->>'code', 'not_found',
  'R admin_adjust_credits on an anonymized student''s pack → not_found');
select tests.as_postgres();
select is((select count(*) from public.credit_ledger where user_id = tests.uid('D'))::text, current_setting('tests.ledger_before'),
  'R refused grant/adjust wrote nothing');
select tests.as_user('staff');

-- Without a confirmed email: her exact display name, or her user id, confirms the erasure.
select tests.as_postgres();
select tests.create_user('f0000000-0000-4000-8000-0000000000e2', 'test-noemail@example.test');
update public.profiles set email = null, display_name = 'Eva Sin Mail' where id = 'f0000000-0000-4000-8000-0000000000e2';
select tests.create_user('f0000000-0000-4000-8000-0000000000e3', 'test-noname@example.test');
update public.profiles set email = null, display_name = null where id = 'f0000000-0000-4000-8000-0000000000e3';
select tests.as_user('staff');
select is(public.admin_anonymize_student('f0000000-0000-4000-8000-0000000000e2', 'eva sin mail')->>'code', 'email_mismatch',
  'R no email: the display name must match exactly');
select is(public.admin_anonymize_student('f0000000-0000-4000-8000-0000000000e2', 'test-noemail@example.test')->>'code', 'email_mismatch',
  'R no email: the auth email is not a confirmation');
select is(public.admin_anonymize_student('f0000000-0000-4000-8000-0000000000e2', '  Eva Sin Mail ')->>'ok', 'true',
  'R no email: exact display name (trimmed) → ok');
select is(public.admin_anonymize_student('f0000000-0000-4000-8000-0000000000e3', 'F0000000-0000-4000-8000-0000000000E3')->>'ok', 'true',
  'R no email and no name: her user id (any case) → ok');
select tests.as_postgres();
select is((select count(*) from public.profiles
            where id in ('f0000000-0000-4000-8000-0000000000e2', 'f0000000-0000-4000-8000-0000000000e3')
              and anonymized_at is not null and display_name is null and email is null), 2::bigint,
  'R both unconfirmed students anonymized');
select tests.as_user('staff');

-- Panel reads.
select ok(not exists (select 1 from jsonb_array_elements(public.admin_search_students(null)->'students') s
                       where s->>'user_id' = tests.uid('D')::text), 'R anonymized students leave the search list');
select ok(public.admin_student_summary(tests.uid('D'))->'student'->>'anonymized_at' is not null,
  'R the summary reports anonymized_at');
select is(public.admin_book_for(tests.uid('D'), tests.v('s4'), gen_random_uuid())->>'code', 'not_found',
  'R admin_book_for an anonymized student → not_found');

-- The (still signed-in) student cannot book or write personal data back.
select tests.as_user('D');
select throws_ok(format('select public.book_session(%L, gen_random_uuid())', tests.v('s4')), '42501', 'forbidden',
  'R anonymized caller cannot book');
select is(public.book_session(tests.v('s3'), 'dddddddd-0000-4000-8000-000000000001')->>'replayed', 'true',
  'R an earlier request still replays (no write)');
update public.profiles set display_name = 'Dana otra vez' where id = tests.uid('D');
select tests.as_postgres();
select is((select display_name from public.profiles where id = tests.uid('D')), null, 'R profile update is a no-op (RLS)');

-- auth.users: email changes are not synced back; deleting the auth user is blocked by the history FKs.
update auth.users set email = 'test-d-new@example.test' where id = tests.uid('D');
select is((select email from public.profiles where id = tests.uid('D')), null, 'R auth email change is not re-synced');
select throws_ok(format('delete from auth.users where id = %L', tests.uid('D')), '23503', null,
  'R auth.users row with history cannot be deleted (profiles cascade → bookings RESTRICT): ban it instead');
select tests.create_user('f0000000-0000-4000-8000-0000000000e1', 'test-nohistory@example.test');
delete from auth.users where id = 'f0000000-0000-4000-8000-0000000000e1';
select is((select count(*) from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1'), 0::bigint,
  'R a user without history can be deleted (profile cascades)');

-- The ledger stays append-only outside the erasure.
select throws_ok(format('update public.credit_ledger set note = null, note_erased_at = now() where user_id = %L', tests.uid('A')),
  '42501', 'credit_ledger is append-only', 'R note erasure without the RPC flag → refused');
select set_config('bylou.ledger_note_erasure', 'on', true);
select throws_ok(format('update public.credit_ledger set delta = 7 where user_id = %L and reason = %L', tests.uid('A'), 'grant'),
  '42501', 'credit_ledger is append-only', 'R with the flag, any change other than note → null is refused');
select throws_ok('delete from public.credit_ledger', '42501', 'credit_ledger is append-only', 'R with the flag, DELETE is refused');
select set_config('bylou.ledger_note_erasure', '', true);
select throws_ok(format('update public.profiles set display_name = %L where id = %L', 'x', tests.uid('D')), '23514', null,
  'R backstop: an anonymized profile cannot hold personal data');

select * from finish();
rollback;
