# Booking Core — Data Model, Permissions, Transactions

Updated 2026-10-13 · Phase 1 design. Implements ADR-002, ADR-004, ADR-005, ADR-006 and the ADR-011 defaults in [DECISIONS](./DECISIONS.md). Result codes and TS contracts: [ARCHITECTURE](./ARCHITECTURE.md) §3 and §5. Stories: [PRD](./PRD.md). Delivery: [ROADMAP](./ROADMAP.md) 3.1–3.2, 4.x.

> **Status of the SQL below:** reviewed sketches, **not executed** (no Supabase project or local stack exists yet). Phase 3 turns them into migrations under `supabase/migrations/` and proves them with the test plan in §12.

---

## 1. Entity map

| Vocabulary | Table | Phase | Notes |
|---|---|---|---|
| Profile | `profiles` | 3 | 1:1 with `auth.users`; holds `role`. |
| StudioRules | `studio_settings` | 3 | Singleton row. DB is the enforcement source; brand config only seeds defaults (ADR-014). |
| ClassType | `class_types` | 3 | Catalog. |
| Session | `sessions` | 3 | Public-safe columns only, plus a `confirmed_count` counter. |
| — | `session_private_details` | 3 | `meeting_url`, `address`: staff + confirmed attendees only. |
| Booking | `bookings` | 3 | Never deleted. Attendance lives here (no separate table). |
| CreditGrant | `credit_grants` | 3 (SQL/seed), 4 (admin UI) | A pack: N credits, validity window. |
| CreditLedgerEntry | `credit_ledger` | 3 | Append-only. |
| WaitlistEntry | `waitlist_entries` | 4 | Behind `features.waitlist`. |

**Deliberately not tables in MVP**

| Candidate | Decision | Why |
|---|---|---|
| `instructors` | `sessions.instructor_name text` | Lou is the only instructor; no instructor login, payroll or permissions in MVP. Promote to a table when an instructor role exists (V2). |
| `locations` | `sessions.location_label text` (public) + `session_private_details.address` (private) | Places are "studio / terrace / home / online", not branches (REFERENCE_ANALYSIS). Splitting public label from private address is the privacy requirement. |
| `plans`, `memberships` | `credit_grants` | ADR-006: admin grants a pack after off-platform payment. A plan catalog adds nothing until payments exist. |
| `attendance` | `bookings.attendance` | One value per booking; a separate table only adds joins. |
| `audit_log` | Ledger + `*_by`/`*_at` columns | Credits are fully audited by the ledger; bookings keep who/when for create, cancel, attendance. A generic audit table is V2. |
| `studio_id` / tenants | Not modeled | White-label = **one Supabase project per studio**. Multi-tenant is out of MVP scope (Open issue 8). |

---

## 2. Schema (SQL sketch)

```sql
-- 0. Baseline -------------------------------------------------------------
create schema if not exists private;             -- not exposed by the Data API
revoke all on schema private from public;
grant usage on schema private to authenticated;  -- needed to evaluate private.is_staff() in policies

-- Supabase grants new tables/functions to anon+authenticated by default. Turn that off;
-- every grant in this design is explicit.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- 1. profiles -------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,                       -- copied from auth.users (see trigger)
  display_name text check (char_length(display_name) between 1 and 80),
  phone        text check (phone ~ '^\+?[0-9 ()-]{6,20}$'),
  role         text not null default 'student' check (role in ('student', 'staff')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Profile creation: role is ALWAYS the default; never read from raw_user_meta_data (user-editable).
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.sync_user_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_user_email();

-- Role check used by RLS and RPCs. SECURITY DEFINER avoids recursion through profiles RLS.
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'staff'
  )
$$;
revoke execute on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated;

-- 2. studio_settings (StudioRules) ----------------------------------------
create table public.studio_settings (
  id                           smallint primary key default 1 check (id = 1),
  timezone                     text not null default 'America/Argentina/Buenos_Aires',
  booking_opens_days           int  not null default 30  check (booking_opens_days between 1 and 365),
  booking_closes_minutes       int  not null default 0   check (booking_closes_minutes between 0 and 1440),
  cancellation_window_hours    int  not null default 24  check (cancellation_window_hours between 0 and 168),
  late_cancel_policy           text not null default 'allow_without_refund'   -- platform default (ADR-011)
                                    check (late_cancel_policy in ('allow_without_refund', 'deny')),  -- = domain LateCancelPolicy
  student_cancellation_enabled boolean not null default true,
  credits_per_booking          int  not null default 1   check (credits_per_booking between 1 and 10),
  waitlist_enabled             boolean not null default false,
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles(id)
);
-- Singleton row (migration 3 + seed) is seeded from brands/bylou rules (ADR-014): Bylou = 24 h + 'deny'.
--   insert into public.studio_settings (id, cancellation_window_hours, late_cancel_policy) values (1, 24, 'deny');
-- Trigger validates timezone: exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone).
-- (A CHECK cannot query a catalog view.)

-- 3. class_types ----------------------------------------------------------
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

-- 4. sessions -------------------------------------------------------------
-- Every column here is safe for anon. Anything private goes to session_private_details.
create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  class_type_id   uuid not null references public.class_types(id) on delete restrict,
  series_id       uuid,          -- = admin request key; groups weekly repeats; idempotency for create_session
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
  constraint sessions_no_overbooking    check (confirmed_count between 0 and capacity),  -- DB backstop for journey B
  constraint sessions_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint sessions_series_unique     unique (series_id, starts_at)
);
create index sessions_agenda_idx on public.sessions (starts_at) where status = 'scheduled' and is_published;

create table public.session_private_details (
  session_id   uuid primary key references public.sessions(id) on delete cascade,
  meeting_url  text check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  address      text check (char_length(address) <= 300),
  instructions text check (char_length(instructions) <= 1000)   -- attendee-visible; no staff-only notes here
);

-- 5. credit_grants (CreditGrant) ------------------------------------------
create table public.credit_grants (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete restrict,
  credits_total     int  not null check (credits_total between 1 and 100),
  credits_remaining int  not null,
  valid_from        timestamptz not null default now(),
  expires_at        timestamptz not null,
  note              text check (char_length(note) <= 200),   -- e.g. "Pack 4 · transferencia"
  granted_by        uuid not null references public.profiles(id),
  idempotency_key   uuid not null,
  created_at        timestamptz not null default now(),
  constraint grants_remaining_bounds check (credits_remaining between 0 and credits_total),
  constraint grants_validity         check (expires_at > valid_from),
  constraint grants_idempotency      unique (granted_by, idempotency_key)
);
create index grants_user_usable_idx on public.credit_grants (user_id, expires_at) where credits_remaining > 0;

-- 6. bookings (Booking) ---------------------------------------------------
create table public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references public.sessions(id) on delete restrict,
  user_id              uuid not null references public.profiles(id) on delete restrict,
  status               text not null default 'confirmed'
                         check (status in ('confirmed', 'cancelled', 'late_cancelled')),
  attendance           text not null default 'unknown'
                         check (attendance in ('unknown', 'attended', 'no_show')),
  source               text not null default 'student' check (source in ('student', 'waitlist', 'staff')),
  idempotency_key      uuid not null,
  credit_grant_id      uuid references public.credit_grants(id) on delete restrict,
  credits_debited      int  not null default 0 check (credits_debited >= 0),
  refunded             boolean not null default false,
  created_at           timestamptz not null default now(),
  created_by           uuid not null references public.profiles(id),
  cancelled_at         timestamptz,
  cancelled_by         uuid references public.profiles(id),
  cancel_request_key   uuid,                       -- recorded for audit; cancel replay is state-based
  attendance_marked_at timestamptz,
  attendance_marked_by uuid references public.profiles(id),
  constraint bookings_cancel_consistent    check ((status = 'confirmed') = (cancelled_at is null)),
  constraint bookings_refund_only_cancel   check (not refunded or status = 'cancelled'),
  constraint bookings_attendance_confirmed check (attendance = 'unknown' or status = 'confirmed'),
  constraint bookings_credit_consistent    check ((credit_grant_id is null) = (credits_debited = 0)),
  constraint bookings_idempotency          unique (user_id, idempotency_key)
);
-- Invariant (ADR-011): one active booking per student per session.
create unique index bookings_one_active on public.bookings (session_id, user_id) where status = 'confirmed';
create index bookings_user_idx    on public.bookings (user_id, created_at desc);
create index bookings_session_idx on public.bookings (session_id) where status = 'confirmed';

-- 7. credit_ledger (CreditLedgerEntry) — append-only ------------------------
create table public.credit_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete restrict,
  grant_id   uuid not null references public.credit_grants(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  reason     text not null check (reason in ('grant', 'booking_debit', 'cancel_refund', 'expiry', 'admin_adjust')),
  delta      int  not null check (delta <> 0),
  actor_id   uuid references public.profiles(id),     -- null = system job
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  constraint ledger_sign check (
       (reason in ('grant', 'cancel_refund') and delta > 0)
    or (reason in ('booking_debit', 'expiry') and delta < 0)
    or  reason = 'admin_adjust'),
  constraint ledger_booking_link check ((reason in ('booking_debit', 'cancel_refund')) = (booking_id is not null)),
  constraint ledger_adjust_note  check (reason <> 'admin_adjust' or note is not null)
);
-- Structural "never twice" guarantees (journey C/D backstops):
create unique index ledger_one_debit_per_booking  on public.credit_ledger (booking_id) where reason = 'booking_debit';
create unique index ledger_one_refund_per_booking on public.credit_ledger (booking_id) where reason = 'cancel_refund';
create unique index ledger_one_grant_entry        on public.credit_ledger (grant_id)   where reason = 'grant';
create unique index ledger_one_expiry_per_grant   on public.credit_ledger (grant_id)   where reason = 'expiry';
create index ledger_user_idx on public.credit_ledger (user_id, created_at desc);

create function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger credit_ledger_append_only before update or delete or truncate on public.credit_ledger
  for each statement execute function private.forbid_mutation();

-- 8. waitlist_entries (WaitlistEntry) — Phase 4 -----------------------------
create table public.waitlist_entries (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.sessions(id) on delete restrict,
  user_id             uuid not null references public.profiles(id) on delete restrict,
  status              text not null default 'waiting' check (status in ('waiting', 'promoted', 'skipped', 'left')),
  skip_reason         text check (skip_reason in ('no_valid_credit', 'already_booked', 'session_cancelled')),
  promoted_booking_id uuid references public.bookings(id),
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  constraint waitlist_resolved check ((status = 'waiting') = (resolved_at is null)),
  constraint waitlist_promoted check ((status = 'promoted') = (promoted_booking_id is not null)),
  constraint waitlist_skipped  check ((status = 'skipped') = (skip_reason is not null))
);
create unique index waitlist_one_waiting on public.waitlist_entries (session_id, user_id) where status = 'waiting';
create index waitlist_fifo on public.waitlist_entries (session_id, created_at, id) where status = 'waiting';
-- Phase 4 also adds sessions.waiting_count int not null default 0 (same counter pattern as confirmed_count).
```

`updated_at` triggers (`private.touch_updated_at`) on `profiles`, `studio_settings`, `class_types`, `sessions`.

---

## 3. Invariants and where they are enforced

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Confirmed bookings ≤ capacity | RPC check under session lock **and** `sessions_no_overbooking` CHECK on the counter |
| I2 | `confirmed_count` = count of `confirmed` bookings | Only RPCs write it, always in the same transaction as the booking change, under the session lock; reconciliation test (§12) |
| I3 | One active booking per (session, user) | Partial unique index `bookings_one_active` |
| I4 | One booking per (user, idempotency key) | Unique `bookings_idempotency` |
| I5 | Never negative credits; never more than granted | `grants_remaining_bounds` CHECK |
| I6 | `credits_remaining` = Σ ledger `delta` for that grant | All grant writes paired with a ledger insert in the same RPC; reconciliation test |
| I7 | At most one debit and one refund per booking | `ledger_one_debit_per_booking`, `ledger_one_refund_per_booking` |
| I8 | Ledger is append-only | No grants + `credit_ledger_append_only` trigger (blocks even the owner, except a deliberate trigger drop) |
| I9 | Students cannot change role, capacity, or anyone else's data | No write privileges on business tables; column-limited `profiles` update; RLS (§4) |
| I10 | Bookings and sessions are never hard-deleted | No DELETE privilege; FKs `on delete restrict` |

---

## 4. Privileges and RLS

Two layers, both default-deny: **table privileges** (GRANT) decide whether a role may touch a table at all; **RLS** decides which rows. RLS is enabled on every table. RPCs are `SECURITY DEFINER`, owned by `postgres` (table owner, bypasses RLS), so they are the only write path.

### 4.1 Matrix

`—` = no privilege (request fails with permission denied). `RPC` = only through a SECURITY DEFINER function.

| Table | Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `profiles` | anon | — | — | — | — |
| | student | own row | — (trigger) | own row, columns `display_name`, `phone` only | — |
| | staff | all | — | — (role changes: owner via SQL only) | — |
| `studio_settings` | anon / student | the row | — | — | — |
| | staff | the row | — | RPC `admin_update_settings` | — |
| `class_types` | anon | `is_published` | — | — | — |
| | student | `is_published` or has a booking of that type | — | — | — |
| | staff | all | RPC | RPC | — (unpublish instead) |
| `sessions` | anon | `is_published and status = 'scheduled'` | — | — | — |
| | student | same, plus any session they hold a booking for | — | — | — |
| | staff | all | RPC | RPC | — |
| `session_private_details` | anon | — | — | — | — |
| | student | only with a `confirmed` own booking for that session | — | — | — |
| | staff | all | RPC | RPC | — |
| `bookings` | anon | — | — | — | — |
| | student | own | RPC | RPC | — |
| | staff | all | RPC | RPC | — |
| `credit_grants` | anon | — | — | — | — |
| | student | own | — | RPC (debit/refund side effects) | — |
| | staff | all | RPC | RPC | — |
| `credit_ledger` | anon | — | — | — | — |
| | student | own | RPC (side effect) | never | never |
| | staff | all | RPC | never | never |
| `waitlist_entries` | anon | — | — | — | — |
| | student | own | RPC | RPC | — |
| | staff | all | RPC | RPC | — |
| view `session_availability` | anon / student / staff | rows allowed by `sessions` + `class_types` RLS | — | — | — |

### 4.2 Grants and policies (sketch)

```sql
-- Table privileges: nothing for anon except public catalog; no write privilege for anyone.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.studio_settings, public.class_types, public.sessions to anon;
grant select on all tables in schema public to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;   -- role/email not updatable

alter table public.profiles                enable row level security;
alter table public.studio_settings         enable row level security;
alter table public.class_types             enable row level security;
alter table public.sessions                enable row level security;
alter table public.session_private_details enable row level security;
alter table public.bookings                enable row level security;
alter table public.credit_grants           enable row level security;
alter table public.credit_ledger           enable row level security;
alter table public.waitlist_entries        enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy settings_select on public.studio_settings for select to anon, authenticated using (true);

create policy class_types_select_public on public.class_types for select to anon using (is_published);
create policy class_types_select_auth on public.class_types for select to authenticated
  using (is_published or (select private.is_staff())
         or exists (select 1 from public.bookings b join public.sessions s on s.id = b.session_id
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

-- Same "own or staff" shape for bookings, credit_grants, credit_ledger, waitlist_entries:
create policy bookings_select on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_staff()));
-- (repeat for credit_grants, credit_ledger, waitlist_entries)
-- No INSERT/UPDATE/DELETE policies on business tables: RLS denies them even if a grant slips in.
```

Notes:
- `auth.uid()` is `null` for anon, so `user_id = auth.uid()` never matches; policies are additionally scoped `to authenticated`, so they are not even evaluated for anon.
- `(select auth.uid())` / `(select private.is_staff())` are wrapped so Postgres evaluates them once per statement (initPlan), per Supabase RLS performance guidance.
- `is_staff()` reads `profiles.role`, never JWT `user_metadata` (user-editable, ADR-005). The first staff account is promoted by the owner with SQL in the dashboard; no API path changes roles.

### 4.3 Exposing spots left without exposing who booked

`sessions.confirmed_count` is an aggregate stored on a public-safe row, so availability needs **no** read access to `bookings` and **no** security-definer view.

```sql
create view public.session_availability with (security_invoker = true) as
select s.id, s.class_type_id, ct.slug as class_type_slug, ct.name as class_type_name,
       s.starts_at, s.ends_at, s.modality, s.instructor_name, s.location_label, s.public_note,
       s.capacity, s.confirmed_count, greatest(s.capacity - s.confirmed_count, 0) as spots_left, s.status
from public.sessions s
join public.class_types ct on ct.id = s.class_type_id;   -- inner join also hides sessions of unpublished types

revoke all on public.session_availability from anon, authenticated;
grant select on public.session_availability to anon, authenticated;
```

Why not a `SECURITY DEFINER` view or `count(*)` RPC: Supabase warns that views run as their (RLS-bypassing) owner by default; one wrong column leaks every row. `security_invoker = true` (Postgres 15+) keeps the caller's RLS. The counter also gives the CHECK backstop for I1. This satisfies ARCHITECTURE's `SessionAvailability.confirmedCount` without exposing any booking row. A student's own state (`myBookingId`) comes from their own `bookings` rows.

---

## 5. RPC conventions

| Rule | Detail |
|---|---|
| Definition | `language plpgsql volatile security definer set search_path = ''`; every relation schema-qualified. `volatile` matters: under READ COMMITTED each statement in a volatile function takes a fresh snapshot, which the re-checks after a lock rely on. |
| Exposure | Public RPCs live in `public` (Data API). Helpers live in `private` (not exposed) with `revoke execute ... from public` and no grants. |
| Execute grants | `revoke execute on function ... from public, anon;` then `grant execute ... to authenticated;`. Postgres grants EXECUTE to PUBLIC by default; revoking only `anon` is not enough. |
| Authorization | Every RPC checks `auth.uid()` in its body; admin RPCs call `private.assert_staff()` (raises `42501`). Execute grants do not limit which rows a definer function touches. |
| Business outcome | Returns `jsonb` with HTTP 200: `{ ok: true, code: null, ... }` or `{ ok: false, code: <reason>, ... }`. A rejection performs **no writes**. |
| Transport errors | Raised: `42501` → `unauthenticated` / `forbidden`; `22023` → `invalid_input` (malformed args, idempotency key reused for a different target). Mapped by the adapter (ARCHITECTURE §5). |
| Time | `now()` is the transaction start time; all comparisons use it once, so a single call is internally consistent. |

```sql
create function private.fail(p_code text, p_extra jsonb default '{}') returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'code', p_code) || p_extra
$$;

create function private.assert_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if not private.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;
```

### 5.1 Global lock order (deadlock avoidance)

Every transaction acquires row locks in this order and never goes back up the list:

1. **`sessions`** — at most one row per transaction.
2. **`bookings`** — ordered by `id` when more than one.
3. **`waitlist_entries`** — ordered by `(created_at, id)`.
4. **`credit_grants`** — **in a single statement, ordered by `id`**; no further grant locks afterwards.

Rule 4 is what makes cross-user operations (refund to A + promote B) deadlock-free: two transactions can only wait on each other's grants if they acquire them in different orders, and one ordered statement per transaction rules that out. Exceptions, each justified:
- `mark_attendance` locks one booking without its session: it never waits on anything else, so it cannot close a cycle.
- `private.expire_credit_grants` uses `for update skip locked`: it never waits, so it cannot deadlock; skipped grants are handled on the next run (correctness never depends on the job, §8).

Deadlocks are still detected by Postgres (`40P01`); the adapter maps it to `network_error` and the client retries with the **same** key, which is safe by idempotency.

---

## 6. RPC specs

### 6.1 `book_session(p_session_id uuid, p_idempotency_key uuid) → jsonb`

Grant: `authenticated`. Client generates `idempotency_key = crypto.randomUUID()` once per confirm sheet and reuses it on retry (ARCHITECTURE flow).

Check order: replay → `not_found` → `session_cancelled` → `session_started` → `booking_not_open` → `booking_closed` → `already_booked` → `session_full` → `no_valid_credit`.

Success: `{ ok: true, code: null, booking_id, session_id, status: 'confirmed', replayed: false, credits_debited, grant_expires_at, remaining_credits, spots_left }`.
Replay: same shape with `replayed: true` and the booking's **current** status.

```sql
create function public.book_session(p_session_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_rules   public.studio_settings%rowtype;
  v_session public.sessions%rowtype;
  v_prior   public.bookings%rowtype;
  v_grant   public.credit_grants%rowtype;
  v_booking uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_session_id is null or p_idempotency_key is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- (a) Fast replay, no locks.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  select * into v_rules from public.studio_settings where id = 1;

  -- (b) LOCK 1: the session row. Serializes every booker of this session.
  select * into v_session from public.sessions where id = p_session_id and is_published for update;
  if not found then return private.fail('not_found'); end if;

  -- (c) Replay re-check: a concurrent call with the same key may have committed while we waited.
  select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return private.booking_replay(v_prior, p_session_id); end if;

  -- (d) Rules (v_session is the latest committed version: FOR UPDATE returns the updated row).
  if v_session.status = 'cancelled' then return private.fail('session_cancelled'); end if;
  if now() >= v_session.starts_at then return private.fail('session_started'); end if;
  if now() < v_session.starts_at - make_interval(days => v_rules.booking_opens_days) then
    return private.fail('booking_not_open', jsonb_build_object('opens_at',
      v_session.starts_at - make_interval(days => v_rules.booking_opens_days)));
  end if;
  if now() > v_session.starts_at - make_interval(mins => v_rules.booking_closes_minutes) then
    return private.fail('booking_closed');
  end if;
  select * into v_prior from public.bookings
   where session_id = v_session.id and user_id = v_uid and status = 'confirmed';
  if found then return private.fail('already_booked', jsonb_build_object('booking_id', v_prior.id)); end if;
  if v_session.confirmed_count >= v_session.capacity then return private.fail('session_full'); end if;

  -- (e) LOCK 2: all usable grants, one statement, ordered by id; then pick earliest-expiring.
  --     The locking subquery is not flattened, so every candidate is locked (no LIMIT-under-lock
  --     false negatives) and the WHERE is re-evaluated against each row's latest version.
  select * into v_grant from (
    select g.* from public.credit_grants g
     where g.user_id = v_uid
       and g.credits_remaining >= v_rules.credits_per_booking
       and g.valid_from <= now()
       and g.expires_at > v_session.starts_at          -- must still be valid when the class happens
     order by g.id
     for update
  ) usable
  order by usable.expires_at, usable.id
  limit 1;
  if not found then return private.fail('no_valid_credit'); end if;

  -- (f) Writes: booking, grant, ledger, counter. One transaction; all or nothing.
  insert into public.bookings (session_id, user_id, idempotency_key, credit_grant_id, credits_debited, source, created_by)
  values (v_session.id, v_uid, p_idempotency_key, v_grant.id, v_rules.credits_per_booking, 'student', v_uid)
  returning id into v_booking;

  update public.credit_grants set credits_remaining = credits_remaining - v_rules.credits_per_booking
   where id = v_grant.id;
  insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
  values (v_uid, v_grant.id, v_booking, 'booking_debit', -v_rules.credits_per_booking, v_uid);
  update public.sessions set confirmed_count = confirmed_count + 1 where id = v_session.id;

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking, 'session_id', v_session.id,
    'status', 'confirmed', 'replayed', false, 'credits_debited', v_rules.credits_per_booking,
    'grant_expires_at', v_grant.expires_at,
    'remaining_credits', private.usable_balance(v_uid),
    'spots_left', v_session.capacity - v_session.confirmed_count - 1);
exception
  when unique_violation then
    -- Backstop only (the lock makes this unreachable for same-session races). The block's writes
    -- are rolled back; resolve to a replay, a conflict, or already_booked.
    select * into v_prior from public.bookings where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return private.booking_replay(v_prior, p_session_id); end if;
    return private.fail('already_booked');
end $$;

revoke execute on function public.book_session(uuid, uuid) from public, anon;
grant execute on function public.book_session(uuid, uuid) to authenticated;

-- Same key + same session → original result (current status). Same key + other session → client bug.
create function private.booking_replay(p_prior public.bookings, p_session_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if p_prior.session_id <> p_session_id then
    raise exception 'idempotency key reused for a different session' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'code', null, 'booking_id', p_prior.id, 'session_id', p_prior.session_id,
    'status', p_prior.status, 'replayed', true, 'credits_debited', p_prior.credits_debited,
    'remaining_credits', private.usable_balance(p_prior.user_id));
end $$;
```

`private.usable_balance(uid)` = `sum(credits_remaining)` over grants with `valid_from <= now() < expires_at` (§8).

### 6.2 `cancel_booking(p_booking_id uuid, p_idempotency_key uuid default null, p_accept_late boolean default false) → jsonb`

Grant: `authenticated`. Matches ARCHITECTURE `cancel({ bookingId, idempotencyKey, acceptLate })`; the key is recorded (`cancel_request_key`) but replay is **state-based**: a booking can leave `confirmed` only once, so a repeated cancel returns the current outcome and never refunds twice (also enforced by `ledger_one_refund_per_booking`).

| Situation | Result |
|---|---|
| Unknown id | `not_found` |
| Someone else's booking | `not_owner` (UI shows the `not_found` copy) |
| Already `cancelled` / `late_cancelled` | `ok: true, replayed: true`, current `status`, `refunded` |
| Session started (`now ≥ starts_at`), student cancellation disabled, or attendance already marked | `cancellation_not_allowed` |
| Inside window, policy `deny` (**Bylou**) | `cancellation_too_late` (`ok: false`, no writes, `{ refund: false, confirm_required: false }`) → UI shows `cancel.closed` (contact Lou); `p_accept_late` is ignored |
| Inside window, policy `allow_without_refund`, `p_accept_late = false` | `cancellation_too_late` (`ok: false`, no writes, `{ refund: false, confirm_required: true }`) → UI warns, re-calls with `p_accept_late = true` |
| Inside window, policy `allow_without_refund`, accepted | `late_cancelled`, no refund, spot freed |
| Outside window (`now ≤ starts_at − cancellation_window_hours`) | `cancelled`; refund to the original grant **if it is still valid now** (`expires_at > now()`), else `refunded: false` |

`p_accept_late` is only relevant when `late_cancel_policy = 'allow_without_refund'` (kept for platform studios; Bylou never sends it). It guards against a stale screen: a cancel rendered at 24h05m and tapped at 23h55m must not silently forfeit a credit.

```sql
create function public.cancel_booking(p_booking_id uuid, p_idempotency_key uuid default null,
                                      p_accept_late boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_rules public.studio_settings%rowtype;
  v_session public.sessions%rowtype;
  v_booking public.bookings%rowtype;
  v_session_id uuid; v_owner uuid;
  v_late boolean; v_refunded boolean := false;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '42501'; end if;

  -- Unlocked read only to learn the session (lock order: session before booking).
  select session_id, user_id into v_session_id, v_owner from public.bookings where id = p_booking_id;
  if not found then return private.fail('not_found'); end if;
  if v_owner <> v_uid then return private.fail('not_owner'); end if;

  select * into v_rules   from public.studio_settings where id = 1;
  select * into v_session from public.sessions where id = v_session_id for update;   -- LOCK 1
  select * into v_booking from public.bookings where id = p_booking_id for update;   -- LOCK 2

  if v_booking.status <> 'confirmed' then                                            -- state replay
    return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id,
      'status', v_booking.status, 'refunded', v_booking.refunded, 'replayed', true);
  end if;
  if now() >= v_session.starts_at
     or not v_rules.student_cancellation_enabled
     or v_booking.attendance <> 'unknown' then
    return private.fail('cancellation_not_allowed');
  end if;

  v_late := now() > v_session.starts_at - make_interval(hours => v_rules.cancellation_window_hours);
  if v_late and v_rules.late_cancel_policy = 'deny' then                 -- Bylou: block, contact the studio
    return private.fail('cancellation_too_late', '{"refund": false, "confirm_required": false}');
  end if;
  if v_late and not p_accept_late then
    return private.fail('cancellation_too_late', '{"refund": false, "confirm_required": true}');
  end if;

  update public.bookings
     set status = case when v_late then 'late_cancelled' else 'cancelled' end,
         cancelled_at = now(), cancelled_by = v_uid, cancel_request_key = p_idempotency_key
   where id = v_booking.id;
  update public.sessions set confirmed_count = confirmed_count - 1 where id = v_session.id;

  -- Phase 4: LOCK 3 waitlist entries (created_at, id) here, before grants.

  -- LOCK 4 (one ordered statement): refund grant + (Phase 4) every waiting user's usable grants.
  perform 1 from public.credit_grants g
   where (not v_late and g.id = v_booking.credit_grant_id)
      -- or (v_promote and g.user_id in (select user_id from public.waitlist_entries
      --                                  where session_id = v_session.id and status = 'waiting'))
   order by g.id
   for update;

  if not v_late and v_booking.credit_grant_id is not null then
    update public.credit_grants set credits_remaining = credits_remaining + v_booking.credits_debited
     where id = v_booking.credit_grant_id and expires_at > now();
    if found then
      insert into public.credit_ledger (user_id, grant_id, booking_id, reason, delta, actor_id)
      values (v_uid, v_booking.credit_grant_id, v_booking.id, 'cancel_refund', v_booking.credits_debited, v_uid);
      update public.bookings set refunded = true where id = v_booking.id;
      v_refunded := true;
    end if;
  end if;

  -- Phase 4: perform private.promote_waitlist_locked(v_session.id);   (§6.7)

  return jsonb_build_object('ok', true, 'code', null, 'booking_id', v_booking.id,
    'status', case when v_late then 'late_cancelled' else 'cancelled' end,
    'refunded', v_refunded, 'replayed', false);
end $$;
-- revoke from public, anon; grant to authenticated (as above).
```

### 6.3 `create_session(...) → jsonb` (admin)

```
create_session(p_request_key uuid, p_class_type_id uuid, p_local_date date, p_local_start time,
               p_duration_minutes int default null, p_capacity int default null, p_modality text default null,
               p_instructor_name text default null, p_location_label text default null,
               p_meeting_url text default null, p_address text default null,
               p_repeat_weeks int default 1, p_is_published boolean default true)
```

- `private.assert_staff()`; `p_repeat_weeks` 1–12; defaults come from the class type.
- **Replay:** if any session has `series_id = p_request_key`, return their ids with `replayed: true` (double click never duplicates sessions).
- Times are built in **studio local wall time**, then converted: `starts_at := ((p_local_date + 7 * i) + p_local_start) at time zone v_rules.timezone`. This keeps 18:00 local across DST changes for studios that have DST.
- Rejects a start in the past (`22023`). Inserts `sessions` (+ `session_private_details` when URL/address given) with `series_id = p_request_key`.
- Returns `{ ok: true, code: null, session_ids: [...], replayed }`.

Companion admin RPCs (same pattern, Phase 3/4): `admin_update_session` (locks the session; capacity below `confirmed_count` → `{ ok: false, code: 'capacity_below_bookings' }`; capacity increase triggers waitlist promotion in Phase 4), `admin_update_settings`, `admin_upsert_class_type`.

### 6.4 `grant_credits(p_user_id uuid, p_credits int, p_valid_days int, p_note text, p_idempotency_key uuid) → jsonb` (admin)

- `assert_staff()`; target profile must exist (`not_found`); `p_credits` 1–100; `p_valid_days` 1–365.
- Replay on `(granted_by, idempotency_key)` → original grant, `replayed: true`.
- `expires_at := ((now() at time zone tz)::date + p_valid_days)::timestamp at time zone tz` — valid through the end of local day `grant_date + p_valid_days − 1` (a "30-day pack" granted Oct 13 covers Oct 13 – Nov 11 inclusive).
- Insert grant (`credits_remaining = credits_total`) + ledger `grant` (+credits, `actor_id` = staff). No other locks needed.
- Returns `{ ok: true, code: null, grant_id, credits, expires_at, replayed }`.

Companion: `admin_adjust_credits(p_grant_id, p_delta, p_note)` — locks one grant, keeps `0 ≤ remaining ≤ total`, writes `admin_adjust` with mandatory note. Adding credits beyond `credits_total` is a new grant, not an adjustment.

### 6.5 `mark_attendance(p_booking_id uuid, p_attendance text) → jsonb` (admin)

- `assert_staff()`; `p_attendance in ('unknown','attended','no_show')` else `22023`.
- `select ... from bookings where id = p_booking_id for update` (single lock, see §5.1).
- Booking not `confirmed` → `not_found` (nothing to mark). Window: `now() >= starts_at − 15 min` and `now() <= ends_at + 7 days` (UX_DESIGN "editable 7 days"), else `{ ok: false, code: 'attendance_window_closed' }`.
- Sets `attendance`, `attendance_marked_at`, `attendance_marked_by`. No credit effect in MVP (no-show penalties are V2). Idempotent by nature (setting the same value twice is a no-op).

### 6.6 `admin_cancel_session(p_session_id uuid, p_reason text default null) → jsonb` (admin)

Lock order: session → confirmed bookings (`order by id`) → waiting entries → grants of those bookings (one statement, `order by id`).

1. Session `cancelled` already → `{ ok: true, replayed: true, ... }`.
2. Every `confirmed` booking → `cancelled`, `cancelled_by` = staff. Refund **regardless of window** (studio's decision), to the original grant if `expires_at > now()`; ledger `cancel_refund`; `refunded = true`. Bookings whose grant already expired are listed in `refunds_skipped` for a manual grant (Open issue 4).
3. Waiting entries → `skipped` with `skip_reason = 'session_cancelled'`.
4. Session: `status = 'cancelled'`, `cancelled_at = now()`, `confirmed_count = 0`.
5. Returns `{ ok: true, code: null, session_id, cancelled_bookings, refunded, refunds_skipped: [booking_id] }`.

Allowed after start (e.g. instructor ill on the spot). Notifying students is out of MVP (PRD: on-screen only).

### 6.7 Waitlist (Phase 4): `promote_waitlist(p_session_id)` and `private.promote_waitlist_locked`

`private.promote_waitlist_locked(session_id)` — precondition: caller holds the session lock, the waiting-entry locks, and the grant locks of all waiting users (§5.1). Called from `cancel_booking`, `admin_update_session` (capacity increase) and the admin `promote_waitlist` RPC.

```
if not waitlist_enabled or now() > starts_at − cancellation_window_hours or status = 'cancelled': return
while confirmed_count < capacity and a waiting entry exists (FIFO by created_at, id):
  if user already has a confirmed booking        → entry skipped('already_booked')
  elif no grant with remaining ≥ credits_per_booking, valid_from ≤ now, expires_at > starts_at
                                                 → entry skipped('no_valid_credit')
  else: insert booking (source 'waitlist', idempotency_key = entry.id), debit earliest-expiring grant,
        ledger booking_debit, confirmed_count + 1, entry promoted(promoted_booking_id)
```

- `idempotency_key = entry.id` makes promotion of one entry structurally once-only (unique `(user_id, idempotency_key)`).
- Inside the cancellation window nobody is auto-promoted (ADR-011: a promoted student must still be able to cancel for free); freed spots become first-come bookable, waiting entries stay `waiting` until the session starts.
- Student RPCs: `join_waitlist(p_session_id)` (only when full: else `{ ok: false, code: 'session_not_full' }`; duplicate → returns the existing entry) and `leave_waitlist(p_entry_id)` (`left`, state-idempotent). Position = count of earlier `waiting` entries, returned by a definer function that returns only the number.

### 6.8 Expiry job — `private.expire_credit_grants()` (Phase 4)

```sql
create function private.expire_credit_grants() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id, user_id, credits_remaining from public.credit_grants
            where expires_at <= now() and credits_remaining > 0
            order by id
            for update skip locked
  loop
    update public.credit_grants set credits_remaining = 0 where id = r.id;
    insert into public.credit_ledger (user_id, grant_id, reason, delta, note)
    values (r.user_id, r.id, 'expiry', -r.credits_remaining, 'scheduled expiry');
    n := n + 1;
  end loop;
  return n;
end $$;
-- pg_cron is bundled but must be enabled: create extension if not exists pg_cron;
-- select cron.schedule('expire-credit-grants', '15 3 * * *', $$select private.expire_credit_grants()$$);  -- 00:15 ART
```

---

## 7. Concurrency analysis

All RPCs run at Postgres' default READ COMMITTED (PostgREST does not change it).

### Journey B — two students, last spot

Setup: capacity 8, `confirmed_count = 7`. Students A and B call `book_session` at the same instant.

| Step | Tx A | Tx B |
|---|---|---|
| 1 | `select ... from sessions where id = S for update` → lock acquired, sees count 7 | same statement → **blocks** on A's row lock |
| 2 | checks pass, inserts booking, debits, `confirmed_count = 8`, commits | — |
| 3 | — | lock granted; per READ COMMITTED rules the `FOR UPDATE` returns the **updated** row version (count 8) |
| 4 | — | `confirmed_count >= capacity` → `session_full`, no writes |

**Why a plain count fails without the lock.** Without `FOR UPDATE`, both transactions run `select count(*) from bookings where session_id = S and status = 'confirmed'`. Each statement sees a snapshot of rows committed **before it started**; neither sees the other's uncommitted insert, so both read 7, both insert, and the session ends with 9 confirmed. No unique index catches it (different users). Re-reading after the insert does not help either: the other insert is still uncommitted. The fix must make the second transaction wait for the first; the session row lock does exactly that, and the follow-up statements see A's committed state because a volatile plpgsql function takes a new snapshot per statement.

**Backstop.** Even if a future RPC forgot the lock, `update sessions set confirmed_count = confirmed_count + 1` itself takes the row lock and re-evaluates on the latest version, and `sessions_no_overbooking` (`confirmed_count <= capacity`) would abort the 9th booking. Two independent mechanisms guard I1. SERIALIZABLE would also prevent the anomaly, but it fails with `40001` and needs retry loops in every caller; the explicit lock is simpler and deterministic.

### Journey C — retry / double click

| Case | Mechanism | Outcome |
|---|---|---|
| Same key, sequential (retry after timeout; first call actually committed) | Step (a) finds the booking | Same `booking_id`, `replayed: true`; no new debit |
| Same key, concurrent (double tap, same sheet) | Second call blocks at LOCK 1; step (c) re-reads with a fresh snapshot and finds the first booking | Replay; one booking, one debit |
| Same key, different session (client bug) | Step (a)/(c) or unique `(user_id, idempotency_key)` | `invalid_input`, no writes |
| Different keys, same session (client regenerated the key) | Session lock + `already_booked` check; `bookings_one_active` unique index as backstop | `already_booked`; one debit |
| First call failed (e.g. `session_full`) and is retried | Failed calls write nothing, so the key is unused | Re-evaluated against current state (correct: no side effects to repeat) |
| Two sessions, one credit left, concurrent | Different session locks, but both lock the same grant at LOCK 2; the second's `WHERE credits_remaining >= 1` is re-evaluated on the updated row and excludes it | One `confirmed`, the other `no_valid_credit`; remaining never < 0 (also CHECK I5) |
| Double cancel | State replay; `ledger_one_refund_per_booking` | One refund |

### Journey D — cancel → refund + waitlist

Everything happens in one transaction under the session lock: booking status change, `confirmed_count − 1`, refund (grant + ledger), and (Phase 4) promotion of the next eligible waiting student with its own debit. Consequences:

- No observer can see a freed spot without the matching refund, or a promotion without its debit.
- A concurrent `book_session` for that session waits on the session lock; after commit it sees the post-promotion count, so the promoted student cannot be overtaken by a fresh booker (FIFO holds).
- Cross-user cycle (A cancels S1 where B waits; B cancels S2 where A waits, simultaneously): each transaction locks a different session, then locks **all** grants it needs (refund grant + waiting users' grants) in one `order by id` statement. Same global order ⇒ one waits for the other, no deadlock. Test D9.
- History is kept: the booking row stays (`cancelled`/`late_cancelled`, `cancelled_at`, `cancelled_by`), the ledger keeps both debit and refund, the waitlist entry keeps `promoted_booking_id`.

---

## 8. Credit model

| Topic | Rule |
|---|---|
| Unit | A **CreditGrant** = pack of `credits_total` credits, valid `[valid_from, expires_at)`. |
| Balance (display, ST-08) | `available = Σ credits_remaining` over own grants with `valid_from ≤ now() < expires_at`; `nextExpiry = min(expires_at)` among those with remaining > 0. Read directly via RLS (own grants). |
| Usable for a session | Grant must satisfy `expires_at > session.starts_at` (a pack expiring Friday cannot pay for next Monday). Open issue 3. |
| Consumption | `credits_per_booking` (default 1) from the **earliest-expiring** usable grant; ties by `id`. One booking debits exactly one grant. |
| Refund | Only on an in-window student cancel or an admin session cancel, to the **original** grant, only if `expires_at > now()` at cancel time. Otherwise no refund (student) or `refunds_skipped` (admin). |
| Expiry | **Lazy for correctness**: every read and every consumption filters by `expires_at`, so an expired grant is unusable the instant it expires, job or no job. **Scheduled job for audit** (daily, pg_cron): zeroes `credits_remaining` and writes one `expiry` ledger entry per grant, so the ledger explains every credit. If the job is late or unavailable, balances are still correct; only the audit row is delayed. |
| Audit | Every change to `credits_remaining` is paired with a ledger insert in the same transaction: `grant` (+), `booking_debit` (−), `cancel_refund` (+), `expiry` (−), `admin_adjust` (±, note required). Invariant I6 is tested. |

ARCHITECTURE §11 #5 asked how to refund into an expired grant: this model does not refund into it (it would be worthless); see Open issue 4 for the admin-cancel case.

---

## 9. Timezone

- Storage: every instant is `timestamptz` (UTC internally). The DB session timezone is never relied on.
- Studio time: `studio_settings.timezone` (default `America/Argentina/Buenos_Aires`, ADR-011). It drives:
  - **Display**: the client formats with `Intl.DateTimeFormat(locale, { timeZone: rules.timezone })`, not the browser's zone, so a student abroad sees studio time (PRD states the timezone on the agenda).
  - **"Day" semantics**: agenda day ranges are `[(d)::timestamp at time zone tz, (d + 1)::timestamp at time zone tz)`; pack validity ends at local midnight (§6.4); recurring sessions keep local wall time (§6.3).
- Durations are absolute: the 24 h cancellation window is `starts_at − interval '24 hours'`, not "the previous calendar day".
- Never use `now()::date` or `current_date` in SQL; always `(now() at time zone tz)::date`.
- pg_cron runs in UTC; schedules are written in UTC with the local equivalent commented.

---

## 10. Privacy

| Data | Where | Readable by | Notes |
|---|---|---|---|
| Email | `auth.users`, copied to `profiles.email` | Self, staff | Copy exists because the Data API cannot read `auth`; kept in sync by trigger. |
| Display name | `profiles.display_name` | Self, staff | Required at first sign-in (PRD ST-03). |
| Phone | `profiles.phone` | Self, staff | Optional; only for reminders. |
| Bookings, attendance | `bookings` | Self, staff | Never anon; other students never see who attends. |
| Credits / ledger | `credit_grants`, `credit_ledger` | Self, staff | |
| Meeting URL, address | `session_private_details` | Staff, holders of a `confirmed` booking for that session | Access ends when the booking is cancelled. |
| Instructor name, location label | `sessions` | Everyone | Business info, not student PII. |

Not collected: date of birth, document number, address of students, health data, payment data. Anon receives only catalog columns. Deletion: `on delete restrict` from bookings means an auth user with history cannot be hard-deleted; erasure requests need an anonymization procedure (Open issue 7).

---

## 11. Migrations plan

Supabase CLI, files under `supabase/migrations/<UTC timestamp>_<name>.sql` (created by `supabase migration new`). Applied locally with `supabase db reset`; production only by the owner (ARCHITECTURE §10, ADR-002 provisioning gate).

| # | File (name part) | Contents | Phase | Rollback note |
|---|---|---|---|---|
| 1 | `baseline_privileges` | `private` schema, default-privilege revokes, `touch_updated_at`, `forbid_mutation`, `fail` | 3 | Drop schema `private` cascade; restore default privileges |
| 2 | `profiles_auth` | `profiles`, auth triggers, `is_staff`, `assert_staff` | 3 | Drop triggers on `auth.users` **first**, then table/functions |
| 3 | `catalog` | `studio_settings` (+ default row), `class_types`, `sessions`, `session_private_details`, `session_availability` view | 3 | Drop view, then tables (no user data yet) |
| 4 | `bookings_credits` | `credit_grants`, `bookings`, `credit_ledger`, indexes | 3 | Destructive once data exists → forward-fix only |
| 5 | `rls_policies` | Grants, `enable row level security`, policies | 3 | Drop policies/revoke; never ship 4 without 5 |
| 6 | `rpc_booking` | `book_session`, `cancel_booking`, `booking_replay`, `usable_balance` | 3 | `drop function` (stateless) |
| 7 | `rpc_admin` | `create_session`, `admin_update_session`, `admin_update_settings`, `admin_upsert_class_type`, `grant_credits`, `admin_adjust_credits`, `mark_attendance`, `admin_cancel_session` | 3–4 | `drop function` |
| 8 | `credit_expiry_job` | `pg_cron` extension, `expire_credit_grants`, schedule | 4 | `cron.unschedule('expire-credit-grants')`, drop function |
| 9 | `waitlist` | `waitlist_entries`, `sessions.waiting_count`, waitlist RPCs, promotion hook in `cancel_booking` (`create or replace`) | 4 | Flag off first; then drop RPCs; table kept if it has data |

Rules:
- Supabase CLI has no down migrations. Each file ends with a commented `-- rollback:` block for local use; in production a mistake is fixed by a **new forward migration**. Destructive changes (drop column/table with data) need explicit owner authorization (INITIAL_PROMPT principle 10).
- Every function migration re-states `revoke`/`grant` explicitly (do not rely on defaults).
- `supabase/seed.sql` (runs only on `supabase db reset` locally / preview branches; **never** pushed to prod): fake users inserted into `auth.users` with `.test` emails (`staff@bylou.test`, `alumna1@example.test` …, names "Alumna Demo 1"), one staff promotion, 3 class types, sessions relative to `now()` (past, today, next 2 weeks, one full, one cancelled), grants (valid, expiring tomorrow, expired, exhausted). A header comment states it is fake data.

---

## 12. Phase 3 SQL test plan

Tooling: **pgTAP** via `supabase test db` (files in `supabase/tests/database/*.test.sql`, each wrapped in `begin; … rollback;`), impersonating users with `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` (and `set local role anon;`). **Concurrency** cannot be proven in one session: a small Vitest harness (`supabase/tests/concurrency/*.test.ts`) opens 2–N `pg` connections to the local DB, sets role/claims per connection, holds transactions open, and asserts blocking via `pg_stat_activity.wait_event_type = 'Lock'`. Time-dependent cases create sessions relative to `now()` instead of mocking the clock.

| ID | Journey | Case | Expected |
|---|---|---|---|
| A1 | A | Student with a valid grant books a published future session | `ok`, 1 `confirmed`, 1 `booking_debit`, grant −1, `spots_left` −1 |
| A2 | A | Booking window edges: before opens / within close minutes / after start / cancelled session / unpublished id | `booking_not_open` / `booking_closed` / `session_started` / `session_cancelled` / `not_found` |
| A3 | A | Earliest-expiring grant consumed; grant expiring before session start ignored | Correct `credit_grant_id`; `no_valid_credit` when only the short grant exists |
| B1 | B | Capacity 1: A books, then B books | B `session_full`; count 1 |
| B2 | B | **2 connections**: A holds `book_session` uncommitted on last spot; B calls | B waits on Lock; after A commits B gets `session_full`; confirmed = capacity |
| B3 | B | **20 parallel** calls, capacity 5, all with credit | exactly 5 `ok`, 15 `session_full`, 5 debits |
| B4 | B | As `postgres`: `update sessions set confirmed_count = capacity + 1` | CHECK violation |
| B5 | B | Cancel frees spot while another student books concurrently | Final count ≤ capacity and = count(confirmed) |
| C1 | C | Same key twice, sequential | Same `booking_id`, `replayed: true`, 1 debit, grant −1 once |
| C2 | C | Same key, **2 connections** concurrently | 1 booking, other replay |
| C3 | C | Different keys, same session | `already_booked`, 1 debit |
| C4 | C | Same key, different session | `22023`, no writes |
| C5 | C | Two sessions, 1 credit, **2 connections** | one `ok`, one `no_valid_credit`, remaining 0 |
| C6 | C | `cancel_booking` twice | Second `replayed`, exactly 1 `cancel_refund` |
| C7 | C | `grant_credits` twice with same key; `create_session` twice with same request key | One grant + one `grant` entry; same session ids |
| D1 | D | Cancel outside window | `cancelled`, `refunded`, grant +1, ledger refund, count −1, row kept |
| D2 | D | Policy `allow_without_refund`: cancel inside window without / with `p_accept_late` | `cancellation_too_late` (`confirm_required: true`) + no writes / `late_cancelled`, no refund, count −1 |
| D2b | D | Policy `deny` (Bylou seed): cancel inside window, with and without `p_accept_late` | `cancellation_too_late` (`confirm_required: false`), no writes, count unchanged |
| D3 | D | After start; attendance marked; student cancellation disabled | `cancellation_not_allowed` |
| D4 | D | Original grant expired before an in-window cancel | `cancelled`, `refunded: false`, no ledger row |
| D5 | D | `admin_cancel_session` with mixed valid/expired grants | All bookings cancelled; refunds for valid; `refunds_skipped` lists expired; count 0 |
| D6 | D (Ph. 4) | Cancel with waitlist [no-credit user, eligible user] | First `skipped(no_valid_credit)`, second promoted with debit; count unchanged net |
| D7 | D (Ph. 4) | Cancel inside window with waitlist | No promotion; spot bookable |
| D8 | D | Reconciliation after every scenario file | ∀ grant: `credits_remaining = Σ ledger.delta`; ∀ session: `confirmed_count = count(confirmed)` |
| D9 | D (Ph. 4) | **2 connections**: A cancels S1 (B waiting), B cancels S2 (A waiting) | Both commit; no `40P01` |
| D10 | D (Ph. 4) | Expiry job; then job again; concurrent with a booking holding the grant | One `expiry` entry per grant; locked grant skipped, expired next run |
| E1 | E | anon selects `bookings`, `profiles`, `credit_*`, `waitlist_entries`, `session_private_details` | permission denied |
| E2 | E | anon reads `session_availability` | Only published scheduled sessions; no user columns exist |
| E3 | E | Student A reads B's bookings / grants / ledger / profile | 0 rows |
| E4 | E | Student `insert/update/delete` on `bookings`, `sessions` (e.g. capacity), `credit_grants`, `credit_ledger` | permission denied |
| E5 | E | Student updates own `profiles.role` / `email`; updates own `display_name` | denied / denied / ok |
| E6 | E | Student calls `create_session`, `grant_credits`, `mark_attendance`, `admin_cancel_session` | `42501` |
| E7 | E | anon calls `book_session` | permission denied (no EXECUTE) |
| E8 | E | A cancels B's booking | `not_owner`, no change |
| E9 | E | Private details: no booking / confirmed / after cancel | 0 / 1 / 0 rows |
| E10 | E | Ledger `update`/`delete`/`truncate` as `postgres` | exception |
| E11 | E | Catalog lint: every `security definer` function in `public`/`private` has `proconfig` containing `search_path=""`; every `public` table has `relrowsecurity`; `has_function_privilege('anon', f, 'execute')` false for all except an allow-list (empty in MVP) | all pass |
| F1 | F | Staff `create_session` single and weekly ×4 at local 18:00 | `starts_at` = 21:00 UTC for ART; 4 rows sharing `series_id` |
| F2 | F | Staff reads roster: bookings + profiles for a session | All confirmed with names; student sees only own |
| F3 | F | `mark_attendance` attended/no_show; on cancelled booking; 8 days later | ok / `not_found` / `attendance_window_closed` |
| F4 | F | `admin_update_session` capacity below confirmed | `capacity_below_bookings` |
| F5 | F | `grant_credits` then student balance | Balance and `nextExpiry` match |

---

## 13. Open issues

Resolved and removed (numbers kept for references): #1 RPC-only codes → ARCHITECTURE §5 application/RPC codes; #2 cancellation rule → ADR-011 Accepted (Bylou 24 h + `deny`; the waitlist auto-promotion rule stays provisional, ROADMAP 4.4 🔒); #5 `p_accept_late` → ARCHITECTURE §3 `cancel({ …, acceptLate })`, only used with `allow_without_refund`.

| # | Issue | Proposed handling |
|---|---|---|
| 3 | Credit validity is checked against the **session start**, not the booking time. | Confirm with owner; the alternative is a one-line change in the grant filter. |
| 4 | Admin-cancelled session whose student's grant already expired: no refund possible. | MVP returns `refunds_skipped`; staff issues a 1-credit grant manually. Alternative: auto compensation grant (adds a setting). |
| 6 | No notifications (promotion, session cancel). | Phase 4+: DB webhook / Edge Function + SMTP; out of this doc. |
| 7 | Right to erasure (Ley 25.326) vs. `on delete restrict` history. | Define an anonymization RPC (null name/phone, replace email) before production. |
| 8 | Single tenant per Supabase project. | Multi-tenant later requires `studio_id` on every table and policy rewrite; documented, not built. |
| 9 | `signInWithOtp` auto-creates users; OTP endpoint abuse. | New users are harmless `student` rows; enable Supabase CAPTCHA / rate limits at provisioning (owner). |
| 10 | `confirmed_count` is denormalized. | Only RPCs write it under the session lock; CHECK + reconciliation test D8; staff can run a recount query. |
| 11 | `not_owner` confirms that a booking id exists. | IDs are random UUIDs; UI shows the `not_found` copy. Acceptable. |
| 12 | pg_cron must be enabled on the project. | Correctness does not depend on it (lazy expiry); confirm at provisioning. |

---

## 14. Sources

- Supabase docs via Context7 (`/supabase/supabase`): RLS guide (security-definer helpers in a private schema, `(select auth.uid())` initPlan, `to authenticated`, views and `security_invoker`), Database Functions (definer vs invoker, `set search_path = ''`, revoking EXECUTE from `public`/`anon`, default privileges), column-level privileges, managing user data (`auth.users` → `profiles` trigger), passwordless email OTP (`signInWithOtp`, `verifyOtp({ type: 'email' })`, `{{ .Token }}`), local testing with pgTAP / `supabase test db`, pg_cron.
- PostgreSQL 17 docs via Context7: Read Committed (UPDATE/`FOR UPDATE` wait and re-evaluate on the updated row version), SELECT locking clause caveats (ORDER BY with locking under READ COMMITTED; locking in a subquery).
