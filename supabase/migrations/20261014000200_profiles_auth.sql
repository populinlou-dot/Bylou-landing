-- Booking core · migration 2/7 · profiles_auth
-- DATA_MODEL §2.1, §5, §11 #2. ADR-005: role lives in profiles.role, never in user metadata.

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,                       -- copied from auth.users (see triggers)
  display_name text check (char_length(display_name) between 1 and 80),
  phone        text check (phone ~ '^\+?[0-9 ()-]{6,20}$'),
  role         text not null default 'student' check (role in ('student', 'staff')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Profile creation: role is ALWAYS the column default; raw_user_meta_data is user-editable and ignored.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_user_email();

-- Role check used by RLS policies and RPCs. SECURITY DEFINER avoids recursion through profiles RLS.
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
     where id = (select auth.uid()) and role = 'staff'
  )
$$;

-- Admin RPC guard: 42501 for anonymous callers and non-staff.
create function private.assert_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if not private.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

revoke execute on function private.handle_new_user() from public;
revoke execute on function private.sync_user_email() from public;
revoke execute on function private.is_staff() from public, anon;
grant  execute on function private.is_staff() to authenticated;   -- policies call it as the caller
revoke execute on function private.assert_staff() from public, anon, authenticated;

-- rollback (local only). Drop the auth.users triggers FIRST, or new sign-ups fail:
--   drop trigger if exists on_auth_user_email_changed on auth.users;
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function private.assert_staff(); drop function private.is_staff();
--   drop function private.sync_user_email(); drop function private.handle_new_user();
--   drop table public.profiles;
