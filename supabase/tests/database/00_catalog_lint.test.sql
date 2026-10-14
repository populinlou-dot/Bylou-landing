-- E11 catalog lint + structural guarantees + seed reconciliation (DATA_MODEL §12).
begin;
\ir _helpers.inc
select plan(21);

-- Every SECURITY DEFINER function in public/private pins search_path to ''.
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not coalesce(p.proconfig @> array['search_path=""'], false)),
  null, 'E11 every security definer function sets search_path = ''''');

-- Every public table has RLS enabled.
select is(
  (select array_agg(c.relname::text order by c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null, 'E11 RLS enabled on every public table');

-- anon may execute nothing in public/private (allow-list empty in MVP).
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')),
  null, 'E11 anon has EXECUTE on no function');

-- authenticated may execute exactly the RPC allow-list + the RLS helpers.
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'execute')),
  array['private.class_type_is_published', 'private.is_staff', 'public.admin_adjust_credits',
        'public.admin_anonymize_student', 'public.admin_book_for', 'public.admin_cancel_for', 'public.admin_cancel_session', 'public.admin_search_students',
        'public.admin_student_summary', 'public.admin_update_session', 'public.admin_upsert_class_type',
        'public.book_session', 'public.cancel_booking', 'public.create_session', 'public.grant_credits',
        'public.join_waitlist', 'public.leave_waitlist', 'public.mark_attendance', 'public.my_waitlist_entries'],
  'E11 authenticated EXECUTE allow-list');

-- No write privilege on any public table for anon/authenticated (profiles update is column-level only).
select is(
  (select array_agg(r.rolname || ':' || c.relname order by r.rolname || ':' || c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(rolname)
    where n.nspname = 'public' and c.relkind in ('r', 'v')
      and (has_table_privilege(r.rolname, c.oid, 'INSERT') or has_table_privilege(r.rolname, c.oid, 'UPDATE')
           or has_table_privilege(r.rolname, c.oid, 'DELETE') or has_table_privilege(r.rolname, c.oid, 'TRUNCATE'))),
  null, 'E4/I9 no table-level write privilege for anon or authenticated');

select is(
  (select array_agg(c.relname::text order by c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and has_any_column_privilege('anon', c.oid, 'SELECT')),
  array['class_types', 'session_availability', 'sessions', 'studio_settings'],
  'E1 anon can SELECT only the public catalog');

select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
          and has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE'),
  'E5 authenticated may update display_name and phone');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE'),
  'E5 authenticated may not update role or email');

select ok((select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.session_availability'::regclass),
  'session_availability is security_invoker');
select columns_are('public', 'session_availability',
  array['id', 'class_type_id', 'class_type_slug', 'class_type_name', 'starts_at', 'ends_at', 'modality',
        'instructor_name', 'location_label', 'public_note', 'capacity', 'confirmed_count', 'spots_left', 'status'],
  'E2 session_availability exposes no user columns');

select has_trigger('public', 'credit_ledger', 'credit_ledger_append_only', 'I8 ledger append-only trigger exists');
select has_trigger('auth', 'users', 'on_auth_user_created', 'auth.users → profiles trigger exists');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'private schema not usable by anon');

-- Bylou studio rules (ADR-011): 24 h free cancellation, late cancellation denied, AR timezone.
select results_eq(
  $$select timezone, booking_opens_days, booking_closes_minutes, cancellation_window_hours, late_cancel_policy,
           credits_per_booking from public.studio_settings$$,
  $$values ('America/Argentina/Buenos_Aires'::text, 30, 0, 24, 'deny'::text, 1)$$,
  'studio_settings singleton holds the Bylou rules');
select throws_ok($$update public.studio_settings set timezone = 'Mars/Olympus' where id = 1$$, '22023', null,
  'invalid studio timezone rejected');
select throws_ok($$insert into public.studio_settings (id) values (2)$$, '23514', null, 'studio_settings is a singleton');
select throws_ok($$update public.studio_settings set late_cancel_policy = 'forfeit' where id = 1$$, '23514', null,
  'late_cancel_policy uses the domain vocabulary only');

-- New sign-ups are always students; user metadata cannot grant staff.
select tests.create_user('f0000000-0000-4000-8000-0000000000ee', 'test-meta@example.test', 'student');
select is((select role from public.profiles where id = 'f0000000-0000-4000-8000-0000000000ee'), 'student',
  'profile created by trigger as student despite metadata role');
update auth.users set email = 'test-meta2@example.test' where id = 'f0000000-0000-4000-8000-0000000000ee';
select is((select email from public.profiles where id = 'f0000000-0000-4000-8000-0000000000ee'),
  'test-meta2@example.test', 'email change synced to profiles');

-- D8 on the seeded database.
select is(tests.grant_ledger_mismatches(), 0::bigint, 'D8 seed: every grant remaining = Σ ledger delta');
select is(tests.session_count_mismatches(), 0::bigint, 'D8 seed: every confirmed_count = count(confirmed)');

select * from finish();
rollback;
