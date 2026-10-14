-- Booking core · migration 3/7 · catalog
-- DATA_MODEL §2.2–2.4, §4.3, §11 #3. ADR-011 / ADR-014: the DB row is the enforcement source.

-- StudioRules singleton. Vocabulary mirrors booking/domain StudioRules.
create table public.studio_settings (
  id                           smallint primary key default 1 check (id = 1),
  timezone                     text not null default 'America/Argentina/Buenos_Aires',
  booking_opens_days           int  not null default 30  check (booking_opens_days between 1 and 365),
  booking_closes_minutes       int  not null default 0   check (booking_closes_minutes between 0 and 1440),
  cancellation_window_hours    int  not null default 24  check (cancellation_window_hours between 0 and 168),
  late_cancel_policy           text not null default 'allow_without_refund'
                                 check (late_cancel_policy in ('allow_without_refund', 'deny')),
  student_cancellation_enabled boolean not null default true,
  credits_per_booking          int  not null default 1   check (credits_per_booking between 1 and 10),
  waitlist_enabled             boolean not null default false,
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles(id)
);

-- A CHECK cannot query a catalog view, so the timezone is validated by trigger.
create function private.validate_studio_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function private.validate_studio_timezone() from public;

create trigger studio_settings_validate_timezone before insert or update of timezone on public.studio_settings
  for each row execute function private.validate_studio_timezone();
create trigger studio_settings_touch_updated_at before update on public.studio_settings
  for each row execute function private.touch_updated_at();

-- One Supabase project per studio (DATA_MODEL §1): this project is Bylou's, so the singleton
-- carries the owner decision of 2026-10-13 (ADR-011): free cancellation up to 24 h, then deny.
insert into public.studio_settings (id, timezone, cancellation_window_hours, late_cancel_policy)
values (1, 'America/Argentina/Buenos_Aires', 24, 'deny');

create table public.class_types (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name                     text not null check (char_length(name) between 1 and 80),
  description              text check (char_length(description) <= 2000),
  default_duration_minutes int  not null check (default_duration_minutes between 10 and 480),
  default_capacity         int  not null check (default_capacity between 1 and 100),
  default_modality         text not null check (default_modality in ('in_person', 'online')),
  is_published             boolean not null default false,
  sort_order               int not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger class_types_touch_updated_at before update on public.class_types
  for each row execute function private.touch_updated_at();

-- Every column here is safe for anon. Anything private lives in session_private_details.
create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  class_type_id   uuid not null references public.class_types(id) on delete restrict,
  series_id       uuid,          -- = admin request key; groups weekly repeats; create_session idempotency
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        int  not null check (capacity between 1 and 100),
  confirmed_count int  not null default 0,   -- maintained ONLY by RPCs under the session row lock
  modality        text not null check (modality in ('in_person', 'online')),
  instructor_name text check (char_length(instructor_name) <= 80),
  location_label  text check (char_length(location_label) <= 80),
  public_note     text check (char_length(public_note) <= 280),
  status          text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  is_published    boolean not null default true,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sessions_time_order        check (ends_at > starts_at),
  constraint sessions_max_duration      check (ends_at - starts_at <= interval '8 hours'),
  constraint sessions_no_overbooking    check (confirmed_count between 0 and capacity),  -- I1 backstop
  constraint sessions_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint sessions_series_unique     unique (series_id, starts_at)
);
create index sessions_agenda_idx on public.sessions (starts_at) where status = 'scheduled' and is_published;
create index sessions_class_type_idx on public.sessions (class_type_id);
create trigger sessions_touch_updated_at before update on public.sessions
  for each row execute function private.touch_updated_at();

create table public.session_private_details (
  session_id   uuid primary key references public.sessions(id) on delete cascade,
  meeting_url  text check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  address      text check (char_length(address) <= 300),
  instructions text check (char_length(instructions) <= 1000)   -- attendee-visible; no staff-only notes
);

-- Spots left without exposing who booked. security_invoker keeps the caller's RLS (PG15+);
-- the inner join also hides sessions of unpublished class types from anon.
create view public.session_availability with (security_invoker = true) as
select s.id, s.class_type_id, ct.slug as class_type_slug, ct.name as class_type_name,
       s.starts_at, s.ends_at, s.modality, s.instructor_name, s.location_label, s.public_note,
       s.capacity, s.confirmed_count, greatest(s.capacity - s.confirmed_count, 0) as spots_left, s.status
  from public.sessions s
  join public.class_types ct on ct.id = s.class_type_id;

-- rollback (local only; no user data yet at this point):
--   drop view public.session_availability;
--   drop table public.session_private_details; drop table public.sessions;
--   drop table public.class_types; drop table public.studio_settings;
--   drop function private.validate_studio_timezone();
