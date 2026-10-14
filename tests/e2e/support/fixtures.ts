import { test as base, expect, type Page } from "@playwright/test"
import type { CopyKey } from "../../../booking/config"
import type { BrandConfig } from "../../../booking/theme"
import { BRANDS, type BrandId } from "../../../brands"

/**
 * Shared Playwright fixtures for the booking E2E journeys.
 *
 * - `brandId` (project option) selects the brand the served build was compiled with. Every
 *   label/role name comes from that brand's copy (`t`), so one journey runs under any brand.
 * - The browser clock is pinned (`fixedNow`), so the mock demo week, ids and occupancy are
 *   deterministic. Timers keep running, so the mock's simulated latency still resolves.
 * - Requests leaving the local static server are answered with an empty 200, so the run is
 *   hermetic (Google Fonts, analytics) and never reaches a hosted service.
 * - Any console error or uncaught page error fails the test (includes hydration mismatches).
 */
export interface BookingOptions {
  brandId: BrandId
  /** ISO instant the page clock is pinned to; null keeps the real clock (Supabase runs). */
  fixedNow: string | null
}

export interface BookingFixtures {
  brand: BrandConfig
  /** Brand message with `{placeholders}` filled in. */
  t: (key: CopyKey, vars?: Record<string, string | number>) => string
  consoleErrors: string[]
}

/** Wednesday 2026-10-14 09:00 in Buenos Aires: the mock demo week is Mon 12 → Sun 18 October. */
export const FIXED_NOW = "2026-10-14T12:00:00.000Z"
export const DEMO_CODE = "123456"
export const STUDENT_EMAIL = "ana.e2e@demo.test"
export const STAFF_EMAIL = "staff@demo.test"

/** Mock seed ids for the pinned week (booking/infrastructure/mock/demo-seed.ts). */
export const SESSION = {
  /** Mon 12 19:00, in-person group: already finished. */
  pastGroup: "demo-2026-10-12-1900-grupal",
  /** Tue 13 10:00, 1:1 with one booking: finished yesterday, attendance can be marked. */
  yesterdayIndividual: "demo-2026-10-13-1000-individual",
  /** Wed 14 19:00, online group, 6 spots left: starts in 10 h (inside the 24 h window). */
  todayGroup: "demo-2026-10-14-1900-grupal",
  /** Wed 14 21:30, 1:1 already taken: full. */
  fullIndividual: "demo-2026-10-14-2130-individual",
  /** Fri 16 18:00 meditation cancelled by the studio. */
  cancelledMeditation: "demo-2026-10-16-1800-meditacion",
  /** Sat 17 10:00, in-person group, 5 spots left: 73 h away (outside the 24 h window). */
  saturdayGroup: "demo-2026-10-17-1000-grupal",
} as const

const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//

export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}

export const test = base.extend<BookingFixtures & BookingOptions>({
  brandId: ["bylou", { option: true }],
  fixedNow: [FIXED_NOW, { option: true }],
  brand: async ({ brandId }, use) => {
    await use(BRANDS[brandId])
  },
  t: async ({ brand }, use) => {
    await use((key, vars) => fill(brand.copy[key], vars))
  },
  consoleErrors: async ({}, use) => {
    await use([])
  },
  page: async ({ page, fixedNow, consoleErrors }, use) => {
    if (fixedNow) await page.clock.setFixedTime(new Date(fixedNow))
    await page.route(
      (url) => !LOCAL_ORIGIN.test(url.toString()),
      (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "" }),
    )
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`console.error: ${message.text()}`)
    })
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`))
    await use(page)
    expect(consoleErrors, "no console errors or uncaught exceptions (incl. hydration mismatches)").toEqual([])
  },
})

export { expect }

/** Completes the email → code flow on the sign-in page (mock: the demo code is shown on screen). */
export async function signIn(page: Page, t: BookingFixtures["t"], email: string, code = DEMO_CODE): Promise<void> {
  await page.getByRole("textbox", { name: t("auth.email.label") }).fill(email)
  await page.getByRole("button", { name: t("auth.email.submit") }).click()
  await page.getByRole("textbox", { name: t("auth.code.label") }).fill(code)
  await page.getByRole("button", { name: t("auth.code.submit"), exact: true }).click()
}

/** Agenda card for one session (cards are articles named after the class type). */
export function sessionCard(page: Page, sessionId: string) {
  return page.getByRole("article").filter({ has: page.locator(`a[href$="?id=${sessionId}"]`) })
}
