-- Booking core · migration 4/7 · bookings_credits
-- DATA_MODEL §2.5–2.7, §3 (I3–I8, I10), §8, §11 #4.
-- Never ship this migration without migration 5 (privileges + RLS).

create table public.credit_grants (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete restrict,
  credits_total     int  not null check (credits_total between 1 and 100),
  credits_remaining int  not null,
  valid_from        timestamptz not null default now(),
  expires_at        timestamptz not null,                    -- exclusive: invalid AT expires_at
  note              text check (char_length(note) <= 200),   -- e.g. "Pack 4 · transferencia"
  granted_by        uuid not null references public.profiles(id),
  idempotency_key   uuid not null,
  created_at        timestamptz not null default now(),
  constraint grants_remaining_bounds check (credits_remaining between 0 and credits_total),   -- I5
  constraint grants_validity         check (expires_at > valid_from),
  constraint grants_idempotency      unique (granted_by, idempotency_key)
);
create index grants_user_usable_idx on public.credit_grants (user_id, expires_at) where credits_remaining > 0;

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
  cancel_request_key   uuid,                       -- audit only; cancel replay is state-based
  attendance_marked_at timestamptz,
  attendance_marked_by uuid references public.profiles(id),
  constraint bookings_cancel_consistent    check ((status = 'confirmed') = (cancelled_at is null)),
  constraint bookings_refund_only_cancel   check (not refunded or status = 'cancelled'),
  constraint bookings_attendance_confirmed check (attendance = 'unknown' or status = 'confirmed'),
  constraint bookings_credit_consistent    check ((credit_grant_id is null) = (credits_debited = 0)),
  constraint bookings_idempotency          unique (user_id, idempotency_key)                   -- I4
);
-- I3 (ADR-011): one active booking per student per session.
create unique index bookings_one_active   on public.bookings (session_id, user_id) where status = 'confirmed';
create index bookings_user_idx            on public.bookings (user_id, created_at desc);
create index bookings_session_idx         on public.bookings (session_id) where status = 'confirmed';
create index bookings_credit_grant_idx    on public.bookings (credit_grant_id);

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
-- I7 and "never twice" backstops for journeys C/D.
create unique index ledger_one_debit_per_booking  on public.credit_ledger (booking_id) where reason = 'booking_debit';
create unique index ledger_one_refund_per_booking on public.credit_ledger (booking_id) where reason = 'cancel_refund';
create unique index ledger_one_grant_entry        on public.credit_ledger (grant_id)   where reason = 'grant';
create unique index ledger_one_expiry_per_grant   on public.credit_ledger (grant_id)   where reason = 'expiry';
create index ledger_user_idx  on public.credit_ledger (user_id, created_at desc);
create index ledger_grant_idx on public.credit_ledger (grant_id);

-- I8: append-only, enforced even for the table owner (only a deliberate trigger drop bypasses it).
create trigger credit_ledger_append_only before update or delete or truncate on public.credit_ledger
  for each statement execute function private.forbid_mutation();

-- rollback: destructive once data exists → forward-fix only. Local only:
--   drop table public.credit_ledger; drop table public.bookings; drop table public.credit_grants;
