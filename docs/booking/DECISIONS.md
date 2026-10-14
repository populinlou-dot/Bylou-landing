# Booking Core — Decisions (ADRs)

Short ADRs. Status: **Accepted** (orchestrator, reversible locally), **Proposed** (needs owner input), **Superseded**.
Evidence: `REPOSITORY_AUDIT.md`, `REFERENCE_ANALYSIS.md`, `UX_DESIGN.md`.

---

## ADR-001 — Same repo, static export, deploy untouched
**Accepted.** Booking ships inside this Next.js 16 app with `output: "export"` on GitHub Pages (`www.bylou.com.ar`). No SSR, route handlers, server actions, middleware, or runtime dynamic segments.
- The existing workflow (`.github/workflows/main.yml`) is not modified by booking work.
- Trade-off: no server-side rendering of user data. That is acceptable because every user view is client-rendered behind auth.

## ADR-002 — Supabase as backend authority
**Accepted (design). Provisioning: Proposed — needs owner approval.**
Postgres + Supabase Auth + RLS + `SECURITY DEFINER` RPCs, called from the static frontend with the public anon key only.

| Alternative | Why not (for now) |
|---|---|
| Firebase | Weak multi-row transactional guarantees for capacity + credits; no SQL constraints. |
| Own API (Vercel/Fly/Workers) | Extra hosting, deploy pipeline and cost; duplicates what RLS + RPC give. |
| Google Sheets / forms | No integrity, no auth. |

Free tier is enough for MVP. Creating the project is an external action → owner decision.

## ADR-003 — Routes
**Accepted.** `/reservas/` (public + student) and `/admin/` (staff), separate layouts. Auth callback/OTP page under `/reservas/ingresar/`.
- Entity IDs travel as query params (`/reservas/sesion/?id=…`), never as dynamic segments.
- `/admin/` is a public static shell; protection is enforced by RLS/RPC, not by hiding the route. `noindex` on both.

## ADR-004 — Auth: email OTP code
**Accepted.** Supabase email OTP (6-digit code) entered on the same page. Avoids PKCE magic links failing when opened on another device/browser. No OAuth in MVP.

## ADR-005 — Database is the only authority for writes
**Accepted.**
- Students have **no direct INSERT/UPDATE/DELETE** on business tables. All mutations go through RPCs: `book_session`, `cancel_booking`, and admin RPCs.
- RPCs lock rows (`FOR UPDATE`), check capacity, credits and windows, and are idempotent via `(user_id, idempotency_key)` unique keys.
- Roles live in `profiles.role` (never in `user_metadata`, which users can edit). They are checked through a `SECURITY DEFINER` `is_staff()` helper. Users cannot update their own role.
- RLS is enabled on **every** table. The meeting URL/address is readable only by staff and by users holding an active booking.
- Client-side availability is preview only.

## ADR-006 — No payments in MVP; credits are admin-granted
**Accepted (MVP). Mercado Pago: Proposed for V2 — owner decision.**
The admin grants a pack (N credits, expiry) after an off-platform payment. An append-only ledger audits every grant, debit, refund and expiry. The UI never implies an online payment occurred.

## ADR-007 — Module boundaries
**Accepted.** Top-level folders, outside `app/` (only route entry files live in `app/`):

```
booking/
  domain/          pure TS: types, invariants, policies. Imports NOTHING from react/next/supabase/brands.
  application/     use cases orchestrating ports (BookingRepository, AuthPort, Clock).
  infrastructure/  supabase adapters, mock/seed adapter.
  ui/              presentational + container components (student).
  admin/           admin UI.
  theme/           BookingTheme / BrandConfig contract + CSS-var applier.
  config/          validated studio rules, terminology, feature flags.
brands/
  bylou/           theme + copy + rules using the REAL landing tokens.
  demo-studio/     fictional sober theme (white-label proof).
```

The `domain` purity rule is enforced by an automated test that scans imports (ESLint is currently broken in the repo).

## ADR-008 — Theme scoping
**Accepted.** Brand tokens are applied as CSS variables on a `[data-booking-theme]` wrapper in the `/reservas` and `/admin` layouts, mapped onto the shadcn variable names Tailwind already uses. `app/page.tsx` and `app/globals.css` landing styles are not touched.

## ADR-009 — Testing
**Accepted.**
- Vitest for `booking/domain` and `booking/application` (Phase 1+).
- DB invariants (RLS, concurrency, idempotency) via SQL tests against Supabase local (Docker) in Phase 3.
- Playwright against the static `out/` build in Phase 5.

## ADR-010 — Package manager compatibility
**Accepted.**
- Any lockfile committed on this branch must be generated with **pnpm 9**, matching CI.
- `pnpm-workspace.yaml` is never committed.
- Aligning local vs CI pnpm (adding a `packageManager` field / bumping CI) changes the deploy pipeline → **Proposed**, owner decision.

## ADR-011 — Default business rules (configurable per studio)
**Accepted (cancellation) — owner decision 2026-10-13 for Bylou:** free cancellation up to **24 h** before start; after that the app **blocks** cancellation (`lateCancelPolicy: "deny"`) and the student must contact Lou. Other rows remain provisional platform defaults.

| Rule | Default | Config key |
|---|---|---|
| Timezone | `America/Argentina/Buenos_Aires` | `rules.timezone` |
| Booking opens / closes | opens 30 days before, closes 0 min before start | `rules.bookingWindow` |
| Free cancellation | up to **24 h** before start → credit refunded | `rules.cancellationWindowHours` |
| Late cancellation | platform default `allow_without_refund`; **Bylou: `deny`** (contact the studio) | `rules.lateCancelPolicy` |
| One booking per student per session | always (an invariant, not config) | — |
| Credit consumption | 1 credit per booking, earliest-expiring grant first | `rules.creditsPerBooking` |
| Waitlist (Phase 4) | FIFO; auto-promote only if the student has a valid credit and promotion happens before the cancellation window; otherwise skip to the next student | `features.waitlist` |
| Modalities | in-person / online / both; 1:1 = capacity 1 (same model) | per session |

## ADR-012 — Pre-existing issues are out of scope
**Accepted.** Lint is broken, there is a possible Geist font variable mismatch, a missing `apple-icon.png`, and landing contrast issues. All are documented in the audit and UX docs, and **not fixed** on this branch unless the owner asks, to keep booking diffs isolated.

## ADR-013 — Explicit data source; no silent mock in production
**Accepted.** Supersedes the "env presence decides the adapter" idea in `ARCHITECTURE.md`.
- `NEXT_PUBLIC_BOOKING_DATA_SOURCE` must be `mock` or `supabase`. If it is missing or invalid, the booking pages render a configuration-error state. They never fall back to mock data.
- `mock` always shows a visible "Datos de demostración" banner.
- Until Phase 5 release approval, the landing gets **no link** to `/reservas`. Merges to `main` would therefore only add unlinked, `noindex` routes.

## ADR-014 — Studio rules: DB enforces, brand config seeds
**Accepted.**
- `studio_settings` in Postgres is the enforcement source for RPCs.
- `brands/*` rules are defaults for the seed data and the mock adapter, so the UI preview and the DB stay aligned by construction.
- Late cancellation follows `lateCancelPolicy`. Bylou: `deny` (see ADR-011), so the `cancel.closed` copy (contact Lou) applies; `cancel.late` is only needed for studios using `allow_without_refund`. The confirmation-email copy stays hidden until emails exist (V2).

## ADR-015 — Admin reads via staff RLS; admin writes via RPC
**Accepted (Phase 4.1).**
- Admin read views (day sessions, roster) use plain table queries with explicit columns. The existing policies (`profiles_select`, `bookings_select`, `sessions_select_auth`) already let staff read every row while a student reads only her own. No `SECURITY DEFINER` read RPC was added.
- Admin writes stay RPC-only (`mark_attendance`, `create_session`, `admin_cancel_session`, `grant_credits`), each starting with `private.assert_staff()`.
- `supabase/tests/database/06_admin_ui_reads.test.sql` pins this contract, including the named FK `bookings_user_id_fkey` that the roster query depends on.
- Routes: `/admin/?dia=YYYY-MM-DD` (day view) and `/admin/clase/?id=` (roster), per the `UX_DESIGN.md` route map. `returnTo` accepts `/admin/…`. `/reservas` and `/admin` share one composition root in `app/_booking/composition.ts`.
- The mock adapter signs in any `staff@…` email as the demo staff user.

## ADR-016 — Admin session management (Phase 4.2)
**Accepted.**
- New RPCs (`20261014000900_admin_sessions.sql`): `admin_upsert_class_type` and `admin_update_session` (capacity only, row locked `FOR UPDATE`, refuses `capacity_below_bookings`, `session_cancelled`, `session_started`). `admin_cancel_session` was re-created only to fix the unused-variable lint warning.
- `create_session` is reused unchanged for single and weekly series (1–12 weeks, studio wall time, one transaction, replays on the request key).
- Archiving a class type is `is_published = false`; there is no separate archived state. Class type ids are generated by the client so a retry updates instead of duplicating.
- Location rules (in-person needs an address, online needs an https link) are enforced by the application and UI only, because staff are the only writers and tightening `create_session` would break the seed and pgTAP 04.
- The admin UI sends no cancellation reason: ledger notes are readable by students. Students are not notified automatically (no email in MVP).
- Capacity edits are refused from the session start onward.

## ADR-017 — Students + credits (Phase 4.3)
**Accepted.**
- New migration `20261014001000_admin_students_credits.sql`. Staff-only RPCs (all `SECURITY DEFINER`, `search_path = ''`, `private.assert_staff()` first, EXECUTE to `authenticated` only): `admin_search_students(p_query, p_limit)`, `admin_student_summary(p_user_id)`, `admin_adjust_credits(p_grant_id, p_delta, p_reason, p_request_key)`, `admin_book_for(p_user_id, p_session_id, p_request_key)`, `admin_cancel_for(p_booking_id, p_refund default true)`.
- **Balance is server-computed** (exception to ADR-015's "plain reads"): the list and the detail show `private.usable_balance` through the two read RPCs, so the panel can never disagree with what `book_session` accepts. Packs, bookings and the ledger stay plain RLS reads.
- **Adjustments are per pack**: `0 ≤ remaining + delta ≤ credits_total − credits held by the pack's confirmed bookings` (`insufficient_balance` / `adjust_exceeds_pack`), read under the grant lock, so a later refund (`cancel_booking`, `admin_cancel_for`, `admin_cancel_session`) always fits the `grants_remaining_bounds` CHECK; expired packs → `grant_expired`. No pack, therefore no usable balance, can go negative. More classes than the pack size = grant a new pack. The reason is required and stored as the ledger note (students can read it; the UI warns).
- Adjustment idempotency: new column `credit_ledger.request_key` (only on `admin_adjust`, unique per staff member + key). The ledger stays append-only (trigger + no write grants).
- **Book on behalf** bypasses the booking window only: refused once the session started, never over capacity (session row lock, race-tested against `book_session`), needs a valid pack (`no_valid_credit`), `source = 'staff'`, actor in `bookings.created_by` and the debit's `actor_id`. Unpublished sessions are allowed for staff.
- **Cancel on behalf** ignores the cancellation window, refunds by default into the original pack while it is still valid (`refund_skipped` otherwise), records `cancelled_by`; refused once attendance is marked (`cancellation_not_allowed`). State-idempotent like `cancel_booking`.
- Grant UI picks a last valid day in studio time and sends `grant_credits` its `p_valid_days` = days until that day + 1. Copy states nothing is charged in the app (ADR-006).
- Routes: `/admin/alumnas/?q=` (search) and `/admin/alumna/?id=` (detail).
- `admin_cancel_session` is redefined in the same migration only to store the staff reason alone (or null) as the refund ledger note; the old English prefix ("session cancelled: …") was visible to students. The UI labels the entry from its kind.

## ADR-018 — Credit expiry job
**Accepted.** `private.expire_credit_grants()` (migration `20261014001100`) zeroes unused credits on expired packs and writes one `expiry` ledger row per pack, so the ledger sum matches the usable balance. pg_cron runs it hourly (minute 7); the migration skips scheduling if pg_cron is missing, and `SUPABASE_SETUP.md` §4 has the owner check for hosted.
- Cut-off is `least(p_now, now()) - 5 min`, so it never expires a valid pack and an in-flight refund cannot land after the expiry row.
- Expiry rows have a null note and a null actor (system); the UI labels them by kind. Confirmed bookings on an expired pack stay confirmed; later cancels return no refund.
- Between expiry and the next run the ledger still counts the unused credits; balances never do.

## ADR-019 — Book/cancel churn throttle
**Accepted (pre-release, security review LOW #3).** Free cancellation more than 24 h ahead let a student book and cancel over and over, churning spots and spamming the roster.
- `book_session` (migration `20261014001200`) refuses a **new** booking with `too_many_changes` when, in the rolling last 24 h, the caller has cancelled `max_self_cancellations_24h` bookings herself (default **6**) or has made `max_session_bookings_24h` bookings of the same session (default **3**). Both live in `studio_settings`; null switches that limit off.
- Why these numbers: a real student rarely cancels more than a couple of classes a day, and rebooking the same class a third time is already unusual; the limits stop scripted churn without touching normal use. They are per studio and can be changed with one `update`.
- Counts existing rows (`bookings.cancelled_at/cancelled_by`, `created_at/created_by`), never idempotency keys, so a fresh key cannot reset it; two partial/compound indexes keep both counts to an index range scan. No counter table to keep in sync.
- Replays (same key) return the original result before any check. Cancelling is never throttled (it frees a spot). Staff paths (`admin_book_for`, `admin_cancel_for`, `admin_cancel_session`) are not throttled, and cancellations by staff do not count against the student.
- The check runs after `session_full` and before the credit lock, so the lock order is unchanged below the new level-0 profile lock (ADR-020).
- UI: the confirm sheet shows `sheet.tooManyChanges` with the contact link (Bylou: "escribile a Lou"), no retry. The mock adapter mirrors the rule with the same defaults.
- Not chosen: a counter table (one more write per booking, drift risk), rate limiting at the API gateway (not available on the static stack), blocking cancellations (would keep spots taken).

## ADR-020 — Account erasure by anonymization
**Accepted (pre-release, Ley 25.326; DATA_MODEL open issue 7).** History must survive (FKs `ON DELETE RESTRICT`, balances, rosters), personal data must not.
- Staff-only `admin_anonymize_student(p_user_id, p_confirm_email)` (`SECURITY DEFINER`, `search_path = ''`, `assert_staff()` first, EXECUTE to `authenticated` only). Typo guard (`email_mismatch`): the typed text must equal her current email (trimmed, case-insensitive); a student without a confirmed email (unconfirmed sign-up, migration 8) is confirmed with her exact display name or her user id instead, and the sheet says which. Refused while she has a confirmed booking whose session has not ended (`has_upcoming_bookings`): staff cancel first, choosing about refunds. Idempotent (`replayed: true`).
- Erases `profiles.display_name/phone/email`, `credit_grants.note`, `credit_ledger.note` (+ `note_erased_at`); stamps `profiles.anonymized_at` and `profiles.anonymized_by` (the staff member; audit, readable under the existing profiles RLS; CHECKs: no personal data once set, and both columns set together). Keeps every booking, pack and ledger row, so balances and counters do not move.
- The ledger stays append-only: the only allowed UPDATE is `note → null` with `note_erased_at`, and only under a transaction-local flag that the RPC sets (row + statement triggers).
- After erasure she cannot book (`book_session` → 42501), staff cannot book for her, grant her a pack or adjust her packs (`admin_book_for` / `grant_credits` / `admin_adjust_credits` → `not_found`, so no note with personal data can be written afterwards), she leaves the search list, her profile cannot be edited, and an email change in `auth.users` is no longer copied to her profile.
- Race safety: `book_session`, `admin_book_for`, `grant_credits` and `admin_adjust_credits` take her profile `FOR SHARE` first (lock order profile → … → grants); the erasure takes it `FOR NO KEY UPDATE`. A booking, pack or adjustment and an erasure therefore serialize (race-tested: never an anonymized student with an upcoming booking, never a pack note that escaped the sweep), and the FK checks of other RPCs (`FOR KEY SHARE`) never wait on it. DATA_MODEL §5.1 gains level 0.
- `auth.users` cannot be deleted while history exists (`profiles.id` cascades from `auth.users` and hits the RESTRICT FKs; verified locally). Owner step: ban the user (`SUPABASE_SETUP.md` §10, verified: GoTrue answers `user_banned`). The auth record still holds the email: removing it needs either the Supabase Admin API (secret key, outside the app) or a schema change so the auth user can go while the profile stays. **Owner decision pending.**
- UI: "Borrar datos de la alumna" in the student detail (danger section) → sheet with the typed email (or name / id) and a note that the owner must still ban the auth user; the anonymized student is shown read-only as "Alumna sin datos personales".
