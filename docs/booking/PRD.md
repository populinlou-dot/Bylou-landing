# Booking Core — Product Requirements (PRD)

Phase 1 · 2026-10-13 · Status: **Draft for owner review**
Related: [DECISIONS](./DECISIONS.md) (ADRs) · [ARCHITECTURE](./ARCHITECTURE.md) (boundaries, flows, contracts) · [DATA_MODEL](./DATA_MODEL.md) (tables, RLS, transactions) · [ROADMAP](./ROADMAP.md) (phases, DoD) · [UX_DESIGN](./UX_DESIGN.md) (screens, copy) · [REFERENCE_ANALYSIS](./REFERENCE_ANALYSIS.md)

Markers: **[OWNER]** = depends on an owner decision (default applied until answered) · **[FLAG]** = behind a feature flag.

---

## 1. Problem

| Today (verified, `UX_DESIGN.md` §1.9) | Consequence |
|---|---|
| Every booking (1:1, 4-class pack, trial) goes through Instagram DM or email. | Lou coordinates each class by hand; no shared view of who comes when. |
| No published schedule ("horario a medida"). | Students cannot self-serve; returning students repeat the same DM weekly. |
| Pack balance and 30-day expiry tracked informally. | Disputes and forgotten classes; no audit trail. |
| No cancellation rules visible to students. | Late cancellations hurt small classes and Lou's time. |

**Goal:** a calm, brand-native booking flow where a returning student books in ≤3 taps, Lou manages sessions, packs and attendance without repetitive messages, and the engine can serve another studio by swapping configuration only.

**Non-goal:** an ERP. No accounting, payroll, stock or invoicing.

## 2. Personas

| Persona | Context | Primary need | Phase |
|---|---|---|---|
| **New student** | Arrives from the landing or Instagram; has never booked online with Bylou. | See real availability before creating an account; sign in without passwords. | MVP (most still start with a DM trial, see `UX_DESIGN.md` §4) |
| **Returning student** | Holds a pack granted by Lou; books weekly, mostly from a phone. | Book fast, see upcoming classes and remaining credits, cancel within the rules. | MVP |
| **Admin (Lou)** | Sole instructor and owner; manages from her phone between classes. | Publish sessions, see rosters, mark attendance, grant packs, without repetitive work. | MVP |
| **Instructor** | Future additional teacher. | See own sessions and roster; mark attendance; no access to packs or settings. | V2 |

## 3. Scope

### 3.1 MVP (released at the end of Phase 5)

| Capability | Notes |
|---|---|
| Public agenda (no login) with practice + modality filters, day strip, spots left | Studio timezone stated (ADR-011). |
| Session detail by deep link (`?id=`) | ADR-003. |
| Email OTP sign-in | ADR-004. |
| Atomic, idempotent booking; 1 credit per booking | ADR-005, ADR-011. |
| Cancellation with configurable window; late cancel forfeits credit | ADR-011 **[OWNER]**. |
| My bookings: upcoming, history (attended / no show / cancelled), credit balance + expiry | |
| Online meeting link / in-person address revealed only to booked students | ADR-005 **[OWNER]** for address. |
| Admin: class types, single + weekly-recurring sessions, capacity, cancel session, roster, attendance | |
| Admin: grant pack (credits + expiry), adjust with reason, ledger view | ADR-006, no payments. |
| Waitlist (FIFO, auto-promotion rules) | Phase 4 **[FLAG]** `features.waitlist`; ADR-011. |
| Bylou theme + fictional `demo-studio` theme | ADR-007, ADR-008. |
| Add to calendar (`.ics`, generated client-side) | No backend needed. |

### 3.2 V2 (after MVP, each needs its own decision)

| Capability | Why later |
|---|---|
| Mercado Pago (Checkout Pro) to buy packs **[OWNER]** | ADR-006: no payments in MVP. |
| Transactional emails (booking confirmation, reminders, pack expiry) | Needs Edge Function + SMTP provider; MVP confirms on screen and in "Mis reservas". |
| WhatsApp reminders | New channel; Bylou uses IG + email today. |
| Instructor role | Lou is the only teacher. |
| "Repeat my slot" shortcut, fixed weekly slot holds | UX nice-to-have; validate demand first. |
| Admin editing of studio rules in UI | MVP rules are seeded/edited by SQL (see ARCHITECTURE §7). |
| No-show penalties, coupons, freeze, reports/export | Low value at current scale. |

### 3.3 Out of scope

Billing, invoicing (AFIP), accounting, payroll, stock, bulk WhatsApp, AI recommendations, commercially operated multi-tenant, native apps, marketplace listing, self check-in, multi-branch. Trial class and corporate programs stay on Instagram.

## 4. User stories and acceptance criteria

Defaults from ADR-011 are used in criteria (24 h free cancel, booking opens 30 days before and closes at start, 1 credit per booking). Copy keys refer to `UX_DESIGN.md` §3.1. Result codes refer to [ARCHITECTURE §5](./ARCHITECTURE.md#5-result-code-contract).

### Student (ST)

| ID | Story | Acceptance criteria | Phase |
|---|---|---|---|
| ST-01 | As a visitor, I see upcoming sessions without signing in. | 1. Lists `scheduled` sessions from now to the booking horizon, grouped by day in the studio timezone. 2. Each card shows time, duration, practice, modality, instructor, and "Quedan N lugares" / "Completa" in text. 3. Cancelled and past sessions are not listed; a started session today shows "En curso" without CTA. 4. Filters by practice and modality persist across visits. 5. Empty day shows `empty.day` + "Ver próxima fecha". | 2 |
| ST-02 | As a visitor, I open a session from a shared link. | 1. `/reservas/clase/?id=<id>` renders the session after direct load and browser refresh. 2. Unknown or missing `id` shows a not-found state with a link to the agenda. | 2 |
| ST-03 | As a new or returning student, I sign in with a 6-digit email code. | 1. Email → code → signed in, on `/reservas/ingresar/`. 2. First sign-in asks name (required) and phone (optional). 3. After sign-in, the user returns to the interrupted action (`returnTo` restricted to same-origin `/reservas/` paths). 4. Wrong/expired code shows an inline error and "Reenviar código". | 3 |
| ST-04 | As a student with credit, I reserve a place. | 1. "Reservar" opens a confirm sheet showing date, time, modality, credit use (`sheet.credit`) and policy (`sheet.policy`). 2. "Confirmar reserva" creates exactly one `confirmed` Booking and one `booking_debit` ledger entry from the earliest-expiring valid CreditGrant. 3. Success navigates to `/reservas/confirmada/?id=`. 4. Spots shown decrease on next load. | 3 |
| ST-05 | As a student on a flaky connection, retrying never double-books me. | 1. Double tap, retry after timeout, or replayed request with the same `idempotencyKey` returns the original result. 2. Never more than one active Booking per student per session, never more than one debit for it. | 3 |
| ST-06 | As a student, I understand why I cannot book. | Each refusal code maps to a specific message and one next action: `session_full` → `error.conflict` (+ waitlist offer if flag on); `no_valid_credit` → `pack.none` + "Coordiná tu pack con Lou"; `already_booked` → link to "Mis reservas"; `booking_not_open` / `booking_closed` / `session_started` / `session_cancelled` → explanatory text, CTA hidden. | 3 |
| ST-07 | As a student, I see my upcoming bookings and history. | 1. Tabs "Próximas" / "Historial". 2. History labels: Asististe / No asististe / Cancelada (incl. late) in text. 3. Only my own bookings are ever returned (see SE-02). | 3 |
| ST-08 | As a student, I see my remaining credits and when they expire. | 1. Balance = sum of non-expired grant remainders; nearest expiry date shown. 2. Expired pack shows `pack.expired`. 3. Matches the ledger exactly. | 3 |
| ST-09 | As a student, I cancel a booking under clear rules. | 1. ≥24 h before start: status `cancelled`, `cancel_refund` ledger entry, spot freed, toast `cancel.done`. 2. <24 h and before start: dialog warns the credit is not refunded (`cancellation_too_late`); confirming sets `late_cancelled`, spot freed, no refund. 3. After start: `cancellation_not_allowed`, CTA replaced by text + IG contact. 4. Repeating a cancel never refunds twice. | 3 **[OWNER]** |
| ST-10 | As a booked student, I get the online link or address. | 1. Meeting URL / address readable only with an active booking (RLS). 2. "Entrar a la clase" button enabled 15 min before start (UI only). | 3 **[OWNER]** address |
| ST-11 | As a student, I add a booked class to my calendar. | Downloads a valid `.ics` with UTC start/end and title; no meeting URL inside if not booked. | 3 |
| ST-12 | As a student, I join the waitlist of a full session. | 1. "Anotarme en la lista" creates a `waiting` WaitlistEntry (one per student per session). 2. Shows "lugar N". 3. "Salir de la lista" → `left`. 4. On a freed spot, the first eligible entry is `promoted` (booking created + debit) per ADR-011; ineligible ones are `skipped`. | 4 **[FLAG] [OWNER]** |

### Admin (AD)

| ID | Story | Acceptance criteria | Phase |
|---|---|---|---|
| AD-01 | As Lou, only staff can use admin. | 1. Non-staff signed-in users on `/admin/` see "Sin acceso" and receive no admin data. 2. Every admin RPC refuses non-staff (`forbidden`) server-side. | 4 |
| AD-02 | As Lou, I manage class types. | Create/edit/archive ClassType (name, description, duration, default modality, default capacity). Archived types keep history. | 4 |
| AD-03 | As Lou, I publish a session. | 1. Fields: ClassType, start (entered in studio TZ, stored UTC), duration, modality, capacity ≥1, location or meeting URL. 2. Appears in the public agenda immediately. 3. 1:1 = capacity 1 **[OWNER]** (Lou must publish 1:1 slots). | 4 |
| AD-04 | As Lou, I publish a weekly recurring slot in one step. | Generates N concrete Sessions (default 4 weeks); each editable/cancellable independently; no recurrence engine. | 4 |
| AD-05 | As Lou, I change capacity or cancel a session. | 1. Capacity cannot go below confirmed bookings. 2. Cancel session → status `cancelled`, all confirmed bookings cancelled with `cancel_refund` regardless of window, waiting entries closed. | 4 |
| AD-06 | As Lou, I see a session roster. | Name, booking status, attendance, waitlist count; mobile-usable ("Hoy" view). | 4 |
| AD-07 | As Lou, I record attendance. | Mark `attended` / `no_show` per booking; editable up to 7 days after the session; saved server-side, never optimistic. | 4 |
| AD-08 | As Lou, I grant a pack after an off-platform payment. | 1. CreditGrant (credits, expiry date, note) + `grant` ledger entry. 2. `admin_adjust` entries require a reason. 3. Ledger is append-only and visible per student. 4. UI never implies an online payment. | 4 (SQL/seed in 3) |
| AD-09 | As Lou, I find a student. | Search by name/email; see balance, upcoming bookings, history. | 4 |
| AD-10 | As Lou, I book or cancel for a student. | Admin override bypasses windows (not capacity unless explicit), logged with actor. | 4 (should) |

### Instructor (IN) — V2

| ID | Story | Acceptance criteria |
|---|---|---|
| IN-01 | As an instructor, I see my sessions and mark attendance. | Only sessions where I am instructor; no access to packs, ledger or settings. |

### Security & platform (SE, PL)

| ID | Story | Acceptance criteria | Phase |
|---|---|---|---|
| SE-01 | The last spot is never oversold. | N concurrent `book_session` calls on a session with 1 spot → exactly 1 `confirmed`, N-1 `session_full`; credits debited exactly once. | 3 |
| SE-02 | Students only see and change their own data. | Student A cannot select/update B's bookings, ledger, waitlist or profile; cannot insert/update any business table directly; cannot change capacity or `profiles.role`; admin RPCs return `forbidden`. | 3 |
| SE-03 | No secrets ship to the browser. | `out/` and the repo contain only the Supabase URL + anon key; a CI/grep check finds no service-role key. | 3 |
| PL-01 | The engine runs with a second brand. | Switching to `demo-studio` changes colors, fonts, radii, copy and terminology with **zero** diff in `booking/domain` and `booking/application`. | 5 |
| PL-02 | The landing keeps working. | `/` renders identically; title, meta, CTAs and Instagram links unchanged; deploy workflow unchanged (ADR-001). | every phase |
| PL-03 | Mock data is never mistaken for real data. | Data source is explicit via `NEXT_PUBLIC_BOOKING_DATA_SOURCE` (ADR-013); missing/invalid → config-error state, never a silent mock fallback. Mock shows a persistent "Datos de demostración" banner. | 2 |

## 5. Acceptance journeys (brief A–H)

Test layers: **Unit** = Vitest on `booking/domain` / `booking/application` · **SQL** = SQL/pgTAP against Supabase local · **E2E** = Playwright on static `out/` (ADR-009).

| Journey | Stories | Proven by | Key assertion |
|---|---|---|---|
| A. Student sees real availability and reserves one place | ST-01, ST-03, ST-04 | Unit (availability, booking decision) · SQL (`book_session` happy path) · E2E (agenda → sign in → confirm) | One `confirmed` booking, one debit, spots −1. |
| B. Two students race for the last spot: no overselling | SE-01 | SQL (parallel sessions, row lock) · Unit (`session_full` decision) | Exactly one winner. |
| C. Same student retries: no duplicate booking or double debit | ST-05, ST-09.4 | SQL (same key replay; cancel replay) · Unit (application reuses key on retry) · E2E (double click) | One booking, one ledger debit. |
| D. Valid cancellation frees the spot, keeps history, updates credit and waitlist | ST-09, AD-05, ST-12 | Unit (cancellation decision incl. window edges) · SQL (refund entry, status history, promotion) · E2E | Booking row kept with new status; ledger balanced. |
| E. Student cannot read/modify others' bookings or change capacity/roles | SE-02, AD-01 | SQL (RLS + RPC authorization as two users + anon) | 0 rows / permission denied / `forbidden`. |
| F. Admin creates a session, reviews roster, records attendance | AD-03, AD-06, AD-07 | SQL (admin RPCs as staff) · E2E (admin flow, mobile viewport) | Attendance persisted. |
| G. Bylou theme replaced by `demo-studio` without domain changes | PL-01 | Unit (domain/application import-purity scan; `themeToCssVars` for both brands) · E2E (smoke with demo brand) | No brand import in domain; visual tokens differ. |
| H. Landing, SEO and deploy keep working | PL-02 | E2E (smoke `/`, refresh on `/reservas/` and `/admin/`) · build check (`NEXT_PUBLIC_BASE_PATH="" pnpm build`) | Landing unchanged, routes refresh with 200. |

## 6. Owner questions (most decision-relevant first)

1. **Cancellation rules (ADR-011):** keep 24 h free cancellation, and allow late cancellation with credit forfeited (vs. blocking it)? Waitlist auto-promotion OK?
2. **1:1 slots:** will you publish 1:1 availability as bookable slots for pack holders (replacing "horario a medida")?
3. **Pack rule:** are the 4 credits usable freely within 30 days, or limited to 1 per week?
4. **Supabase + email:** approve creating a free Supabase project and a transactional email sender (needed for sign-in codes in production)?
5. **In-person address:** show it only to booked students (default) or publicly per session?
6. **Mercado Pago (V2):** confirm it is wanted, and whether bank transfer with manual confirmation must also be supported.
