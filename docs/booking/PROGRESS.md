# Booking Core — Progress Log

Source brief: `INITIAL_PROMPT_BYLOU_BOOKING.md` (repo root, untracked).
Branch: `feature/booking-core` (based on `origin/main` @ `b2d2535`).

## Current phase

**Phase 4.4 waitlist (ADR-021) + required display name (ADR-022) — DONE locally (uncommitted until orchestrator verification).** Pre-release hardening (ADR-019, ADR-020, a11y pass), Phase 5.1 and 5.2 done. Next: rest of Phase 5.3 release checklist (CAPTCHA, owner items). Phase 4.3 (students + credits + sign-in fix) done; credit-expiry job (D10) done locally. Phases 4.1 and 4.2 done. Phase 3 (local) done. Hosted Supabase (3.5) waits on the owner following `SUPABASE_SETUP.md`. Phase 0 done (`545e5a4`), Phase 1 done (`13c9c92`, `99e86fe`, `b23205d`), Phase 2.1 done (`157bcc7`).

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
| **Phase 4.3** students search, grant pack, adjust with reason, book/cancel on behalf, sign-in remount fix (ADR-017) | frontend + backend engineer | `20261014001000_admin_students_credits.sql`, `app/admin/{alumnas,alumna}`, `booking/admin/students/**` | done: unit 459/459, pgTAP 396/396, races 9/9, db lint clean; security review 0 blocker/high, M1 (adjust cap vs held debits) fixed; orchestrator browser E2E vs local Supabase at phone width: search, grant 9→13, cancel-for 13→14 refunded with staff actor, ledger sum = balance, email kept when typed right after load |
| **Credit-expiry job (D10)** + full/booked card fix | backend engineer | `20261014001100_credit_expiry_job.sql`, pgTAP `09`, races "journey D10", `mock-ledger.ts` `expireDueGrants`, `session-meta.tsx` | done locally: `private.expire_credit_grants(p_now)` zeroes unused credits of expired packs with one `expiry` ledger row (system, no note), 5-min grace, idempotent, `skip locked`; pg_cron hourly (`expire-credit-grants`, minute 7) enabled locally; hosted confirmation is an owner step (`SUPABASE_SETUP.md` §4). Unit 531/531, pgTAP 435/435, races 11/11, db lint clean |
| **Phase 5.1** `demo-studio` by config (PL-01) | qa / frontend engineer | `brands/demo-studio`, `booking/config/copy.ts` (6 `meta.*` keys), `app/_booking/route-copy.ts` (route titles/descriptions from brand copy), `brands/brands.test.ts`, `booking/white-label.test.tsx` | done: zero diff in `booking/domain` + `booking/application`; every copy key non-empty for every registered brand; demo copy has no Bylou names/vocabulary/voseo; agenda, session detail, sign-in, Mis reservas, admin day and roster render under both brands (14 component tests); Bylou titles unchanged; unit 553/553 |
| **Pre-release hardening** churn throttle (ADR-019), account erasure (ADR-020), a11y pass (UX_DESIGN §5.2) | backend + frontend + qa | `20261014001200_throttle_and_erasure.sql`, pgTAP `10`, race "journey ADR-020", `booking/admin/students/erase-sheet.tsx`, `tests/e2e/a11y.spec.ts`, `brands/contrast.test.ts`, `@axe-core/playwright` 4.13.0 (exact, dev) | done (+ security-review fixes: no-email confirmation by name/id, grant/adjust refuse erased students with the profile lock, `anonymized_by` audit, owner-ban note in the sheet): unit 570/570, pgTAP 520/520, races 13/13, db lint clean, E2E 65/65 (desktop 23, mobile 23, demo-studio 19; new tests ×3 repeats, no flakes), opt-in Supabase E2E 2/2, `pnpm install --frozen-lockfile` ok, no secrets in `out/`. See "Accessibility pass" below |
| **Phase 4.4** waitlist (ADR-011 owner rule 2026-10-14, ADR-021) + required display name (ADR-022) | backend + frontend + qa | `20261014001300_waitlist.sql`, pgTAP `11_waitlist`, `tests/db/waitlist.test.ts`, `booking/ui/reserve/waitlist-action.tsx`, `booking/infrastructure/mock/mock-waitlist.ts`, `tests/e2e/waitlist.spec.ts` | done locally: FIFO promotion inside `cancel_booking` / `admin_cancel_for` / capacity increase (valid pack + more than `cancellation_window_hours` ahead, else skip), join/leave/place, Mis reservas list + "desde la lista" note, staff roster queue; `profile_incomplete` on `book_session` / `join_waitlist`, name step without "Ahora no". Unit 628/628, pgTAP 658/658, races 18/18, db lint clean, E2E 71/71 (after security-review fixes: random promotion keys + per-entry containment, self-cancellation limit on joins/promotion, invisible-name rule + CHECK, leave without lock, booking-close guard, caps 50/10) (+ new journey J and a11y waitlist screens; J ×3 repeats, no flakes), opt-in Supabase E2E 2/2, build ok, no secrets in `out/` |
| **Phase 5.2** Playwright E2E on the static export (ADR-009) | qa / frontend engineer | `@playwright/test` 1.63.0 (exact, pnpm 9 lockfile), `playwright.config.ts`, `playwright.supabase.config.ts`, `tests/e2e/**` | done: 56/56 green (desktop 20, mobile Pixel 7 20, demo-studio build 16) in ~36 s + ~30 s for the two builds; 3 reruns + `--repeat-each=3` (168) with no flakes; opt-in Supabase run (B + F) 2/2 green, then `supabase db reset` |

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

- ~~Sign-in: email typed right after page load is sometimes wiped; `useId` hydration mismatch~~ → fixed in 4.3 (auth state update in a transition + adopt pre-hydration input; regression test `sign-in-hydration.test.tsx`).
- ~~Admin new-session form: modality radios named `in_person`/`online`~~ → fixed in 4.3 (`RadioGroupField`, aria-labelledby on the visible text).
- ~~Flaky sign-in focus test~~ → focus moves in a layout effect (4.3).
- ~~Agenda card for a past session the student attended says "Ya tenés esta clase reservada"~~ → fixed: the application layer decides `entry.action` / `entry.myOutcome` in the domain order (cancelled → started → already booked → window → full); past cards read "Finalizada" + Asististe / No asististe / Reservada. Root cause: `ReserveAction` checked `myBookingId` before the session state. `SessionAvailability` now carries `myAttendance`.
- ~~After booking from the agenda, the card behind the sheet still shows the old spots count until refresh~~ → fixed: a successful booking re-reads that session from the repository right away (`getAgendaEntry` + `replaceAgendaEntry`; silent week reload as fallback). Cancel lives only in Mis reservas, which already re-reads after success (now tested).
- ~~Modality filter + remembered filter (PRD ST-01 AC4)~~ → shipped: Todas / Presencial / Online chips next to the practice chips; both filters remembered per device in `localStorage` (try/catch, page works when storage throws; stale practice falls back to "Todas").
- ~~New users have no display name yet~~ → optional "¿Cómo te llamamos?" step after verifying the code when `profiles.display_name` is empty (save / "Ahora no"). No migration: the existing column grant `update (display_name, phone)` + `profiles_update_own` RLS already allow it (pgTAP E5 extended). Client validation: trim, 1–80 chars, no control/bidi characters. The mock demo student already has a name, so the step does not appear in the mock demo. (Made required on 2026-10-14, see below.)

- ~~A full session the student has booked shows both "Esta clase está completa." and "Ya tenés esta clase reservada."~~ → fixed in `statusText` (`booking/ui/session-meta.tsx`, the single source of the card/detail status line): when `entry.action === "booked"`, the full / closed / not-open reason is hidden; the "Completa" badge and spots-left stay (agenda test).
- ~~Profile step: name is optional~~ → owner decision 2026-10-14: the name is **required** (no "Ahora no"), phone not collected (ADR-022). The step also appears for an already signed-in visitor without a name, and inside the confirm sheet / waitlist action; the server answers `profile_incomplete`. The mock has a second demo student `nueva@…` (pack, no name) to show it.

## Pre-release checklist (from security review, not yet done)

- [ ] CAPTCHA (Turnstile) on sign-in: needs site key + frontend change.
- [x] Throttle book/cancel churn (review LOW #3): `book_session` → `too_many_changes` after 6 self-cancellations or 3 bookings of the same session in 24 h (`studio_settings`, null = off; ADR-019).
- [x] Account erasure: `admin_anonymize_student` + "Borrar datos de la alumna" in the student detail; owner bans the auth user (`SUPABASE_SETUP.md` §10; ADR-020). **Owner decision pending:** the auth record keeps the email (Admin API or schema change to remove it).
- [ ] Admin UI must escape `display_name`; never put staff-only comments in credit notes (students can read their own notes).
- [ ] Never run `supabase/seed.sql` against a hosted project.
- [ ] Review lows (4.3): `admin_cancel_for` can refund after the session ended when attendance is unknown (documented AD-10 override; consider a reason or a time guard); no ledger audit row when a refund is skipped or `p_refund=false`; concurrent class types with the same name → raw 23505; `admin_book_for` allowed on unpublished sessions (documented).
- [ ] Adjust cap counts attended bookings as held, so a fully used pack cannot get a "+" adjustment (grant a new pack instead). Tell Lou.
- [ ] `npx pnpm@9 run test:db` leaves `race-*` users in the local DB; run `supabase db reset` afterwards.
- [ ] `.env.example`: writing `.env*` files is blocked by the current permission settings. Owner to allow or create it (content: `NEXT_PUBLIC_BOOKING_DATA_SOURCE`, `NEXT_PUBLIC_BOOKING_BRAND`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BASE_PATH`, all empty, public values only).

## Accessibility pass (pre-release, UX_DESIGN §5.2)

Automated in `tests/e2e/a11y.spec.ts` (desktop, mobile Pixel 7, demo-studio build): axe-core 4.13 with WCAG 2.0/2.1/2.2 A+AA + best-practice rules on agenda, session detail, sign-in (email + code), confirm sheet + success, Mis reservas, cancel sheet, admin guard, day, roster, class types, new class, students, student detail, grant sheet and erase sheet (with a field error). Serious/critical fail the test; the same run asserts `lang`, 44×44 px targets, no duplicated live-region text, focus trapped in an open sheet and returned to its trigger on Escape. Token contrast for every registered brand: `brands/contrast.test.ts`.

Fixed:
- `lang`: the booking wrapper (`[data-booking-theme]`) now carries the brand locale (`es-AR` for Bylou, `es` for demo-studio); sheets inherit it (portalled inside). `app/layout.tsx` (`<html lang="es">`) untouched.
- Landmarks (axe `region`, moderate): the demo banner sat outside every landmark; it now renders inside the `<header>` banner landmark (student and admin shells).
- Touch targets: agenda card title links were 28 px tall → 44 px hit area (`-my-2 min-h-11`, same visual rhythm); admin "Hoy" nav link 43 px wide → `min-w-11` (also on the student nav).
- Erase sheet: a field error moves focus to the field, so its description (the error) is read.
- Baseline before fixes: 0 serious/critical violations; contrast of every brand token pair already ≥ 4.5:1 text / ≥ 3:1 non-text (lowest: demo `textSecondary` on `subtle` 4.74, demo control border on canvas 3.27).

Verified, no change needed: heading order (axe `heading-order`), icon-only buttons named (sheet ✕ = "Cerrar"), form errors tied with `aria-describedby` + `aria-invalid` (sign-in, profile name, admin `FieldFrame`), the two "Todas" chips sit in groups named "Filtrar por práctica" / modality (E2E A), visible `:focus-visible` ring (3 px `--ring`), skip link on both layouts.

Remaining (moderate/minor, accepted for now):
- axe "needs review" inside open sheets: `aria-hidden-focus` (Radix focus guards and the `aria-hidden` page behind the modal; focus is trapped, asserted by E2E) and `color-contrast` (background hidden by the overlay; covered by the token test).
- Opening a sheet focuses its ✕ button (Radix default), not the primary action.
- Field errors in the grant / adjust / new-session forms are associated but not announced on submit (no focus move); consider focusing the first invalid field.
- A banned user who requests a code sees the generic sign-in error (`user_banned` maps to `unknown`).
- Not automated: 200 % zoom / 320 px reflow and a manual screen-reader pass (VoiceOver iOS, TalkBack) — do before launch.

## Blockers / decisions needing human input

Not blocking current work (Phase 2 runs on mock data). Needed before Phase 3:

1. ~~Cancellation rules~~ → decided (24 h, then blocked).
2. Credit validity measured at session start (not booking time)?
3. ~~Approve hosted Supabase~~ → approved to receive setup steps (owner creates project; `SUPABASE_SETUP.md`).
4. Mercado Pago in V2? (not MVP)
5. Align pnpm between local (11) and CI (9) via `packageManager` — touches deploy pipeline.

## Owner decisions 2026-10-14

- Waitlist rule approved: FIFO; auto-promote only with a valid pack and more than 24 h before start; otherwise skip to the next student. **Implemented (Phase 4.4, ADR-021):** a student without a valid pack is marked `skipped` (she leaves the list, sees why in Mis reservas and may join again at the end); inside the window nobody is promoted, entries stay `waiting`, joining is closed and the freed spot is bookable first-come. No notifications: she sees the result the next time she opens the app.
- Throttle limits approved: 6 self-cancellations / 3 bookings of the same class per 24 h.
- Profile: display name required (plus the sign-in email); phone not collected.

## Next step

1. **Owner:** follow `docs/booking/SUPABASE_SETUP.md`; send back only the project ref + checklist (never keys).
2. ~~Phase 4.1~~, ~~4.2~~, ~~4.3~~, ~~credit-expiry job~~, ~~4.4 waitlist~~ done (4.4 uncommitted until orchestrator verification). Phase 5.1, 5.2 and the pre-release hardening (throttle, erasure, a11y pass) done; next **Phase 5.3** release (remaining checklist: CAPTCHA, manual screen-reader/zoom pass, owner approves merge).
5. **Owner:** decide whether the auth record of an erased student must also lose its email (ADR-020: Admin API step outside the app, or a schema change). Confirm the throttle defaults (6 self-cancellations / 3 bookings of one class per 24 h) or give other numbers.
3. **Owner:** after pushing migrations, confirm the `expire-credit-grants` pg_cron job is active (`SUPABASE_SETUP.md` §4, step 4).
4. Fix UX backlog items above.

## Local database (Phase 3.1+)

Requires Docker + Supabase CLI (`brew install supabase/tap/supabase`). Local only — never `supabase link`/`db push` without owner approval.

```
npx pnpm@9 run db:start        # start local stack (studio/storage/realtime disabled)
supabase db reset              # re-apply migrations + fake seed
supabase test db               # pgTAP (658 assertions)
npx pnpm@9 run test:db         # multi-connection race tests
npx pnpm@9 run db:stop
```

## Local preview

```
NEXT_PUBLIC_BOOKING_DATA_SOURCE=mock npx pnpm@9 run dev            # http://localhost:3000/reservas/
NEXT_PUBLIC_BOOKING_DATA_SOURCE=mock NEXT_PUBLIC_BOOKING_BRAND=demo-studio npx pnpm@9 run dev
npx pnpm@9 test                                                    # unit + component tests
```

## E2E (Phase 5.2)

Playwright runs against the static export (`out/`), never `next dev`. Only Chromium is used.

```
npx pnpm@9 exec playwright install chromium   # once per machine
npx pnpm@9 run test:e2e                       # builds mock exports (bylou + demo-studio), serves them, runs 71 tests (incl. a11y)
E2E_SKIP_BUILD=1 npx pnpm@9 run test:e2e      # reuse the cached exports
npx pnpm@9 exec playwright test --project mobile -g "B ·"   # one project / journey
```

- Exports are copied to `node_modules/.cache/bylou-e2e/{bylou,demo-studio}` (git-ignored) and served by `tests/e2e/static-server.mjs` (node:http, trailing-slash + 404.html like GitHub Pages) on ports 4310/4311. `out/` is left with the last (bylou, mock) build: run the normal build again before inspecting `out/` for deploy.
- Reports and traces: `node_modules/.cache/bylou-e2e/{report,test-results}` (`npx pnpm@9 exec playwright show-report node_modules/.cache/bylou-e2e/report`). `.gitignore` was not touched (it has an unrelated pending change).
- Projects: `desktop` (Desktop Chrome) and `mobile` (Pixel 7) run every Bylou journey; `demo-studio` runs the brand-agnostic journeys tagged `@white-label` plus the identity smoke on the `NEXT_PUBLIC_BOOKING_BRAND=demo-studio` build.
- The browser clock is pinned to Wed 2026-10-14 09:00 (Buenos Aires) so the mock week, ids and occupancy are deterministic; external requests (fonts, analytics) get an empty 200; any console error or page error (incl. hydration mismatches) fails the test. Labels come from the brand copy, so a copy change updates the selectors.
- Journey J (Phase 4.4, desktop + mobile): "nueva@demo.test" (pack, no name) books next Monday's 1:1 through the required name step; the demo student finds it full and joins the waitlist ("lugar 1", listed in Mis reservas); "nueva" cancels > 24 h ahead; the demo student is moved in (booking with "¡Se liberó un lugar!" note, pack 7 → 6). Second test: a signed-in student who walked away from the name step is asked for it inside the confirm sheet. a11y adds the waitlist screens (agenda/detail join, waiting, Mis reservas list, name step error).
- Journeys: A agenda + type/modality filters + week paging; deep link + refresh (200, title, heading) on all 10 booking/admin routes; B OTP sign-in (demo code 123456) + book (double click books once) + Mis reservas; C full / finished / cancelled reasons and no-credit (demo staff account holds no pack) with contact link; D cancel >24 h refunds, <24 h denied with "Escribile a Lou" link; E student on `/admin/` sees "Sin acceso"; F staff publishes a class, opens rosters, marks attendance, grants a pack; G demo-studio theme/wordmark/vocabulary; H landing content intact and no link to `/reservas` or `/admin` (ADR-013).
- Not in CI: `.github/workflows/main.yml` is unchanged.

Opt-in, local Supabase only (journeys B and F with real OTP codes from Mailpit):

```
npx pnpm@9 run db:start && supabase db reset
npx pnpm@9 run test:e2e:supabase   # builds a bylou export against http://127.0.0.1:54321, refuses any non-local API URL
supabase db reset                  # restore the seed afterwards
```

## How to resume

```
Read docs/booking/PROGRESS.md and INITIAL_PROMPT_BYLOU_BOOKING.md, then continue from "Next step" on branch feature/booking-core (start Phase 4.1 admin UI unless the owner has finished SUPABASE_SETUP.md, in which case first link + push migrations with explicit approval).
Use `npx pnpm@9` for every package command (CI uses pnpm 9).
```
