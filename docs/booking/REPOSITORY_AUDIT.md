# Repository Audit — Bylou Landing (booking initiative, Phase 0)

- Branch audited: `feature/booking-core` (base `origin/main` @ `b2d2535`)
- Date: 2026-10-13
- Scope: read-only inspection + baseline `lint` / `tsc` / `build`. No source file was modified.

## TL;DR

| # | Finding | Severity |
|---|---|---|
| 1 | Untracked `pnpm-workspace.yaml` (no `packages:` field) **breaks CI**: workflow pins pnpm 9, which aborts with `packages field missing or empty` (reproduced locally). Must not be committed as-is. | **Blocker** |
| 2 | Brand design tokens live in an inline `<style>` inside the landing client page (`app/page.tsx:691-738`), not in `app/globals.css`. A new `/reservas` route will **not** inherit them. | High |
| 3 | `pnpm lint` is broken pre-existing: `eslint` is not installed and no ESLint config exists. | Medium |
| 4 | Local `pnpm build` without env uses basePath `/Bylou-landing`; CI correctly sets `""`. Local output differs from production. | Medium |
| 5 | `output: "export"` → no SSR, middleware/proxy, server actions, runtime route handlers, rewrites/redirects. Booking must be a client-side app over static shells + Supabase. | Design constraint |
| 6 | No tests, no sitemap/robots, no JSON-LD, no OG metadata. `apple-icon.png` is referenced but missing. | Low |

## 1. Stack & tooling

| Item | Value | Evidence |
|---|---|---|
| Framework | Next.js **16.0.10** (Turbopack build), App Router | `package.json` deps; `pnpm-lock.yaml:801` |
| React | 19.2.0 | `package.json` |
| Language | TypeScript 5.9.3 (`strict: true`, `moduleResolution: bundler`, `target: ES6`) | `tsconfig.json`; `pnpm-lock.yaml:931` |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`, resolved 4.3.0), `tw-animate-css` | `postcss.config.mjs`, `app/globals.css:1-2` |
| Path alias | `@/*` → `./*` | `tsconfig.json` `paths` |
| shadcn | `components.json`: style `new-york`, `rsc: true`, baseColor `neutral`, CSS vars, aliases `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`, icons `lucide` | `components.json` |
| `components/ui/` | **Does not exist** (README claims it does). Only `components/theme-provider.tsx` (unused) | `fd` listing |
| `lib/utils.ts` | `cn()` (clsx + tailwind-merge), currently unused | `lib/utils.ts:4` |
| Package manager | Local pnpm **11.20.0** (`node_modules/.modules.yaml:223`); CI pnpm **9** (`.github/workflows/main.yml:32`); no `packageManager` / `engines` field | — |
| Node | Local v25.2.1; CI Node 20 (`main.yml:27`) | — |
| Scripts | `dev`, `build` (`next build`), `lint` (`eslint .`), `start` (useless with export) | `package.json` |
| Tests | **None** (no runner, no test files, no config) | — |
| Lint | **Not configured**: no `eslint` dependency, no `eslint.config.*` | `node_modules/.bin` has only `next`, `tsc` |
| Env vars | Only `NEXT_PUBLIC_BASE_PATH`; no `.env*` files present; `.env`, `.env*.local` gitignored | `next.config.mjs:2-4`, `.gitignore` |
| Routes today | `/` (+ `/_not-found`, `/icon.png`) | build output |

### Dependencies status

| Dependency | Used? |
|---|---|
| `@radix-ui/react-accordion`, `react-dialog`, `react-slot` | No (no `components/ui`) |
| `lucide-react`, `class-variance-authority`, `tailwindcss-animate` | No |
| `next-themes` | Only in unused `components/theme-provider.tsx` |
| `@vercel/analytics` | Conditionally `require`d only on Vercel (`app/layout.tsx:8-16`); never loads on Pages |
| `clsx`, `tailwind-merge` | Only via unused `cn()` |

Implication: shadcn primitives are installable for booking (aliases ready), but nothing reusable exists yet.

## 2. Build, deploy & domain

### `next.config.mjs`

| Setting | Value | Line |
|---|---|---|
| `basePath` | `NEXT_PUBLIC_BASE_PATH ?? (NODE_ENV==="production" ? "/Bylou-landing" : "")` | 2-4 |
| `output` | `"export"` | 7 |
| `trailingSlash` | `true` (routes emitted as `folder/index.html`) | 8 |
| `assetPrefix` | `${basePath}/` when basePath non-empty | 14 |
| `images.unoptimized` | `true` | 17 |
| `env.NEXT_PUBLIC_BASE_PATH` | re-exported to client | 21-22 |

### `.github/workflows/main.yml`

| Step | Detail | Line |
|---|---|---|
| Trigger | push to `main` + `workflow_dispatch` (no PR builds) | 4-6 |
| Node / pnpm | Node 20, `pnpm/action-setup@v4` `version: 9` | 27, 32 |
| Install | `pnpm install --frozen-lockfile \|\| pnpm install` (fallback silently hides lockfile drift) | 51 |
| Build | `pnpm run build` with `NODE_ENV=production`, `NEXT_PUBLIC_BASE_PATH: ""` | 53-58 |
| Post | verifies `out/`, `touch out/.nojekyll` | 60-73 |
| Deploy | `upload-pages-artifact@v4` (`./out`) → `configure-pages@v5` → `deploy-pages@v4` | 76-92 |

### Domain vs basePath

| Check | Result |
|---|---|
| `public/CNAME` | `www.bylou.com.ar` → copied to `out/CNAME` |
| CI basePath | `""` (correct for custom domain; `??` keeps empty string) |
| Live site (curl) | `https://www.bylou.com.ar/` → 200, `server: GitHub.com`, assets at `/_next/...` (no prefix). Apex `bylou.com.ar` → 301 to `www`. |
| Mismatch? | **None in CI.** Footgun only locally: plain `pnpm build` emits `/Bylou-landing/...` URLs (verified: 104 prefixed refs in `out/index.html`); `NEXT_PUBLIC_BASE_PATH="" pnpm build` emits 0. |
| Hard-coded basePath usages | `app/layout.tsx:34`, `app/page.tsx:6-7` (`A()` helper for raw `<img>/<video>` src). `next/link` and `next/router` apply basePath automatically; raw `<a>/<img>` do not. |

## 3. Current UI & design tokens

### Fonts (`app/layout.tsx`)

| Font | Loader | CSS var / usage | Line |
|---|---|---|---|
| Geist | `next/font/google` | `--font-geist-sans`; `@theme --font-sans: "Geist"` | 18-21; `globals.css:78` |
| Geist Mono | `next/font/google` | `--font-geist-mono` | 23-26 |
| Playfair Display | `next/font/google` **and** a duplicate Google Fonts `<link>` (400/500/600) | `--font-playfair` → `@theme --font-serif`; `.font-heading-playfair`; inline `'Playfair Display'` in page | 28-31, 59-63; `globals.css:81,130-133` |

### Brand tokens a booking theme must reuse

Source: inline `<style>` in `app/page.tsx:691-738` (scoped to the landing page only) + hex literals used across `app/page.tsx`.

| Role | Token / value | Notes |
|---|---|---|
| Brand burgundy (primary/CTA) | `--burgundy-primary: #A41D2D` | most used color (58×); links, CTAs, `::selection` (`page.tsx:693-695`) |
| Burgundy hover | `#8B1A28` | `a:hover` (`page.tsx:694`) |
| Burgundy surface | `--burgundy-surface: #9B2B3A` | large surfaces |
| Ink (headings/body) | `#4A0000` | body text color (`page.tsx:692`) |
| Ink secondary | `#6B0505` | paragraphs |
| Page background | `#FDECEC` | body bg (`page.tsx:692`) |
| Soft surfaces | `#FFF5F5`, `#FFF8F8`, `#F3DADA` (borders) | alternating sections |
| Muted label | `#C98B95` | numbering |
| Butter accents | `--butter #EAD99A`, `--butter-ink #D2B565`, `--butter-soft #F7EFD5`, `--butter-wash #FCF7E8` | `page.tsx:707-711` |
| Fuchsia accent | `--fucsia: #D75B86`; pinks `#FF8EBE`, `#FFC3DE` | `page.tsx:713` |
| Radii | `--r-sm 7px` (tags), `--r-md 11px` (buttons), `--r-lg 18px` (photos), `--r-xl 40px` (26px ≤900px); pills `99px` (36×) | `page.tsx:717-720, 746` |
| Vertical rhythm | `--sp-xl 84`, `--sp-lg 66`, `--sp-md 50`, `--sp-sm 38` px (56/46/36/28 ≤900px) | `page.tsx:724-727, 742-745` |
| Content widths | `--content-narrow 1080px`, `--content-max 1240px`, `--content-wide 1380px` | `page.tsx:730-732` |
| Easing | `cubic-bezier(.22,.61,.36,1)` | `page.tsx:12` |
| Breakpoints | 380, 640, 760, 900, 1100/1101 px; `max-height: 820px` | `page.tsx:740-969` |

### shadcn tokens in `app/globals.css` (global, loaded on every route)

| Token | Light value | Line |
|---|---|---|
| `--background` | `oklch(0.985 0.01 40)` (warm off-white, ≠ landing `#FDECEC`) | 7 |
| `--foreground` | `oklch(0.25 0.02 20)` | 8 |
| `--primary` / `--ring` | `oklch(0.38 0.15 15)` (dark burgundy, close to `#A41D2D` family) | 13, 25 |
| `--secondary` / `--accent` / `--muted` | `oklch(0.97/0.96 0.01 40)` | 15-20 |
| `--border` / `--input` | `oklch(0.9 0.01 40)` | 23-24 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | 21 |
| `--radius` | `0.625rem` (10px) → `--radius-sm/md/lg/xl` | 31, 106-109 |
| `.dark` block | present, but no dark mode is wired (next-themes unused) | 42-75 |

Gap: shadcn tokens and landing brand tokens are two unrelated systems. A booking theme should map brand values onto shadcn semantic tokens (scoped), not invent new colors.

### SEO, a11y, assets

| Area | Status | Evidence |
|---|---|---|
| Metadata | `title`, `description`, `generator: "v0.app"`, icons; no `metadataBase`, OG/Twitter, canonical | `app/layout.tsx:36-45` |
| Icons | `app/icon.png` (convention) + manual `<link>` duplicates; `apple-icon.png` referenced but **missing** (404) | `layout.tsx:43,56-57` |
| JSON-LD | None | — |
| sitemap / robots | None (live `robots.txt` → 404) | — |
| `lang` | `es` | `layout.tsx:53` |
| A11y patterns | skip link (`page.tsx:839-844, 987`), `aria-expanded/controls` nav (`1028-1030, 1071-1073`), `aria-modal` drawer (`1094`), `prefers-reduced-motion` (`349, 976`) | — |
| Images | raw `<img>` with basePath helper; no `next/image` | `page.tsx:7` |
| Assets | `public/assets/*` (jpg/png + 6 mp4, largest 16 MB `video-6.mp4`), `public/images/design-mode/*` | — |
| Landing page | single 1810-line `"use client"` component | `app/page.tsx:1` |

## 4. Baseline checks (2026-10-13, local)

| Command | Result |
|---|---|
| `pnpm lint` | **FAIL** — `sh: eslint: command not found` (pre-existing) |
| `pnpm exec tsc --noEmit` | **PASS** (exit 0) |
| `pnpm build` (no env) | **PASS** — routes `/`, `/_not-found`, `/icon.png`; output uses `/Bylou-landing` prefix |
| `NEXT_PUBLIC_BASE_PATH="" pnpm build` (CI-equivalent) | **PASS** — no prefix; emits `out/index.html`, `out/404.html`, `out/404/index.html`, `out/CNAME` |
| `out/` gitignored? | Yes (`.gitignore:13` `/out/`); `.next/` and `next-env.d.ts` also ignored |
| `npx pnpm@9 install` with current `pnpm-workspace.yaml` | **FAIL** — `ERROR packages field missing or empty` (same for `--frozen-lockfile` fallback); passes without the file |

## 5. `output: "export"` constraints for booking

| Feature | Supported? | Booking implication |
|---|---|---|
| Static routes (`app/reservas/page.tsx`) | Yes | Emitted as `reservas/index.html` |
| Dynamic segments `[id]` | Only with `generateStaticParams` at build time | Runtime IDs (classes, bookings) → **query params** (`/reservas/clase/?id=…`) or client state, not path segments |
| `useSearchParams` | Yes, client-only; must be inside `<Suspense>` or build fails | Wrap query-param readers |
| Middleware / `proxy` | No | Auth guards are client-side UX only; security = Supabase RLS |
| Route handlers | Only `GET` with static output | No API in repo; use Supabase RPC / Edge Functions |
| Server Actions, `cookies()`, `headers()`, ISR, SSR | No | Data fetching in the browser |
| `next.config` redirects/rewrites/headers | No | No CSP/security headers via config (Pages can't set headers either; `<meta http-equiv>` only) |
| `next/image` optimization | No (`unoptimized`) | Plain images / pre-sized assets |
| `metadata` export | Yes, from server components | Booking pages: server `page.tsx` exports metadata + renders a client component |

## 6. Static hosting (GitHub Pages) limits

| Topic | Behavior | Recommendation |
|---|---|---|
| Deep links / refresh | `/reservas/` serves `reservas/index.html`; `/reservas` → Pages 301 to slash version | Works for every prerendered route. Keep `trailingSlash: true`. |
| Unknown paths | Pages serves `out/404.html` with **HTTP 404** | Avoid SPA "404 redirect" hacks (404 status, SEO noise, flicker). Use only prerendered paths + query params. |
| Supabase auth callback | No server to exchange codes | Browser PKCE: prerendered `/reservas/auth/callback/` page; `supabase-js` exchanges `?code=` client-side. Allowlist exact URLs **with trailing slash** for prod + `http://localhost:3000`. |
| Magic link + PKCE | Code verifier lives in the requesting browser's storage → link opened on another device/browser fails | Prefer email **OTP code** (6 digits) or accept same-browser constraint; Google OAuth optional. |
| Secrets | Everything in `out/` and `NEXT_PUBLIC_*` is public | Only Supabase URL + anon/publishable key in frontend; enforce RLS + RPC for writes. |
| Admin route | Static HTML is downloadable by anyone | Treat as UI shell; authorize every query via RLS/role claims; add `robots: noindex`. |
| Preview environments | One Pages site per repo; deploy only on `main`; no per-PR previews | Add a CI job that builds (and later tests) on PRs without deploying; optional external preview host is a separate decision. |
| Build-time env in CI | Only `NEXT_PUBLIC_BASE_PATH` set today | Supabase public vars must be added to the Build step `env` (repo variables, not secrets-in-code). |

## 7. Testing tooling recommendation (not installed)

| Layer | Tool | Why |
|---|---|---|
| Domain (pure TS: slots, capacity, cancellation rules, theme config) | **Vitest** | Fast, ESM/TS native, no Next coupling |
| Components | Vitest + `@testing-library/react` + `jsdom` | Client components only (matches export model) |
| DB / RLS | Supabase CLI local + SQL tests (pgTAP) or Vitest against local stack | Security lives in RLS, so test it there |
| E2E | **Playwright** against `npx serve out` (static) | Validates real deep-link/refresh/trailing-slash behavior |
| Lint | Add `eslint` + `eslint-config-next` flat config (or change script) | Fix pre-existing broken `pnpm lint` in its own commit |

## Minimal integration plan

1. **Unblock tooling (separate commits, before booking code):** decide `pnpm-workspace.yaml` fate (do not commit; or add `packageManager` + bump CI pnpm to match, keeping `allowBuilds`); fix lint (install ESLint or drop script). Do not touch the landing.
2. **Route placement:** `app/reservas/` (public agenda) and `app/reservas/admin/` (admin shell), each with a server `page.tsx` exporting `metadata` and a client component child. Optional `app/reservas/layout.tsx` for booking chrome; the root layout (fonts, `lang`) is shared and unchanged.
3. **Theme:** create a booking-scoped theme (e.g. `.booking-theme` wrapper or a CSS file imported by `app/reservas/layout.tsx`) that maps the brand tokens in §3 onto shadcn semantic vars. Do not move the landing's inline tokens yet (avoid touching `app/page.tsx`).
4. **Code location:** domain logic in a framework-free folder (e.g. `features/booking/domain`), Supabase adapters behind ports, UI under `features/booking/ui` or `components/booking` (shadcn `components/ui` for primitives).
5. **IDs in URLs:** query params only (`?id=`), read via `useSearchParams` inside `<Suspense>`.
6. **Links/assets:** use `next/link` for internal navigation (basePath-safe); raw asset URLs via a shared basePath helper.
7. **Auth:** Supabase browser client, PKCE/OTP, static callback page under `/reservas/auth/callback/`.
8. **CI:** add Supabase public vars to Build `env`; add a PR build/test job (no deploy). Keep current deploy job unchanged.
9. **SEO:** `/reservas/` indexable with own metadata; `/reservas/admin/` and callback `noindex`. Add sitemap/robots later as a separate small change.
10. **Verify each slice:** `NEXT_PUBLIC_BASE_PATH="" pnpm build`, then serve `out/` and test refresh on `/`, `/reservas/`, `/reservas/admin/`.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Committing `pnpm-workspace.yaml` (pnpm 11 format) while CI uses pnpm 9 | Deploy pipeline fails; site stops updating | Keep it out of booking commits, or align pnpm versions in one dedicated commit |
| `pnpm install --frozen-lockfile \|\| pnpm install` fallback | Lockfile drift silently tolerated in prod builds | Remove fallback once versions are aligned |
| Locally modified `pnpm-lock.yaml` (pnpm 11 `libc` fields) | Noisy diffs / version churn | Exclude from booking commits (already tracked in `PROGRESS.md`) |
| Local builds default to `/Bylou-landing` | Broken local preview of `out/`; wrong URLs if hand-uploaded | Always build with `NEXT_PUBLIC_BASE_PATH=""`; consider changing default in a separate change |
| Brand tokens trapped in landing inline `<style>` | Booking visual drift / token duplication | Booking-scoped theme now; later extract shared tokens |
| Root `globals.css` `body` bg differs from landing (`#FDECEC` set inline only on `/`) | Booking pages look off-brand by default | Set background in booking layout/theme |
| No server for auth/authorization | Admin UI exposed as static file | RLS + role checks server-side (Postgres); never trust client guards |
| Magic link cross-device failure with PKCE | Students cannot log in from email on another device | Prefer OTP codes |
| No PR previews / no tests / broken lint | Regressions reach production on merge | Add PR build job + Vitest early; Playwright on static `out/` |
| Root layout duplicate font loading + missing `apple-icon.png` | Minor perf/404 noise (pre-existing) | Out of booking scope; log as follow-up |
| Next 16 + Node 20 in CI vs Node 25 locally | Environment skew | Pin Node (e.g. `.nvmrc` / `engines`) in a tooling commit |
