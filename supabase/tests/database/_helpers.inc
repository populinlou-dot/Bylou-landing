-- Shared pgTAP fixtures, included with `\ir _helpers.inc` INSIDE each test transaction
-- (everything here is rolled back with the test). Not a test file itself (.inc extension).
--
-- Impersonation mirrors PostgREST: role `authenticated`/`anon` + request.jwt.claims.
-- Values are passed between statements as transaction-local GUCs: tests.v('name') / tests.j('name').

create schema tests;
grant usage on schema tests to anon, authenticated;

-- People: 1 staff + students A, B, C, D (fake .test emails).
create function tests.uid(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'staff' then 'f0000000-0000-4000-8000-000000000001'
    when 'A'     then 'f0000000-0000-4000-8000-00000000000a'
    when 'B'     then 'f0000000-0000-4000-8000-00000000000b'
    when 'C'     then 'f0000000-0000-4000-8000-00000000000c'
    when 'D'     then 'f0000000-0000-4000-8000-00000000000d'
  end::uuid
$$;

create function tests.create_user(p_id uuid, p_email text, p_role text default 'student') returns uuid
language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(),
          '{"provider":"email","providers":["email"]}', '{"role":"staff"}', now(), now());  -- metadata must be ignored
  update public.profiles set role = p_role, display_name = split_part(p_email, '@', 1) where id = p_id;
  return p_id;
end $$;

create function tests.setup_people() returns void language plpgsql as $$
begin
  perform tests.create_user(tests.uid('staff'), 'test-staff@example.test', 'staff');
  perform tests.create_user(tests.uid('A'), 'test-a@example.test');
  perform tests.create_user(tests.uid('B'), 'test-b@example.test');
  perform tests.create_user(tests.uid('C'), 'test-c@example.test');
  perform tests.create_user(tests.uid('D'), 'test-d@example.test');
end $$;

-- Role switching (transaction-local).
create function tests.as_user(p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(p_name), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create function tests.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- Transaction-local named values.
create function tests.put(p_name text, p_value text) returns text language sql as $$
  select set_config('tests.' || p_name, p_value, true)
$$;
create function tests.v(p_name text) returns uuid language sql stable as $$
  select nullif(current_setting('tests.' || p_name, true), '')::uuid
$$;
create function tests.j(p_name text) returns jsonb language sql stable as $$
  select nullif(current_setting('tests.' || p_name, true), '')::jsonb
$$;

-- Catalog fixtures (call as postgres).
create function tests.make_session(p_starts timestamptz, p_capacity int default 5,
                                   p_published boolean default true, p_minutes int default 60) returns uuid
language plpgsql as $$
declare v_type uuid; v_id uuid;
begin
  select id into v_type from public.class_types where slug = 'test-type';
  if v_type is null then
    insert into public.class_types (slug, name, default_duration_minutes, default_capacity, default_modality, is_published)
    values ('test-type', 'Test type', 60, 5, 'in_person', true) returning id into v_type;
  end if;
  insert into public.sessions (class_type_id, starts_at, ends_at, capacity, modality, is_published)
  values (v_type, p_starts, p_starts + make_interval(mins => p_minutes), p_capacity, 'in_person', p_published)
  returning id into v_id;
  return v_id;
end $$;

-- Grant + its ledger 'grant' row (keeps I6).
create function tests.make_grant(p_user text, p_credits int, p_expires timestamptz,
                                 p_valid_from timestamptz default now() - interval '1 day') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.credit_grants (user_id, credits_total, credits_remaining, valid_from, expires_at,
                                    granted_by, idempotency_key)
  values (tests.uid(p_user), p_credits, p_credits, p_valid_from, p_expires, tests.uid('staff'), gen_random_uuid())
  returning id into v_id;
  insert into public.credit_ledger (user_id, grant_id, reason, delta, actor_id)
  values (tests.uid(p_user), v_id, 'grant', p_credits, tests.uid('staff'));
  return v_id;
end $$;

-- Direct confirmed booking for states the RPC cannot reach (e.g. sessions already started).
-- Keeps I2 (counter) and I6 (ledger) consistent.
create function tests.make_booking(p_user text, p_session uuid, p_grant uuid default null,
                                   p_attendance text default 'unknown') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited,
                               created_by, attendance)
  values (p_session, tests.uid(p_user), gen_random_uuid(), p_grant, case when p_grant is null then 0 else 1 end,
          tests.uid(p_user), p_attendance)
  returning id into v_id;
  if p_grant is not null then
    update public.credit_grants set credits_remaining = credits_remaining - 1 where id = p_grant;
    insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
    values (tests.uid(p_user), p_grant, v_id, 'booking_debit', -1, tests.uid(p_user));
  end if;
  update public.sessions set confirmed_count = confirmed_count + 1 where id = p_session;
  return v_id;
end $$;

-- D8 reconciliation (call as postgres): number of rows violating I6 / I2. Expect 0.
create function tests.grant_ledger_mismatches() returns bigint language sql stable as $$
  select count(*) from public.credit_grants g
   where g.credits_remaining <> (select coalesce(sum(l.delta), 0) from public.credit_ledger l where l.grant_id = g.id)
$$;
create function tests.session_count_mismatches() returns bigint language sql stable as $$
  select count(*) from public.sessions s
   where s.confirmed_count <> (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'confirmed')
$$;

grant execute on all functions in schema tests to anon, authenticated;
