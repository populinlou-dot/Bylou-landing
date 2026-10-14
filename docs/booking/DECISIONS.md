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
**Proposed — provisional defaults until the owner confirms.**

| Rule | Default | Config key |
|---|---|---|
| Timezone | `America/Argentina/Buenos_Aires` | `rules.timezone` |
| Booking opens / closes | opens 30 days before, closes 0 min before start | `rules.bookingWindow` |
| Free cancellation | up to **24 h** before start → credit refunded | `rules.cancellationWindowHours` |
| Late cancellation | allowed; credit **not** refunded | `rules.lateCancelPolicy` |
| One booking per student per session | always (an invariant, not config) | — |
| Credit consumption | 1 credit per booking, earliest-expiring grant first | `rules.creditsPerBooking` |
| Waitlist (Phase 4) | FIFO; auto-promote only if the student has a valid credit and promotion happens before the cancellation window; otherwise skip to the next student | `features.waitlist` |
| Modalities | in-person / online / both; 1:1 = capacity 1 (same model) | per session |

## ADR-012 — Pre-existing issues are out of scope
**Accepted.** Lint is broken, there is a possible Geist font variable mismatch, a missing `apple-icon.png`, and landing contrast issues. All are documented in the audit and UX docs, and **not fixed** on this branch unless the owner asks, to keep booking diffs isolated.
