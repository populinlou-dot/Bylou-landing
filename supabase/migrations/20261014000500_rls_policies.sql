-- Booking core · migration 5/7 · rls_policies
-- DATA_MODEL §4 (matrix 4.1, sketch 4.2, view 4.3), §11 #5.
-- Two default-deny layers: table privileges decide IF a role may touch a table; RLS decides WHICH rows.
-- No INSERT/UPDATE/DELETE policies on business tables: SECURITY DEFINER RPCs are the only write path.

-- 1. Table privileges -------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.studio_settings, public.class_types, public.sessions to anon;
grant select on public.profiles, public.studio_settings, public.class_types, public.sessions,
                public.session_private_details, public.bookings, public.credit_grants, public.credit_ledger
  to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;   -- role/email never updatable

revoke all on public.session_availability from anon, authenticated;
grant select on public.session_availability to anon, authenticated;

-- 2. RLS on every table -----------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.studio_settings         enable row level security;
alter table public.class_types             enable row level security;
alter table public.sessions                enable row level security;
alter table public.session_private_details enable row level security;
alter table public.bookings                enable row level security;
alter table public.credit_grants           enable row level security;
alter table public.credit_ledger           enable row level security;

-- (select ...) wrappers → evaluated once per statement (initPlan), Supabase RLS guidance.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy settings_select on public.studio_settings for select to anon, authenticated using (true);

create policy class_types_select_public on public.class_types for select to anon using (is_published);
create policy class_types_select_auth on public.class_types for select to authenticated
  using (is_published
         or (select private.is_staff())
         or exists (select 1 from public.bookings b
                      join public.sessions s on s.id = b.session_id
                     where s.class_type_id = class_types.id and b.user_id = (select auth.uid())));

create policy sessions_select_public on public.sessions for select to anon
  using (is_published and status = 'scheduled');
create policy sessions_select_auth on public.sessions for select to authenticated
  using ((is_published and status = 'scheduled')
         or (select private.is_staff())
         or exists (select 1 from public.bookings b
                     where b.session_id = sessions.id and b.user_id = (select auth.uid())));

create policy private_details_select on public.session_private_details for select to authenticated
  using ((select private.is_staff())
         or exists (select 1 from public.bookings b
                     where b.session_id = session_private_details.session_id
                       and b.user_id = (select auth.uid()) and b.status = 'confirmed'));

create policy bookings_select on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
create policy credit_grants_select on public.credit_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
create policy credit_ledger_select on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));

-- rollback (local only; never leave migration 4 without these):
--   drop policy ... on each table; alter table ... disable row level security;
--   revoke select on ... from anon, authenticated; revoke update (display_name, phone) on public.profiles from authenticated;
