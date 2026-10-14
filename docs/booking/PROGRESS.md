# Booking Core — Progress Log

Source brief: `INITIAL_PROMPT_BYLOU_BOOKING.md` (repo root, untracked).
Branch: `feature/booking-core` (based on `origin/main` @ `b2d2535`).

## Current phase

**Phase 4.2 (class types, sessions, weekly series, capacity, cancel) — DONE.** Next: Phase 4.3 (students + credits). Phase 4.1 done. Phase 3 (local) done. Hosted Supabase (3.5) waits on the owner following `SUPABASE_SETUP.md`. Phase 0 done (`545e5a4`), Phase 1 done (`13c9c92`, `99e86fe`, `b23205d`), Phase 2.1 done (`157bcc7`).

| Workstream | Owner (logical agent) | Deliverable | Status |
|---|---|---|---|
| PRD / architecture / roadmap | product-lead + architect | `PRD.md`, `ARCHITECTURE.md`, `ROADMAP.md` | done (`99e86fe`) |
| Data model + RLS + RPC design | backend-security | `DATA_MODEL.md` | done (`b23205d`; SQL not executed yet — no Supabase project) |
| Domain + theme contract + tests | domain/frontend engineer | `booking/`, `brands/`, `vitest.config.mts` | done (`13c9c92`, 70 tests green, verified by orchestrator) |
| **Phase 2.1** read-only agenda (mock) | frontend engineer | `booking/application`, `booking/infrastructure/mock`, `booking/ui`, `app/reservas/` | done (`157bcc7`; 141 tests; orchestrator browser-checked static build: agenda, deep-link refresh of `/reservas/sesion/?id=`, invalid id, landing intact) |
| Docs reconciliation | writer | PRD/ARCHITECTURE/ROADMAP/DATA_MODEL/UX_DESIGN | done (`a203b8c`) |
| **Phase 3.1** local migrations + pgTAP + race tests | backend-security | `supabase/**`, `tests/db/` | done (`57424f5`; orchestrator re-ran: pgTAP 182/182, races 6/6, unit 141/141; no secrets) |
| Security review of migrations | qa / review-risk (read-only) | report | done: 0 blocker / 0 high / 1 medium / 2 low / 5 info |
| **Phase 3.2** adapter + OTP + book/cancel UI (local) | frontend engineer | `booking/**`, `app/reservas/**` | done (`a810ab7`; 256 tests; E2E vs local Supabase scripted: book, replay, full, refund, late-cancel denied) |
| **Phase 3.3** DB hardening (OTP email template w/ code, confirmations on, confirmed-only profile email, unpublished class types, hide `updated_by`) | backend-security | `supabase/**` | done (`6374543`; pgTAP 216/216) |
| Hosted Supabase setup guide (owner approved 2026-10-14) | devops writer | `SUPABASE_SETUP.md` | done (`f498e7a`) — **owner action pending** |
| Browser E2E vs local Supabase (orchestrator, 2026-10-14) | orchestrator | — | PASS: request code → Mailpit → sign in → book (9→8) → address revealed → cancel >24 h → refund (8→9), history updated |
| **Phase 4.1** admin shell, Hoy, roster, attendance (ADR-015) | frontend engineer | `app/admin/**`, `booking/admin/**`, `app/_booking/`, pgTAP `06` | done: unit 346/346, pgTAP 237/237, races 6/6; orchestrator browser E2E vs local Supabase: anon → sign-in link, staff → Hoy + roster, attendance `no_show` persisted, student → "Sin acceso" |

| **Phase 4.2** class types, sessions, weekly series, capacity, cancel (ADR-016) | frontend + backend engineer | `20261014000900_admin_sessions.sql`, `app/admin/{practicas,nueva-clase}`, `booking/admin/**` | done: unit 411/411, pgTAP 306/306, races 7/7, db lint clean; orchestrator browser E2E vs local Supabase: 4-week series created at 09:30 ART, capacity 2→6, cancel → `cancelled`, other occurrences untouched |

Phase 0 workstreams:

| Workstream | Owner (logical agent) | Deliverable | Status |
|---|---|---|---|
| Repository audit | repository-auditor | `REPOSITORY_AUDIT.md` | done |
| LuWeVa public analysis | competitive-researcher | `REFERENCE_ANALYSIS.md` | done (most LuWeVa internals "Not verified": behavior gated behind demo lead form) |
| UX / visual system | product-designer | `UX_DESIGN.md` | done |

## Done

- 2026-10-13: Read brief. Created `feature/booking-core` from `origin/main` (local `main` was 4 commits behind; rebased branch onto remote head before any work).

- 2026-10-13: Phase 0 closed. ADR-001..012 recorded in `DECISIONS.md`. Admin route chosen as `/admin/` (separate layout) over `/reservas/admin/`.

- 2026-10-13: Phase 1 code + docs committed. ADR-013 (explicit `NEXT_PUBLIC_BOOKING_DATA_SOURCE`, no silent mock, no landing link before release) and ADR-014 (DB enforces rules; brand config seeds) added.
- 2026-10-13: **Owner decision**: Bylou cancellation = free up to 24 h before; later cancellation blocked in-app, student contacts Lou (`lateCancelPolicy: "deny"`). ADR-011 accepted (`8f8b4f6`).
- 2026-10-13: `node_modules` reinstalled with pnpm 9 (`npx pnpm@9 install --frozen-lockfile`); the pnpm-11 copy was moved to the scratchpad. Use `npx pnpm@9 ...` for all commands on this branch.

## Pre-existing local changes (NOT part of booking work)

Carried over from a previous local setup session; intentionally left uncommitted and excluded from booking commits:

- `.gitignore` → adds `.atl/`
- `pnpm-lock.yaml` → pnpm 11 local re-resolution. **Restored to the committed version** so booking deps are added with pnpm 9 (CI-compatible).
- `pnpm-workspace.yaml` (untracked) → `allowBuilds: sharp: true`. **Moved out of the repo** temporarily.
- Backups of both: `<session scratchpad>/local-tooling-backup/`. Restore `pnpm-workspace.yaml` locally if you use pnpm 11; never commit it.

**Never commit `pnpm-workspace.yaml`**: CI pins pnpm 9 + Node 20 (`.github/workflows/main.yml:27,32`); pnpm 9 aborts on that file (`packages field missing or empty`), which would break the production deploy. Any dependency change on this branch must produce a lockfile compatible with CI pnpm 9.

## Baseline (verified by audit, 2026-10-13)

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm build` (CI-equivalent `NEXT_PUBLIC_BASE_PATH=""`) | PASS |
| `pnpm lint` | FAIL (pre-existing: eslint not installed, no config) |
| Tests | none before this branch; now `npx pnpm@9 test` (Vitest 4.1.11) |

## Pending reconciliation

- (in progress, docs agent) route naming `/reservas/sesion/`, `listSessions`, past/cancelled sessions listed, Bylou deny policy across docs.
- Add RPC-only codes from `DATA_MODEL.md` §13 (`capacity_below_bookings`, `attendance_window_closed`, `session_not_full`) to the result-code contract (application layer, not domain) + copy keys; reflect `p_accept_late` in ARCHITECTURE `cancel(cmd)`.

## UX backlog (observed in browser E2E)

- Sign-in: email typed right after page load is sometimes wiped (input remounts); dev console shows a `useId` hydration mismatch on the sign-in form. Fix before release.
- Admin new-session form: modality radios expose `in_person`/`online` as accessible names; use the visible labels.
- Flaky test: `booking/ui/sign-in/sign-in.test.tsx` "goes email → code → returnTo" focus assertion fails ~2/15 full runs (pre-existing).
- Agenda card for a past session the student attended says "Ya tenés esta clase reservada"; should read as attended/past.
- After booking from the agenda, the card behind the sheet still shows the old spots count until refresh.
- Modality filter + remembered filter (PRD ST-01 AC4) pending.
- New users have no display name yet (profile completion step).

## Pre-release checklist (from security review, not yet done)

- [ ] CAPTCHA (Turnstile) on sign-in: needs site key + frontend change.
- [ ] Throttle book/cancel churn (review LOW #3): RPC-level rate limit or per-user daily cap.
- [ ] Account erasure: anonymize procedure (FKs are `ON DELETE RESTRICT`).
- [ ] Admin UI must escape `display_name`; never put staff-only comments in credit notes (students can read their own notes).
- [ ] Never run `supabase/seed.sql` against a hosted project.
- [ ] `.env.example`: writing `.env*` files is blocked by the current permission settings. Owner to allow or create it (content: `NEXT_PUBLIC_BOOKING_DATA_SOURCE`, `NEXT_PUBLIC_BOOKING_BRAND`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BASE_PATH`, all empty, public values only).

## Blockers / decisions needing human input

Not blocking current work (Phase 2 runs on mock data). Needed before Phase 3:

1. ~~Cancellation rules~~ → decided (24 h, then blocked).
2. Credit validity measured at session start (not booking time)?
3. ~~Approve hosted Supabase~~ → approved to receive setup steps (owner creates project; `SUPABASE_SETUP.md`).
4. Mercado Pago in V2? (not MVP)
5. Align pnpm between local (11) and CI (9) via `packageManager` — touches deploy pipeline.

## Next step

1. **Owner:** follow `docs/booking/SUPABASE_SETUP.md`; send back only the project ref + checklist (never keys).
2. ~~Phase 4.1~~, ~~4.2~~ done. **Phase 4.3** students + credits: search, grant pack (UI over `grant_credits`), `admin_adjust_credits` with reason, ledger view, book/cancel on behalf (AD-08…AD-10).
3. **Phase 4.2** waitlist (FIFO, Bylou deny policy) + credit-expiry job (pg_cron) — needs owner answer on auto-promotion.
4. Fix UX backlog items above.

## Local database (Phase 3.1+)

Requires Docker + Supabase CLI (`brew install supabase/tap/supabase`). Local only — never `supabase link`/`db push` without owner approval.

```
npx pnpm@9 run db:start        # start local stack (studio/storage/realtime disabled)
supabase db reset              # re-apply migrations + fake seed
supabase test db               # pgTAP (182 assertions)
npx pnpm@9 run test:db         # multi-connection race tests
npx pnpm@9 run db:stop
```

## Local preview

```
NEXT_PUBLIC_BOOKING_DATA_SOURCE=mock npx pnpm@9 run dev            # http://localhost:3000/reservas/
NEXT_PUBLIC_BOOKING_DATA_SOURCE=mock NEXT_PUBLIC_BOOKING_BRAND=demo-studio npx pnpm@9 run dev
npx pnpm@9 test                                                    # unit + component tests
```

## How to resume

```
Read docs/booking/PROGRESS.md and INITIAL_PROMPT_BYLOU_BOOKING.md, then continue from "Next step" on branch feature/booking-core (start Phase 4.1 admin UI unless the owner has finished SUPABASE_SETUP.md, in which case first link + push migrations with explicit approval).
Use `npx pnpm@9` for every package command (CI uses pnpm 9).
```
