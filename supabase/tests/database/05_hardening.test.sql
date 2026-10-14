-- Phase 3.3 DB hardening (migration 20261014000800): confirmed-only profile email, unpublished class
-- types hidden / not bookable / not schedulable, studio_settings.updated_by not readable via the API.
begin;
\ir _helpers.inc
select plan(34);

select tests.setup_people();

-- 1. profiles.email holds only a confirmed address ---------------------------------------------------
-- Unconfirmed sign-up (what signInWithOtp creates for a new address with enable_confirmations = true).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('f0000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'test-e1@example.test', '', null,
        '{"provider":"email","providers":["email"]}', '{}', now(), now());

select ok((select exists (select 1 from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1')),
  'H1 unconfirmed sign-up still gets a profile');
select is((select email from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1'), null,
  'H1 unconfirmed sign-up: profile email is NULL (an unverified address is never trusted)');
select is((select role from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1'), 'student',
  'H1 unconfirmed sign-up is a student');

update auth.users set email = 'test-e1b@example.test' where id = 'f0000000-0000-4000-8000-0000000000e1';
select is((select email from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1'), null,
  'H1 email change while unconfirmed: still NULL');

update auth.users set email_confirmed_at = now() where id = 'f0000000-0000-4000-8000-0000000000e1';
select is((select email from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1'),
  'test-e1b@example.test', 'H1 confirmation syncs the address into profiles');

update auth.users set email = 'test-e1c@example.test' where id = 'f0000000-0000-4000-8000-0000000000e1';
select is((select email from public.profiles where id = 'f0000000-0000-4000-8000-0000000000e1'),
  'test-e1c@example.test', 'H1 email change while confirmed is synced');

select is((select email from public.profiles where id = tests.uid('A')), 'test-a@example.test',
  'H1 confirmed-at-insert user keeps its address');
select ok(not (select attnotnull from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'email'),
  'H1 profiles.email is nullable');
select has_trigger('auth', 'users', 'on_auth_user_email_synced', 'H1 confirmation/email sync trigger exists');
select hasnt_trigger('auth', 'users', 'on_auth_user_email_changed', 'H1 old email-only trigger replaced');
select is((select count(*) from public.profiles p join auth.users u on u.id = p.id
            where p.email is not null and u.email_confirmed_at is null), 0::bigint,
  'H1 no profile holds an unconfirmed address');

-- 2. Unpublished class types ---------------------------------------------------------------------------
insert into public.class_types (slug, name, default_duration_minutes, default_capacity, default_modality, is_published)
values ('test-hidden', 'Hidden type', 60, 5, 'in_person', false);
select tests.put('ct_hidden', (select id from public.class_types where slug = 'test-hidden')::text);
select tests.put('s_vis', tests.make_session(now() + interval '3 days')::text);   -- published 'test-type'
insert into public.sessions (class_type_id, starts_at, ends_at, capacity, modality, is_published)
values (tests.v('ct_hidden'), now() + interval '3 days', now() + interval '3 days 1 hour', 5, 'in_person', true);
select tests.put('s_hid', (select id from public.sessions where class_type_id = tests.v('ct_hidden') limit 1)::text);
insert into public.sessions (class_type_id, starts_at, ends_at, capacity, modality, is_published)
values (tests.v('ct_hidden'), now() + interval '4 days', now() + interval '4 days 1 hour', 5, 'in_person', true);
select tests.put('s_hid_b', (select id from public.sessions where class_type_id = tests.v('ct_hidden')
                              and id <> tests.v('s_hid') limit 1)::text);
select tests.put('gA', tests.make_grant('A', 5, now() + interval '30 days')::text);
select tests.make_booking('B', tests.v('s_hid_b'));   -- B booked before the type was hidden (history)

select tests.as_anon();
select is((select count(*) from public.sessions where id = tests.v('s_vis')), 1::bigint,
  'H2 anon sees a session of a published type (control)');
select is((select count(*) from public.sessions where class_type_id = tests.v('ct_hidden')), 0::bigint,
  'H2 anon cannot see sessions of an unpublished class type');
select is((select count(*) from public.session_availability where class_type_id = tests.v('ct_hidden')), 0::bigint,
  'H2 anon availability hides sessions of an unpublished class type');

select tests.as_user('A');
select is((select count(*) from public.sessions where id = tests.v('s_vis')), 1::bigint,
  'H2 student sees a session of a published type (control)');
select is((select count(*) from public.sessions where class_type_id = tests.v('ct_hidden')), 0::bigint,
  'H2 student cannot see sessions of an unpublished class type');
select is((select count(*) from public.session_availability where class_type_id = tests.v('ct_hidden')), 0::bigint,
  'H2 student availability hides sessions of an unpublished class type');
select tests.put('rh', public.book_session(tests.v('s_hid'), gen_random_uuid())::text);
select is(tests.j('rh')->>'ok', 'false', 'H2 student cannot book a session of an unpublished class type');
select is(tests.j('rh')->>'code', 'not_found', 'H2 unpublished class type → not_found');
select tests.put('rv', public.book_session(tests.v('s_vis'), gen_random_uuid())::text);
select is(tests.j('rv')->>'ok', 'true', 'H2 student books a session of a published type (control)');

select tests.as_user('B');
select is((select count(*) from public.sessions where id = tests.v('s_hid_b')), 1::bigint,
  'H2 a student still sees the session she booked after its type was unpublished');
select is((select count(*) from public.sessions where id = tests.v('s_hid')), 0::bigint,
  'H2 ... but not other sessions of that type');

select tests.as_user('staff');
select is((select count(*) from public.sessions where class_type_id = tests.v('ct_hidden')), 2::bigint,
  'H2 staff sees sessions of an unpublished class type');
select throws_ok(format('select public.create_session(gen_random_uuid(), %L, current_date + 3, %L)',
                        tests.v('ct_hidden'), '18:00'),
  '22023', 'invalid_input: class type is not published', 'H2 create_session rejects an unpublished class type');
select is((public.create_session(gen_random_uuid(),
             (select id from public.class_types where slug = 'test-type'), current_date + 3, '18:00'))->>'ok',
  'true', 'H2 create_session accepts a published class type (control)');

select tests.as_postgres();
select is((select count(*) from public.bookings where session_id = tests.v('s_hid')), 0::bigint,
  'H2 no booking written for the hidden session');
select is((select credits_remaining from public.credit_grants where id = tests.v('gA')), 4,
  'H2 only the control booking debited a credit');
select ok(not has_function_privilege('anon', 'private.class_type_is_published(uuid)', 'execute'),
  'H2 anon cannot execute the policy helper');

-- 3. studio_settings.updated_by is not readable through the API ---------------------------------------
update public.studio_settings set updated_by = tests.uid('staff') where id = 1;

select tests.as_anon();
select throws_ok('select updated_by from public.studio_settings', '42501', null,
  'H3 anon cannot select studio_settings.updated_by');
select throws_ok('select * from public.studio_settings', '42501', null, 'H3 anon select * is rejected');
select is((select timezone from public.studio_settings where id = 1), 'America/Argentina/Buenos_Aires',
  'H3 anon still reads the studio rules');

select tests.as_user('A');
select throws_ok('select updated_by from public.studio_settings', '42501', null,
  'H3 student cannot select studio_settings.updated_by');
select is((select late_cancel_policy from public.studio_settings where id = 1), 'deny',
  'H3 student still reads the studio rules');

select tests.as_postgres();
select is((select updated_by from public.studio_settings where id = 1), tests.uid('staff'),
  'H3 owner (postgres/service_role path) still reads updated_by');

select * from finish();
rollback;
