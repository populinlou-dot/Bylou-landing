# Booking UX Design — Bylou

Owner: product-designer · Phase 0 (Discovery) · 2026-10-13
Scope: visual system extraction, IA, screens and states, microcopy, landing entry point, accessibility, `BookingTheme` mapping.
Language: document in English, proposed UI copy in Spanish (es-AR).

Sources inspected: `app/globals.css`, `app/layout.tsx`, `app/page.tsx` (1810 lines, single client component), `components/theme-provider.tsx`, `next.config.mjs`, `.github/workflows/main.yml`, `public/assets/*`, live https://bylou.com.ar/ (text content via fetch).

---

## 1. The real Bylou visual system

### 1.1 Key finding: two token layers, only one is real

| Layer | Where | Used by the landing? | Notes |
|---|---|---|---|
| shadcn/v0 tokens (`--background`, `--primary`, … in OKLCH) | `app/globals.css` `:root` / `.dark` | **No** | Leftover from the v0 scaffold. `--primary` = `oklch(0.38 0.15 15)` ≈ `#7F0327`, which is **not** the brand burgundy `#A41D2D`. `.dark` is generic grey. |
| Brand hex + local custom properties | Inline `<style>` and inline `style` strings inside `app/page.tsx` | **Yes** | The actual visual truth. `:root` vars there: `--butter*`, `--fucsia`, `--r-*`, `--sp-*`, `--content-*`, `--burgundy-*`. |

Consequence: the `bylou` theme must be built from the hex palette in `page.tsx`, not from `globals.css`. Because those vars and body styles live inside the landing page component, **`/reservas` will not inherit them** (no `#FDECEC` body, no `--butter`, no `:focus-visible` rule, no skip-link style). The booking layout must declare its own theme scope.

### 1.2 Palette (from `page.tsx`)

| Role (proposed name) | Value | Real usage |
|---|---|---|
| `burgundy` (brand primary) | `#A41D2D` | Primary CTAs, links, eyebrows, active nav, ticks, focus outline |
| `burgundy-hover` | `#8B1A28` | Link hover, gradient end, text on light pink buttons |
| `burgundy-surface` | `#9B2B3A` | Large burgundy panels (breathing section) |
| `burgundy-deep` | `#7C1526` / hover `#6A1120` | Meditation CTA (rectangular variant) |
| `ink` (text strong) | `#4A0000` | Headings, body strong, dark surfaces (testimonials, footer, guide card) |
| `ink-soft` (text body) | `#6B0505` | Paragraphs, secondary text |
| `ink-alt` | `#5C2130` | One subtitle (meditation) |
| `blush` (canvas) | `#FDECEC` | Page background, chips, selected states |
| `blush-soft` | `#FFF5F5` | Alternate section bg, card side panels, hover |
| `blush-light` | `#FFF8F8` | Hero top, meditation section |
| `white` | `#FFFFFF` | Cards, nav pill, FAQ panel |
| `rose-border` | `#F3DADA` / `#F7E6E6` | Card borders / dividers |
| `rose-dot` | `#E8C5C5` | Marquee separators |
| `rose-number` | `#C98B95` | Panel numerals (decorative) |
| `pink-bright` | `#FF8EBE` | Accent on dark (guide eyebrow, dot) |
| `pink-tint` | `#FFC3DE` / `#FFE6E6` | Text on burgundy surfaces |
| `pink-button` | `#FCE7EC` / hover `#FBDCE4` | Light button on burgundy |
| `fucsia` | `#D75B86` | Expressive accent: active-nav dot, FAQ chevron, eyebrow on dark, one heading word |
| `butter` | `#EAD99A` | Light accent on dark (numbers, arrow, dot) |
| `butter-ink` | `#D2B565` | Stars on white |
| `butter-soft` / `butter-wash` | `#F7EFD5` / `#FCF7E8` | Text highlight / open FAQ row |
| `media-dark` | `#2A0007` | Video placeholders |
| Hero gradient | `#FFF8F8 → #FDECEC → #FBE2E2` | Hero only (`.hero-bg` radial in globals is unused) |

### 1.3 Typography

| Role | Family | Details |
|---|---|---|
| Display / headings | Playfair Display (400/500/600, italic) | Loaded twice: `next/font` var `--font-playfair` **and** a Google Fonts `<link>`; inline styles use the literal `'Playfair Display'`. Headings: `letter-spacing -0.03em`, `line-height ~1.04`, one word in *italic burgundy* for emphasis. |
| Body / UI | Geist | Inline: `font-family:"Geist", ui-sans-serif, system-ui`. See risk R2. |
| Eyebrow | Geist 700, 11–12px, uppercase, `letter-spacing 0.18–0.26em`, burgundy | Section labels ("Clases y packs") |

Scale (desktop → ≤640px): H1 `clamp(38px,5.4vw,68px)` → `clamp(29px,8.4vw,37px)`; H2 `clamp(28–34px … 44–60px)` → `clamp(23px,6.4vw,30px)`; H3 34px → 17px; lead 17–20px; body 15–16.5px (15px mobile, lh 1.55); small 12.5–14.5px; button 14.5–16.5px / 600.

### 1.4 Spacing, layout, radii, shadows

- Section rhythm: `--sp-xl 84 / lg 66 / md 50 / sm 38px` (≤900px: 56/46/36/28). Gutters: 34px desktop, 18px ≤640px. Content widths 1080 / 1240 / 1380px (most sections 1320px).
- Radii: `--r-sm 7px` (tags), `--r-md 11px` (rectangular buttons), `--r-lg 18px` (photos), `--r-xl 40px` (26px ≤900) for big panels. In practice also: pills `99px` (almost all CTAs and chips), cards 20–32px, story cards 22px. Signature: **arched photo frame** `280px 280px 30px 30px`.
- Shadows: long, soft, burgundy-tinted, negative spread. Card `0 22px 50px -34px rgba(74,0,0,.5)`; elevated `0 30px 70px -34px rgba(74,0,0,.5)`; primary CTA `0 18px 40px -16px rgba(164,29,45,.9)`.

### 1.5 Components

| Component | Spec |
|---|---|
| Primary button | Pill, h 56–60px (min 48px mobile), `#A41D2D` bg, white 600 text, optional arrow icon, hover lift `translateY(-2/-3px)` + deeper shadow |
| Secondary button | Pill, transparent, `1.5px rgba(164,29,45,.28–.32)` border, burgundy text, hover bg `#fff`/`#FDECEC` |
| Inverse button (on dark) | White bg, burgundy text |
| Chip / segmented | Pill h 50px; off: white bg, `rgba(164,29,45,.16)` border, `#6B0505` text; on: burgundy fill, white text |
| Card | White, 1px `#F3DADA`, radius 20–28px, soft burgundy shadow; feature lists with round `#FDECEC` check badges |
| Badge | Uppercase 10.5px 700, pill, `#FDECEC` bg, burgundy text |
| Accordion | White panel, rows separated by `#F7E6E6`, open row `--butter-wash`, fucsia chevron |
| Nav | Fixed; pill container `rgba(255,255,255,.78)` + blur; condenses on scroll; mobile ≤1100px → full-screen drawer of numbered cards |

### 1.6 Motion

Easing `cubic-bezier(.22,.61,.36,1)` everywhere. UI transitions .25–.4s; scroll reveals .8–1.15s (up / scale / mask / stagger); infinite marquees; floating note. `prefers-reduced-motion` is respected globally (animations neutralised, reveals skipped, breathing orb static). Booking app should keep the easing and 200–300ms UI transitions, **no scroll reveals and no hover lifts in dense lists**.

### 1.7 Imagery

Real photography only: Lou and students, warm natural light, studio/terrace/mountain/lake, online sessions on tablet; vertical videos; ginkgo leaf logomark; sparkles PNG. No stock, no illustrations. Booking: at most a small practice thumbnail; empty states use the ginkgo mark + text, never stock art.

### 1.8 Voice and microcopy

- Rioplatense **voseo**, informal, warm: "Regulá", "Elegí", "Probá", "Escribime", "¿Qué te trae hasta acá?".
- Lou speaks in **first person singular** ("Te propongo día, horario…", "Respondo en el día").
- Short, concrete benefits; science explained plainly ("activa tu sistema nervioso parasimpático"); reassurance ("Sin compromiso", "No hace falta flexibilidad").
- Inclusive by slash when needed ("sola/o"). Emoji 🌸 only inside prefilled DMs.
- Headings in sentence case with an italic emphasis word; eyebrows uppercase.

### 1.9 What the site offers today (repo = live, verified 2026-10-13)

| Offering | Detail | Booking today |
|---|---|---|
| Clase individual (1:1) | $22.000 / clase · 60 min · online or presencial | IG DM prefilled ("Reservar") |
| Pack 4 clases | $79.900 / mes · 1 per week · valid 30 days · follow-up by message | IG DM ("Empezar el pack"); FAQ: "reservás cada clase según los horarios disponibles" |
| Empresas | "A medida" · 10–45 min · remote or office | IG DM ("Pedir propuesta") |
| Grupales | Mentioned in hero and FAQ only; no price, no schedule | — |
| Meditación | Separate offer, "20% OFF" badge | IG DM ("Quiero recibir más información") |
| Primera sesión / clase de prueba | "Charlamos 15 min, armamos tu plan y practicás. Sin compromiso." | Header/hero/footer CTA "Reservar clase de prueba" → IG DM |
| Locations | "Online y presencial en Buenos Aires" (address "a coordinar") | — |
| Schedules | None published ("Horario a medida") | — |
| Contact | Instagram DM (`ig.me/m/bylou.yoga`), email `yoga.byloupopulin@gmail.com`, Google Form (free guide). **No WhatsApp anywhere.** | — |

**MVP modality recommendation**

| Modality | MVP? | Why |
|---|---|---|
| 1:1 session (capacity 1), online or presencial | **Yes** | Core paid product; maps to a session with capacity 1 |
| Pack credits (4 classes / 30 days), granted manually by admin | **Yes** | Already the stated mechanic ("reservás cada clase"); no fake payment |
| Group session (capacity N) | Yes, behind a flag | Mentioned but not yet sold; same engine, enable when Lou publishes groups |
| Trial / first session | No (keep IG) | It is a conversation, not a slot; brand value is the human first contact |
| Empresas, Meditación program | No | Proposal-based / undefined |

Open product decision: today 1:1 is "horario a medida". Booking requires Lou to **publish availability** (slots). Confirm she accepts this shift for pack holders.

---

## 2. Information architecture

### 2.1 Route map (static export, `trailingSlash: true`)

```
PUBLIC / STUDENT (layout: booking, theme scope)      ADMIN (layout: admin, noindex)
/reservas/                 Agenda (home)              /admin/              Hoy
/reservas/sesion/?id=…     Session detail (deep link) /admin/agenda/       Week grid + create
/reservas/ingresar/        Sign in (email code)       /admin/clase/?id=…   Roster, attendance, waitlist
/reservas/mis-reservas/    Upcoming + history + pack  /admin/alumnos/      Students, packs, balance
/reservas/confirmada/?id=… Confirmation               /admin/practicas/    Class types
                                                      /admin/ajustes/      Rules, theme, terminology
```
- Dynamic IDs use **query params**, not `[id]` segments: static export cannot pre-render unknown IDs.
- Admin has its own layout and navigation; no link to it from the student UI. Students never see admin chrome.

### 2.2 Primary journey

```
Elegir práctica ─► Ver días/horarios/lugares ─► Reservar ─► Confirmación ─► Gestionar
 (chips on agenda)   (day strip + list)          (sheet)      (screen + mail)  (Mis reservas)
```
Decision: practice selection is a **chip filter on the agenda**, not a separate screen. With 1–2 practice types a catalog step only adds a tap. Config flag `showCatalogStep` enables it for studios with >4 types.

**Returning student ≤3 taps** (session persisted, filters remembered):
1. Landing "Reservas" → agenda opens on the next day with availability, filtered by last practice/modality. *(Modality filter and remembered filter: pending slice, PRD ST-01 AC4; 2.1 ships the practice filter only.)*
2. Tap **Reservar** on a session.
3. Tap **Confirmar reserva** in the sheet → done.

Shortcut "Repetir horario": card at top of agenda ("Martes 19:00 · Individual online") → Reservar → Confirmar (2 taps). Supports the fixed-weekly-slot habit.

First-time student: Reservar → sign-in (email + 6-digit code, name, phone) → back to the same sheet with intent preserved → Confirmar.

### 2.3 Screens (mobile-first, 360px)

**S1 · Agenda `/reservas/`**
```
┌──────────────────────────────────┐
│ ❦ Yoga ByLou        Mis reservas │
├──────────────────────────────────┤
│ RESERVAS                         │
│ Elegí tu próxima clase           │  Playfair H1
│ ┌──────────────────────────────┐ │
│ │ Tu pack · 3 de 4 clases      │ │  only if signed in
│ │ Vence el 12 de nov.          │ │
│ └──────────────────────────────┘ │
│ (Todas)(Individual)(Grupal)      │  chips = practice
│ (Online)(Presencial)             │  chips = modality
│ ‹ Lu 13 Ma 14 Mi 15 Ju 16 Vi 17 ›│  day strip, dots = availability
│                                  │
│ Martes 14 de octubre             │
│ ┌──────────────────────────────┐ │
│ │ 19:00 · 60 min               │ │
│ │ Clase individual · Online    │ │
│ │ Con Lou · Queda 1 lugar      │ │
│ │                  [ Reservar ]│ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 20:15 · 60 min   COMPLETA    │ │
│ │ Clase grupal · Presencial    │ │
│ │       [Anotarme en la lista] │ │  secondary style
│ └──────────────────────────────┘ │
│ Horarios de Argentina (GMT-3)    │
└──────────────────────────────────┘
```

**S2 · Confirm sheet** (bottom sheet on mobile, dialog on desktop)
```
┌──────────────────────────────────┐
│ ─────                         ✕  │
│ Clase individual                 │
│ Martes 14 de octubre             │
│ 19:00 a 20:00 · Online           │
│ Con Lou                          │
│ ──────────────────────────────── │
│ Usás 1 de tus 3 clases.          │
│ Podés cancelar hasta 24 h antes. │
│ El link aparece en Mis reservas. │
│ [        Confirmar reserva      ]│  primary, full width
│          Volver                  │
└──────────────────────────────────┘
```

**S3 · Sign in** `/reservas/ingresar/`: email → code (6 inputs as one `one-time-code` field) → first time: name, phone (optional, for reminders). Returns to the interrupted sheet.

**S4 · Confirmation** `/reservas/confirmada/?id=`
```
│          ❦                       │
│ ¡Listo! Tu clase                 │
│ quedó reservada.                 │
│ Martes 14 de octubre · 19:00     │
│ Clase individual · Online        │
│ [  Agregar al calendario  ]      │  .ics
│ [  Ver mis reservas       ]      │
│ Te mandamos los detalles a       │
│ ana@mail.com                     │
```

**S5 · Mis reservas** `/reservas/mis-reservas/`
```
│ Mis reservas                     │
│ [Próximas] [Historial]           │  tabs
│ Pack 4 clases · 3 disponibles    │
│ ┌──────────────────────────────┐ │
│ │ Mar 14 oct · 19:00 · Online  │ │
│ │ Clase individual             │ │
│ │ [Entrar a la clase] (15' antes)│
│ │ Cancelar reserva             │ │  text button
│ └──────────────────────────────┘ │
│ Historial: Asististe / No        │
│ asististe / Cancelada            │
```

**S6 · Cancel dialog**: summary + consequence ("La clase vuelve a tu pack") + `Sí, cancelar` / `No, mantener`. Inside the 24 h window Bylou (`lateCancelPolicy: "deny"`, ADR-011) opens no dialog: `Cancelar reserva` is replaced by `cancel.closed` ("Ya no se puede cancelar online… escribile a Lou"), code `cancellation_too_late`. Studios on the platform option `allow_without_refund` instead get a forfeit warning (`cancel.late`) and can confirm.

**Admin A1 · Hoy `/admin/`** (mobile-usable: Lou will mark attendance from her phone)
```
│ Hoy · martes 14                  │
│ 19:00 Individual · Online   1/1  │
│   Ana P.        [Presente][Aus.] │
│ 20:15 Grupal · Presencial   8/8  │
│   Lista de espera: 2             │
│ [+ Nueva clase]                  │
```
A2 Agenda (week grid, create single or weekly-recurring session), A3 Clase (roster, capacity, waitlist, cancel session and notify), A4 Alumnos (search, pack, balance, history, "Habilitar pack" manual grant), A5 Prácticas, A6 Ajustes (cancellation window, booking horizon, waitlist on/off). Admin uses the same tokens but a quieter chrome: Geist only except page titles, denser rows, no editorial imagery.

### 2.4 State matrix

| Screen | Loading | Empty | Error | Success | Full / waitlist | Past session | Cancel window closed |
|---|---|---|---|---|---|---|---|
| Agenda | Skeleton cards (static under reduced motion), day strip visible | "No hay clases publicadas para este día." + `Ver próxima fecha` | Inline banner + `Reintentar`; keep last data if cached | — | Badge `COMPLETA`; secondary `Anotarme en la lista`; if on list: "Estás en la lista · lugar 2" | Listed with text label `Finalizada` (past) or `Cancelada` (studio-cancelled), no CTA; started sessions show `En curso`, no CTA | n/a |
| Confirm sheet | Button → "Reservando…", disabled, spinner ≤ inline | — | Conflict: "Alguien reservó el último lugar recién." + waitlist offer; no pack: S8 copy | Navigate to S4 | Waitlist confirm variant | Sheet cannot open (CTA hidden) | n/a |
| Confirmation | Skeleton | — | "No encontramos esta reserva." + `Ver mis reservas` | ✓ | "Te anotamos en la lista de espera." variant | — | — |
| Mis reservas | Skeleton | "Todavía no tenés clases reservadas." + `Ver horarios` | Banner + `Reintentar` | Toast after cancel: "Reserva cancelada. La clase volvió a tu pack." | "Lista de espera · lugar N" row + `Salir de la lista` | Moves to Historial with outcome label | `Cancelar` replaced by text: "Ya no se puede cancelar online…" + IG contact |
| Admin Hoy/Agenda | Skeleton rows | "No hay clases hoy." + `Nueva clase` | Banner + retry; writes never optimistic | Toast "Asistencia guardada" | Shows `8/8` + waitlist count | Read-only roster, attendance editable 7 days | n/a (admin may override, logged) |

Rules: never convey state by color or opacity alone (always text/icon); double-submit protected (idempotent button + server key); every error offers one next action.

---

## 3. Microcopy (es-AR) and terminology

### 3.1 Copy catalog (theme-overridable keys)

| Key | Bylou | Note |
|---|---|---|
| `agenda.eyebrow` | RESERVAS | |
| `agenda.title` | Elegí tu próxima clase | |
| `agenda.tz` | Horarios de Argentina (GMT-3) | Shown when user TZ ≠ studio TZ, always on online sessions |
| `filter.all` | Todas | |
| `session.cta` | **Reservar** | Primary CTA, fixed verb |
| `session.spots.many` | Quedan {n} lugares | |
| `session.spots.one` | Queda 1 lugar | |
| `session.full` | Completa | |
| `session.instructor` | Con {name} | |
| `session.inProgress` | En curso | |
| `waitlist.join` | Anotarme en la lista | |
| `waitlist.joined` | Estás en la lista de espera · lugar {n} | |
| `waitlist.promoted` | ¡Se liberó un lugar! Tu clase quedó reservada. | If auto-promotion is chosen |
| `waitlist.leave` | Salir de la lista | |
| `sheet.confirm` | Confirmar reserva | |
| `sheet.pending` | Reservando… | |
| `sheet.credit` | Usás 1 de tus {n} clases. | |
| `sheet.policy` | Podés cancelar hasta {h} h antes. | Rule-driven |
| `sheet.back` | Volver | |
| `success.title` | ¡Listo! Tu clase quedó reservada. | |
| `success.calendar` | Agregar al calendario | |
| `success.mail` | Te mandamos los detalles a {email} | |
| `mine.title` | Mis reservas | |
| `mine.upcoming` / `mine.history` | Próximas / Historial | |
| `mine.empty` | Todavía no tenés clases reservadas. | |
| `mine.join` | Entrar a la clase | Online, enabled 15 min before |
| `cancel.cta` | Cancelar reserva | |
| `cancel.confirm` / `cancel.keep` | Sí, cancelar / No, mantener | |
| `cancel.done` | Reserva cancelada. La clase volvió a tu pack. | |
| `cancel.closed` | Ya no se puede cancelar online: faltan menos de {h} h. Si te surgió algo, escribile a Lou. | Brand contact link |
| `history.attended` / `absent` / `cancelled` | Asististe / No asististe / Cancelada | |
| `pack.balance` | {used} de {total} clases · vence el {date} | |
| `pack.none` | Para reservar necesitás un pack activo. | |
| `pack.none.cta` | Coordiná tu pack con Lou | Opens IG DM (no payment in MVP) |
| `pack.expired` | Tu pack venció el {date}. | |
| `auth.title` | Entrá con tu mail | |
| `auth.code` | Te mandamos un código de 6 dígitos a {email}. | |
| `auth.resend` | Reenviar código | |
| `error.load` | No pudimos cargar los horarios. Revisá tu conexión y probá de nuevo. | |
| `error.retry` | Reintentar | |
| `error.conflict` | Alguien reservó el último lugar recién. | |
| `empty.day` | No hay clases publicadas para este día. | Not used yet: 2.1 shipped a week view with `empty.week`. |
| `empty.next` | Ver próxima fecha | |

Voice rules: voseo; system messages impersonal (no "te devolví"), Lou's first person only where the human relationship is the point (`cancel.closed`, `pack.none.cta`); dates in long form "martes 14 de octubre", 24h `19:00`; no exclamation marks except success; no "turno" (clinical) and no "créditos" (accounting) in Bylou copy.

### 3.2 Terminology map

Spanish needs grammatical gender and plural, so the map stores both. Full sentences live in the copy catalog; **never** build sentences by interpolating terms with articles.

| Domain term | Bylou (sing / plural / gender) | demo-studio |
|---|---|---|
| `classType` | práctica / prácticas / f (label on chips: "Clase individual") | actividad / actividades / f |
| `session` | clase / clases / f | turno / turnos / m |
| `instructor` | profe / profes / f·m (display "Con Lou") | instructor/a |
| `booking` | reserva / reservas / f | reserva / reservas / f |
| `plan` | pack / packs / m | membresía / membresías / f |
| `credit` | clase disponible / clases disponibles / f | crédito / créditos / m |
| `waitlist` | lista de espera / f | lista de espera / f |
| `location.online` | Online | Virtual |
| `location.inPerson` | Presencial · Buenos Aires | Sede {name} |
| `attendance` (admin) | asistencia | asistencia |

---

## 4. Landing entry point (minimal change)

Constraints observed: header CTA "Reservar clase de prueba" (IG) is hidden ≤1100px; mobile navigation is only the drawer, fed by `NAV_PANEL`; desktop pill is fed by `NAV_LINKS`.

**Recommendation (data-only, 2 entries, zero style changes):**
1. Add `{ key: "reservas", href: \`${basePath}/reservas/\`, label: "Reservas" }` to `NAV_LINKS` (desktop pill).
2. Add `{ n: "00", key: "reservas", href: \`${basePath}/reservas/\`, title: "Reservá tu clase", desc: "Para alumnos con pack: elegí día y horario." }` as first item of `NAV_PANEL` (desktop "Explorar" + mobile drawer).

Keep every "Reservar clase de prueba" CTA pointing to Instagram: new students start with a conversation; "Reservas" (noun) is the place for existing students, so the two labels do not compete. Must use `basePath` (production default in `next.config` is `/Bylou-landing` unless the env var is set; the workflow sets it to `""`).

Phase 2 (after validation, separate decision): point the "Clase individual" plan button to `/reservas/?practica=individual` and update FAQ "¿Cómo funcionan los packs y la reserva?".

Alternative with even less risk: only step 2 (no pill change). Trade-off: no visible entry on desktop without opening "Explorar". Verify the 6-link pill does not overflow between 1101–1280px before shipping step 1.

---

## 5. Accessibility

### 5.1 Contrast of real tokens (WCAG 2.x, computed)

| Foreground / Background | Ratio | AA text | Use |
|---|---|---|---|
| `#4A0000` / `#FDECEC` | 14.24 | Pass | Headings on canvas |
| `#4A0000` / `#FFFFFF` | 16.26 | Pass | Card text |
| `#6B0505` / `#FDECEC` | 11.15 | Pass | Body on canvas |
| `#6B0505` / `#FFFFFF` | 12.73 | Pass | Secondary text on card |
| `#A41D2D` / `#FDECEC` | 6.58 | Pass | Links, eyebrows, secondary button text |
| `#A41D2D` / `#FFFFFF` | 7.52 | Pass | Same on cards |
| `#FFFFFF` / `#A41D2D` | 7.52 | Pass | Primary button |
| `#FFFFFF` / `#9B2B3A` | 7.50 | Pass | Burgundy panels |
| `#FFF9F5` / `#7C1526` | 10.10 | Pass | Deep CTA |
| `#FFC3DE` / `#9B2B3A` | 5.04 | Pass | Pink text on burgundy |
| `#8B1A28` / `#FCE7EC` | 7.81 | Pass | Light button on burgundy |
| `#EAD99A` / `#4A0000` | 11.53 | Pass | Butter on dark |
| `#FF8EBE` / `#4A0000` | 7.64 | Pass | Pink eyebrow on dark |
| `#D75B86` / `#4A0000` | 4.44 | **Fail** (12px) | Fucsia eyebrow on dark |
| `#D75B86` / `#FFFFFF` | 3.66 | Large/UI only | Fucsia icon, heading word |
| `#C98B95` / `#FFFFFF` | 2.76 | **Fail** | Panel numerals |
| `rgba(107,5,5,.55)` / `#FFF5F5` | 3.64 | **Fail** (12.5px) | Marquee |
| `rgba(255,255,255,.45)` / `#4A0000` | 3.94 | **Fail** (13.5px) | Footer copyright |
| `rgba(255,255,255,.60)` / `#A41D2D` | 3.56 | **Fail** (14.5px) | Contact note ("Respondo en el día") |
| `#D2B565` / `#FFFFFF` | 1.99 | Decorative only | Stars (need text alternative) |
| `rgba(164,29,45,.16–.32)` / light | 1.3–1.8 | **Fail** as control border | Chip/secondary button borders |
| globals `--muted-foreground` / `--background` | 5.77 | Pass | (unused today) |

Booking rules derived from this:
- Text: only `#4A0000`, `#6B0505`, `#A41D2D` on light; white, `#FFE6E6`, `#FFC3DE`, `#EAD99A`, `#FF8EBE` on dark. **Fucsia, `#C98B95`, butter-ink and alpha-white below .7 are decorative only.**
- Form controls need a ≥3:1 boundary: new token `control-border #A86B74` (3.66 on `#FDECEC`, 4.18 on white). Chips keep the brand look but selected state must differ by fill **and** a check icon/`aria-pressed`.
- Status colors must not be confused with the burgundy brand: danger `#B42318` (6.57 on white) always with icon + text; success `#1E6B3A` (5.71 on blush); warning `#8A5A00` (5.19 on blush).
- The landing failures above are **reported, not fixed** (out of scope).

### 5.2 Checklist

- [ ] Every interactive element reachable by Tab in visual order; no positive `tabindex`.
- [ ] Visible focus: reuse the landing rule `:focus-visible { outline:3px solid #A41D2D; outline-offset:3px }` (6.58:1 on blush); on dark surfaces use white outline.
- [ ] Skip link "Saltar al contenido" on booking and admin layouts.
- [ ] Day strip: `role="tablist"` or radio group with arrow-key navigation; `aria-selected`; days without sessions announced ("sin clases").
- [ ] Session card: whole card is not a link; one real `<button>` "Reservar" with `aria-describedby` → time, practice, spots.
- [ ] Sheet/dialog: `role="dialog"`, `aria-modal`, labelled by title, focus trapped, Esc closes, focus returns to the triggering button.
- [ ] Live regions: `aria-live="polite"` for "Reservando…", spot count changes, toasts; `role="alert"` for errors.
- [ ] Forms: visible `<label>` for every field, `autocomplete="email"`, `one-time-code`, `tel`, `name`; errors linked with `aria-describedby`; no placeholder-only labels.
- [ ] Touch targets ≥ 44×44px (landing already enforces 46–48px buttons on mobile).
- [ ] Text resizes to 200% without loss; layout works at 320px; no horizontal scroll.
- [ ] Dates/times in text, not only in icons; timezone stated.
- [ ] `prefers-reduced-motion`: no sheet slide (fade only), static skeletons, no lift on hover.
- [ ] `lang="es"` (already set in `app/layout.tsx`); admin `noindex`.
- [ ] Status never by color alone (full, past, cancelled, waitlist all have words).
- [ ] Session timeouts: warn before expiring the sign-in code; preserve the selected session.

---

## 6. `BookingTheme` token mapping

Apply the theme as CSS variables on a wrapper (`[data-booking-theme="bylou"]`) in the booking/admin layouts. This reuses the shadcn variable names already wired in `globals.css` `@theme inline` (so Tailwind utilities like `bg-primary` resolve correctly) **without changing `:root`**, so the landing is untouched.

| Theme role | CSS var (shadcn name) | `bylou` value | Source in `page.tsx` | `demo-studio` |
|---|---|---|---|---|
| `color.canvas` | `--background` | `#FFF8F8` | hero top / meditación bg (calmer than `#FDECEC` for a utility screen) | `#F6F5F2` |
| `color.text` | `--foreground` | `#4A0000` | ink | `#1F2A2E` |
| `color.surface` | `--card`, `--popover` | `#FFFFFF` | cards | `#FFFFFF` |
| `color.surfaceText` | `--card-foreground` | `#4A0000` | | `#1F2A2E` |
| `color.primary` | `--primary` | `#A41D2D` | burgundy | `#2F5D62` |
| `color.onPrimary` | `--primary-foreground` | `#FFFFFF` | | `#FFFFFF` |
| `color.primaryHover` | `--primary-hover` (new) | `#8B1A28` | | `#244A4E` |
| `color.subtle` | `--secondary` | `#FDECEC` | blush (chips, selected) | `#E9EEED` |
| `color.subtleText` | `--secondary-foreground` | `#A41D2D` | | `#2F5D62` |
| `color.muted` | `--muted` | `#FFF5F5` | blush-soft | `#EFEEEA` |
| `color.textSecondary` | `--muted-foreground` | `#6B0505` | ink-soft | `#5B6B70` |
| `color.highlight` | `--accent` | `#FCF7E8` | butter-wash | `#F1EFE9` |
| `color.highlightText` | `--accent-foreground` | `#4A0000` | | `#1F2A2E` |
| `color.border` | `--border` | `#F3DADA` | rose-border | `#E2E0DA` |
| `color.controlBorder` | `--input` | `#A86B74` (new) | derived, 3:1 | `#7C8A8E` |
| `color.focus` | `--ring` | `#A41D2D` | focus outline | `#2F5D62` |
| `color.danger` | `--destructive` | `#B42318` | new | `#B42318` |
| `color.success` | `--success` (new) | `#1E6B3A` | new | `#1E6B3A` |
| `color.warning` | `--warning` (new) | `#8A5A00` | new | `#8A5A00` |
| `color.inverseSurface` | `--inverse` (new) | `#4A0000` | dark panels/footer | `#1F2A2E` |
| `color.decorative` | `--accent-expressive` (new) | `#D75B86` | fucsia (non-text only) | — (none) |
| `font.display` | `--font-serif` | Playfair Display, italic emphasis on | `--font-playfair` | Inter 600, italic off |
| `font.body` | `--font-sans` | Geist via `var(--font-geist-sans)` | | Inter / system-ui |
| `radius.base` | `--radius` | `0.6875rem` (11px = `--r-md`; derived `sm` = 7px = `--r-sm`) | `--r-*` | `0.375rem` |
| `radius.button` | `--radius-button` (new) | `999px` (pill) | CTAs | `0.5rem` |
| `radius.card` | `--radius-card` (new) | `22px` | story/plan cards | `0.5rem` |
| `radius.media` | — | `280px 280px 30px 30px` arch (optional) | hero frame | `0.5rem` |
| `shadow.card` | `--shadow-card` (new) | `0 22px 50px -34px rgba(74,0,0,.5)` | plan card | `0 1px 2px rgba(16,24,40,.06)` |
| `shadow.raised` | `--shadow-raised` (new) | `0 30px 70px -34px rgba(74,0,0,.5)` | nav panel | `0 4px 12px rgba(16,24,40,.08)` |
| `motion.ease` | `--ease` (new) | `cubic-bezier(.22,.61,.36,1)` | `EASE` | `cubic-bezier(.2,0,0,1)` |
| `motion.duration` | `--dur` (new) | `240ms` | | `160ms` |
| `brand.name` / `logo` | — | "Yoga ByLou" / `assets/ginkgo.png` | | "Estudio Demo" / text wordmark |
| `brand.contact` | — | IG DM `ig.me/m/bylou.yoga` + email | | email only |
| `copy` / `terms` | — | §3 Bylou column | | §3 demo column, neutral "tú" register |

`bylou` on the proposed canvas `#FFF8F8` (computed): `#4A0000` 15.52 · `#6B0505` 12.15 · `#A41D2D` 7.18 · `#B42318` 6.27 · control border `#A86B74` 3.99.

`demo-studio` contrast (computed): `#2F5D62`/`#E9EEED` 6.26 · `#5B6B70`/`#EFEEEA` 4.78 · white/`#244A4E` 9.70 · `#1F2A2E`/`#F6F5F2` 13.48 · `#2F5D62`/`#F6F5F2` 6.73 · white/`#2F5D62` 7.34 · `#5B6B70`/`#F6F5F2` 5.09 · `#7C8A8E` control border/`#F6F5F2` 3.27. Deliberately opposite to Bylou on every axis (cool vs warm, sans vs serif, square vs pill, flat vs soft shadow, different vocabulary and register) so a broken decoupling is visible immediately.

---

## 7. Risks and assumptions

| # | Item | Impact |
|---|---|---|
| R1 | `globals.css` tokens are v0 defaults (`--primary` ≈ `#7F0327`, generic dark mode). Using them as "the Bylou theme" would be wrong. | Theme fidelity |
| R2 | `@theme` sets `--font-sans: "Geist"` literally, while `next/font` exposes Geist through `--font-geist-sans` with a generated family name. Body may fall back to system fonts. Verify computed font on live; booking should use `var(--font-geist-sans)`. | Typography fidelity |
| R3 | Landing styles (`body` bg, `:focus-visible`, skip-link, brand vars) live inside `page.tsx`; `/reservas` inherits none of them. | Must be re-declared in theme scope |
| R4 | Live site text matches repo (sections, prices, CTAs) as of 2026-10-13; computed styles were not verifiable via fetch. | Low |
| R5 | No WhatsApp exists; contact is IG DM + email. Notifications by WhatsApp would be a new channel. | Scope |
| R6 | 1:1 is "horario a medida" today; booking requires published slots. Group classes have no price/schedule yet. | Product decision for Lou |
| R7 | Presencial address is "a coordinar"; decide whether it is shown after booking or per session. | Copy / data |
| R8 | Waitlist promotion (auto-enroll vs. claim) is undecided (see `REFERENCE_ANALYSIS.md`); cancellation decided in ADR-011 (24 h, then blocked). Copy keys are rule-driven. | Copy, domain |
| R9 | Adding a 6th link to the desktop nav pill may overflow 1101–1280px. | Visual check needed |

Open questions for the owner (one at a time when raised): auto-promotion from waitlist; whether presencial address is public.
