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
**Accepted (cancellation) — owner decision 2026-10-13 for Bylou:** free cancellation up to **24 h** before start; after that the app **blocks** cancellation (`lateCancelPolicy: "deny"`) and the student must contact Lou.
**Accepted (waitlist) — owner decision 2026-10-14 for Bylou:** FIFO; when a spot opens the first waiting student is promoted only if she holds a valid pack (usable at the session start, same selection as a normal booking) **and** the session starts more than `cancellationWindowHours` (Bylou 24 h) from now; otherwise she is skipped and the next one is tried; if nobody qualifies the spot stays open for normal booking. Implementation: ADR-021. Other rows remain provisional platform defaults.

| Rule | Default | Config key |
|---|---|---|
| Timezone | `America/Argentina/Buenos_Aires` | `rules.timezone` |
| Booking opens / closes | opens 30 days before, closes 0 min before start | `rules.bookingWindow` |
| Free cancellation | up to **24 h** before start → credit refunded | `rules.cancellationWindowHours` |
| Late cancellation | platform default `allow_without_refund`; **Bylou: `deny`** (contact the studio) | `rules.lateCancelPolicy` |
| One booking per student per session | always (an invariant, not config) | — |
| Credit consumption | 1 credit per booking, earliest-expiring grant first | `rules.creditsPerBooking` |
| Waitlist (Phase 4.4, **accepted** 2026-10-14) | FIFO; auto-promote only if the student has a valid pack and the session starts more than the cancellation window from now; otherwise skip to the next student (ADR-021). Bylou: on | `features.waitlist` + `studio_settings.waitlist_enabled` |
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

## ADR-021 — Waitlist implementation (Phase 4.4)
**Accepted (owner rule 2026-10-14, ADR-011).** Migration `20261014001300_waitlist.sql`.
- **Table** `waitlist_entries` (session, student, `status` waiting | promoted | skipped | left | closed, `skip_reason` no_valid_credit | already_booked | profile_incomplete | too_many_changes | promotion_failed, `close_reason` session_cancelled | account_erased | booked, `promoted_booking_id`, `request_key`, `created_at = clock_timestamp()`, `resolved_at`). One waiting entry per student per session (partial unique index); CHECKs tie each status to its reason/booking. RLS: a student reads her own rows, staff read all; no write privilege for anyone (RPCs only).
- **Switch:** `studio_settings.waitlist_enabled` is the server-side flag (Bylou: on); off → `join_waitlist` / `leave_waitlist` answer `waitlist_disabled`, `my_waitlist_entries` returns nothing, nothing is promoted. The brand flag `features.waitlist` hides every waitlist UI (and stops the waitlist reads).
- **Student RPCs:** `join_waitlist(p_session_id, p_request_key)` (idempotent per key; an existing waiting entry is returned; refusals `profile_incomplete`, `waitlist_disabled`, `not_found`, `session_cancelled`, `session_started`, `booking_not_open`, `booking_closed`, `waitlist_closed` (inside the window: nobody could be promoted), `already_booked`, `session_not_full`, `waitlist_full` (50 waiting per session), `too_many_waitlists` (10 open entries per student), `too_many_changes` (`limit: cancellations` — the ADR-019 self-cancellation limit also applies to joins — or `limit: waitlist_joins`, the per-session limit; a join is never counted as a booking)); `leave_waitlist(p_session_id)` (state-idempotent: answers the latest status, so a student promoted meanwhile learns it; without any entry of hers it answers `not_found` before taking a lock); `my_waitlist_entries()` (definer read: her entries + session + her place, never other students' rows).
- **Staff read:** plain RLS select of `waitlist_entries` with `profiles!waitlist_entries_user_id_fkey` (ADR-015); the roster shows the waiting count and the queue in promotion order, then what happened to the others.
- **Promotion** runs inside the transaction that frees the spot: `cancel_booking`, `admin_cancel_for`, `admin_update_session` (capacity increase). `private.lock_for_promotion` locks every waiting entry of the session (LOCK 3), then in ONE grant statement ordered by id the refund grant plus every usable grant of every waiting student (LOCK 4); `private.promote_waitlist_locked` then walks the queue (created_at, id), skipping with a reason: already booked (`already_booked`); no visible display name (`profile_incomplete`); at/over the ADR-019 self-cancellation limit (`too_many_changes`); no grant from the locked set valid at the session start (`no_valid_credit`). A skipped student leaves the list and may join again at the end. Otherwise: a `waitlist` booking (**random** idempotency key, `created_by` = the student), one `booking_debit` (actor null = system) with book_session's grant choice, `confirmed_count + 1`, entry `promoted`. Each promotion is written in its own subtransaction (`begin … exception when others`): if it fails for any reason, only that entry is skipped (`promotion_failed`) and the cancellation / capacity change that freed the spot still commits. It stops when the session is full or nobody is left. Inside the window, once booking has closed (`booking_closes_minutes`), with the flag off or on a cancelled session nothing happens and entries stay `waiting`; the freed spot is bookable first-come.
- **Security review fix (HIGH-1):** promotion keys used to be the entry id, which `join_waitlist` returns; a student could pre-use it as her own `book_session` key on another class, so her promotion hit `bookings_idempotency` (23505) and aborted every cancellation of that session. Keys are now random (one entry → one booking stays guaranteed by `status = 'waiting'` + `waitlist_one_promotion`) and the subtransaction contains any other per-entry failure (pgTAP W12 reproduces both).
- **Not enforced at promotion:** `student_cancellation_enabled`. A promoted student is placed exactly like a booking she made herself; if the studio switched self-cancellation off she cannot cancel it either (same as any booking). Left as is by decision of the review.
- **Closing entries:** `admin_cancel_session` closes waiting entries (`session_cancelled`, between the booking and grant locks); `admin_anonymize_student` locks her waiting entries **before** its "no upcoming bookings" check and closes them (`account_erased`), so a concurrent promotion either commits first (the check sees it) or finds the entry closed; `book_session` / `admin_book_for` close the booker's own waiting entry (`booked`).
- **Throttle:** the per-session booking count of ADR-019 ignores `waitlist` bookings (she did not make them).
- **Race-tested** (`tests/db/waitlist.test.ts`, ×20 each): cancel vs a newcomer's booking (the waiting student always gets the spot), two cancellations with one waiting student (promoted once, other spot open), cancel + capacity increase (each waiting student once, never over capacity), D9 cross-session cancels (no deadlock), erasure vs promotion (never an erased student with an upcoming booking).
- **No notifications** (none exist in the MVP): a promoted or skipped student sees it the next time she opens the app — Mis reservas shows the booking with "¡Se liberó un lugar! Tu clase quedó reservada." or the skipped entry with its reason.
- **Mock adapter** mirrors all of it (`booking/infrastructure/mock/mock-waitlist.ts`); a second demo student (`nueva@…`, a pack, no name yet) makes the journey playable in one browser tab.
- Not chosen: keeping a student without a pack `waiting` (she would block nobody but the list would silently hold dead entries; skipping is explicit and visible to her); skipping everyone inside the window (the rule is session-wide, so it would just empty the list); a separate promote RPC for staff (capacity increase already promotes); a `waiting_count` counter column (the roster counts rows).

## ADR-022 — Display name required before booking
**Accepted (owner decision 2026-10-14).** A student needs a display name (the sign-in email already identifies her; no phone is collected, PRD ST-03 AC2 amended).
- Server: `book_session` and `join_waitlist` answer `profile_incomplete` while `profiles.display_name` is null or invisible, and promotion skips such a student (migration `20261014001300`, right after the level-0 profile lock). "Invisible" = only whitespace, control, zero-width (U+200B–200D, U+2060), BOM, NBSP / Unicode spaces or Hangul filler characters: `private.has_display_name`, plus the CHECK `profiles_display_name_visible` so such names cannot be stored any more (null stays allowed: new sign-ups, anonymized rows). The app uses the same character set (`BLANK_NAME` / `hasVisibleName` in `booking/application/profile.ts`). Staff `admin_book_for` is unaffected. Test fixtures and race users always get a name.
- UI: the "¿Cómo te llamamos?" step has no "Ahora no"; it appears after sign-in whenever the name is missing (also for an already signed-in visitor arriving at the sign-in page), and inside the confirm sheet / waitlist action for a signed-in student who still has none (also when the server answers `profile_incomplete`). The name keeps the existing validation (1–80 characters, no control/bidi characters) and the existing column grant + RLS (`profiles_update_own`).

## ADR-023 — Add to calendar (ST-11)
**Accepted (owner approved 2026-11-06).** No backend: the event is built on the device.
- **Where:** pure builders in `booking/application/calendar.ts` (`bookingCalendarEvent`, `buildIcs`, `googleCalendarUrl`, `icsFileName`; no React/Next, no browser APIs); `booking/ui/calendar-actions.tsx` only composes them and hands the file to the browser (Blob + temporary `<a download>`).
- **Shown** only for her own confirmed, not finished booking: the confirm sheet's success state and each upcoming card in Mis reservas. Two adjacent actions in a group named `success.calendar`: a button "Descargar evento (.ics)" and a link to Google Calendar's template (`target=_blank`, `rel="noopener noreferrer"`, "se abre en otra pestaña" for screen readers).
- **`.ics`:** RFC 5545, `VCALENDAR` (`VERSION:2.0`, `PRODID:-//<domain>//Booking//ES`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`) with one `VEVENT`; CRLF, folding at 75 UTF-8 octets without splitting a character, TEXT escaping (`\\ ; , newline`) and control characters dropped; `DTSTAMP`/`DTSTART`/`DTEND` in UTC (`YYYYMMDDTHHMMSSZ`); `SUMMARY` = class type + brand name; `LOCATION` only for in person (address when shared, else the modality label); `DESCRIPTION` = modality, instructor, meeting line, instructions. File name `<class slug>-<studio-local date>.ics` (ASCII slug).
- **UID** `session-<session id>@<brand domain>`: stable per session and brand (one active booking per student per session), so importing it again, or from the other screen, updates the event instead of duplicating it. New required `BrandConfig.domain` (Bylou `bylou.com.ar` from `public/CNAME`; demo `estudio-demo.example`), validated as a bare lowercase DNS name.
- **Meeting link rule (ST-10/ST-11):** the meeting URL, address and instructions come only from `SessionPrivateDetails`, which the backend (RLS) returns only to holders of a confirmed booking. Mis reservas already has them for upcoming bookings; the confirmation reads them once the booking succeeded (`getSessionPrivateDetails`, failure ignored). The builder drops them whenever `booked` is false and accepts only an https link without whitespace (also emitted as `URL:`).
- **Known limitation:** cancelling a booking (or a studio cancellation) does not remove the event she already saved; the file is a one-off export, not a subscribed feed.
- Not chosen: a menu/popover (two actions fit on a phone and need no extra focus handling); a `data:` URI link (Safari iOS handles a Blob download better); a calendar feed or `METHOD:CANCEL` export (needs a backend or another click from her).
