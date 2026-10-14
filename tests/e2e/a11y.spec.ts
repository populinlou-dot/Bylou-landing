import AxeBuilder from "@axe-core/playwright"
import type { Page, TestInfo } from "@playwright/test"
import { SESSION, STAFF_EMAIL, STUDENT_EMAIL, expect, signIn, test } from "./support/fixtures"

/**
 * Accessibility (UX_DESIGN.md §5.2) on the main booking and admin screens, in the states people
 * actually see them (signed out, signed in, sheets open), on desktop, mobile and the demo-studio build.
 *
 * Per state:
 * - axe-core, WCAG 2.0/2.1/2.2 A + AA + best-practice rules: serious/critical violations fail the test;
 *   moderate/minor ones are attached to the report (accepted ones are listed in PROGRESS.md).
 *   axe reports text inside an open sheet as "incomplete" (the overlay hides the background); those
 *   token pairs are covered by brands/contrast.test.ts.
 * - the booking subtree carries the brand language (`lang`), since <html lang> belongs to the landing;
 * - every control is at least 44×44 px (radios/checkboxes through their label; links inside running
 *   text excepted);
 * - no message is announced twice by two live regions at once.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]
const MIN_TARGET = 44

interface Finding {
  state: string
  id: string
  impact: string
  help: string
  targets: string[]
}

interface Collected {
  blocking: Finding[]
  advisory: Finding[]
  smallTargets: string[]
  duplicateLive: string[]
  lang: string[]
}

const collected = (): Collected => ({ blocking: [], advisory: [], smallTargets: [], duplicateLive: [], lang: [] })

async function audit(page: Page, state: string, out: Collected, locale: string): Promise<void> {
  // Let entry states settle (skeleton → content, sheet mount) before measuring.
  await page.waitForTimeout(300)
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  for (const v of violations) {
    const finding: Finding = { state, id: v.id, impact: v.impact ?? "unknown", help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }
    if (v.impact === "serious" || v.impact === "critical") out.blocking.push(finding)
    else out.advisory.push(finding)
  }

  const probe = await page.evaluate((min) => {
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest(".sr-only")
    }
    const controls = document.querySelectorAll(
      "[data-booking-theme] :is(button, a[href], input:not([type=hidden]), select, textarea, [role=button])",
    )
    const small = [...controls]
      .filter(shown)
      .filter((el) => !(el.tagName === "A" && el.closest("p")))
      .map((el) => {
        const target = el.matches("input[type=radio], input[type=checkbox]") ? (el.closest("label") ?? el) : el
        const box = target.getBoundingClientRect()
        const sized = el.matches("input, select, textarea") ? box.height >= min : box.height >= min && box.width >= min
        const label = (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).name || "").trim().slice(0, 40)
        return sized ? null : `${el.tagName.toLowerCase()} "${label}" ${Math.round(box.width)}×${Math.round(box.height)}`
      })
      .filter((x): x is string => x !== null)
    const live = [...document.querySelectorAll("[aria-live], [role=status], [role=alert]")]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean)
    const duplicates = live.filter((text, i) => live.indexOf(text) !== i)
    const lang = document.querySelector("[data-booking-theme]")?.closest("[lang]")?.getAttribute("lang") ?? ""
    return { small, duplicates, lang }
  }, MIN_TARGET)

  out.smallTargets.push(...probe.small.map((s) => `${state}: ${s}`))
  out.duplicateLive.push(...probe.duplicates.map((s) => `${state}: ${s}`))
  if (probe.lang !== locale) out.lang.push(`${state}: lang="${probe.lang}"`)
}

async function report(testInfo: TestInfo, out: Collected): Promise<void> {
  if (out.advisory.length > 0) {
    await testInfo.attach("axe-moderate-minor", { body: JSON.stringify(out.advisory, null, 2), contentType: "application/json" })
  }
  expect(out.blocking, "no serious or critical axe violations").toEqual([])
  expect(out.lang, "the booking subtree carries the brand language").toEqual([])
  expect(out.smallTargets, `every control is at least ${MIN_TARGET}×${MIN_TARGET} px`).toEqual([])
  expect(out.duplicateLive, "no message is announced by two live regions").toEqual([])
}

test.describe("Accessibility (axe + UX_DESIGN §5.2)", () => {
  test("student screens: agenda, detail, sign-in, confirm sheet, my bookings, cancel sheet", { tag: "@white-label" }, async ({ page, t, brand }, testInfo) => {
    const out = collected()
    const check = (state: string) => audit(page, state, out, brand.locale)

    await page.goto("/reservas/")
    await expect(page.getByRole("heading", { level: 1, name: t("agenda.title") })).toBeVisible()
    await expect(page.getByRole("main").getByRole("article").first()).toBeVisible()
    await check("agenda")

    await page.goto(`/reservas/sesion/?id=${SESSION.saturdayGroup}`)
    await expect(page.getByRole("heading", { level: 1, name: "Clase grupal" })).toBeVisible()
    await check("session-detail")

    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await expect(page.getByRole("textbox", { name: t("auth.email.label") })).toBeVisible()
    await check("sign-in-email")
    await page.getByRole("textbox", { name: t("auth.email.label") }).fill(STUDENT_EMAIL)
    await page.getByRole("button", { name: t("auth.email.submit") }).click()
    await expect(page.getByRole("textbox", { name: t("auth.code.label") })).toBeVisible()
    await check("sign-in-code")
    await page.getByRole("textbox", { name: t("auth.code.label") }).fill("123456")
    await page.getByRole("button", { name: t("auth.code.submit"), exact: true }).click()

    const sheet = page.getByRole("dialog", { name: "Clase grupal" })
    await expect(sheet.getByRole("button", { name: t("sheet.confirm") })).toBeVisible()
    await check("confirm-sheet")
    await sheet.getByRole("button", { name: t("sheet.confirm") }).click()
    const success = page.getByRole("dialog", { name: t("success.title") })
    await expect(success).toBeVisible()
    await check("confirm-success")
    await success.getByRole("link", { name: t("success.mine") }).click()

    await expect(page.getByRole("heading", { level: 1, name: t("mine.title") })).toBeVisible()
    await expect(page.getByRole("region", { name: t("mine.upcoming") }).getByRole("article")).toHaveCount(1)
    await check("my-bookings")
    await page.getByRole("region", { name: t("mine.upcoming") }).getByRole("button", { name: t("cancel.cta") }).click()
    await expect(page.getByRole("dialog", { name: t("cancel.title") })).toBeVisible()
    await check("cancel-sheet")

    await report(testInfo, out)
  })

  test("admin screens: guard, day, roster, class types, new class, students, student detail and sheets", { tag: "@white-label" }, async ({ page, t, brand }, testInfo) => {
    const out = collected()
    const check = (state: string) => audit(page, state, out, brand.locale)

    await page.goto("/admin/")
    await expect(page.getByRole("heading", { level: 1, name: t("admin.guard.signIn") })).toBeVisible()
    await check("admin-guard")
    await page.getByRole("main").getByRole("link", { name: t("auth.signIn") }).click()
    await signIn(page, t, STAFF_EMAIL)

    const today = page.getByRole("region", { name: t("admin.day.todayTitle", { date: "Miércoles 14 de octubre" }) })
    await expect(today.getByRole("article")).toHaveCount(2)
    await check("admin-day")

    await today.getByRole("article").first().getByRole("link", { name: t("admin.session.open") }).click()
    await expect(page.getByRole("region", { name: t("admin.roster.title") })).toBeVisible()
    await check("admin-roster")

    await page.getByRole("link", { name: t("admin.nav.classTypes") }).click()
    await expect(page.getByRole("heading", { level: 1, name: t("admin.nav.classTypes") })).toBeVisible()
    await check("admin-class-types")

    await page.getByRole("link", { name: t("admin.nav.today") }).click()
    await page.getByRole("link", { name: t("admin.day.newSession") }).click()
    await expect(page.getByRole("region", { name: t("admin.newSession.title") })).toBeVisible()
    await check("admin-new-session")

    await page.getByRole("link", { name: t("admin.nav.students") }).click()
    await expect(page.getByRole("heading", { level: 1, name: t("admin.students.title") })).toBeVisible()
    await expect(page.getByRole("main").getByRole("link").first()).toBeVisible()
    await check("admin-students")

    await page.getByRole("main").getByRole("link", { name: /^Ana \(demo\)/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Ana (demo)" })).toBeVisible()
    await check("admin-student")

    const grant = page.getByRole("button", { name: t("admin.grant.cta") })
    await grant.click()
    await expect(page.getByRole("dialog", { name: t("admin.grant.title") })).toBeVisible()
    await check("admin-grant-sheet")
    // Focus stays inside the open sheet and returns to its trigger on Escape.
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab")
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(grant).toBeFocused()

    // The demo student without a name is listed by her email, so her erasure can be confirmed.
    await page.getByRole("link", { name: t("admin.student.back") }).click()
    await page.getByRole("main").getByRole("link", { name: /^alumna4@demo\.test/ }).click()
    await page.getByRole("button", { name: t("admin.erase.cta") }).click()
    const erase = page.getByRole("dialog", { name: t("admin.erase.title", { name: "alumna4@demo.test" }) })
    await expect(erase).toBeVisible()
    await erase.getByRole("button", { name: t("admin.erase.confirm") }).click()
    const confirmField = erase.getByRole("textbox", { name: t("admin.erase.email") })
    await expect(confirmField).toHaveAttribute("aria-invalid", "true")
    await expect(confirmField).toBeFocused()
    await check("admin-erase-sheet-error")

    await report(testInfo, out)
  })
})
