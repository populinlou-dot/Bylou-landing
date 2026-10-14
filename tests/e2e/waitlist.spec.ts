import type { Page } from "@playwright/test"
import { STUDENT_EMAIL, expect, sessionCard, signIn, test, type BookingFixtures } from "./support/fixtures"

/**
 * Journey J (Phase 4.4): the waitlist and the required display name, against the mock data source.
 * Two demo students share one in-memory studio for the whole page load: the main demo student
 * (any email) and "nueva@…" (a pack, no name yet). Everything moves by in-app navigation.
 */

const NEW_STUDENT_EMAIL = "nueva@demo.test"
/** Mon 19 Oct 08:00 online 1:1, free in the seed and 5 days ahead: one booking makes it full. */
const NEXT_MONDAY_INDIVIDUAL = "demo-2026-10-19-0800-individual"
/** Sat 17 Oct 10:00 group class with free spots, 73 h ahead. */
const SATURDAY_GROUP = "demo-2026-10-17-1000-grupal"

type T = BookingFixtures["t"]

async function signOut(page: Page, t: T) {
  await page.getByRole("banner").getByRole("button", { name: t("auth.signOut"), exact: true }).click()
  await expect(page).toHaveURL(/\/reservas\/$/)
  await expect(page.getByRole("banner").getByRole("link", { name: t("auth.signIn") })).toBeVisible()
}

/** Header "Ingresar" → code → back on the agenda (default destination) once she has a name. */
async function signInFromHeader(page: Page, t: T, email: string, expectNameStep = false) {
  await page.getByRole("banner").getByRole("link", { name: t("auth.signIn") }).click()
  await signIn(page, t, email)
  if (expectNameStep) await expect(page.getByRole("heading", { level: 1, name: t("profile.title") })).toBeVisible()
  else await expect(page.getByRole("heading", { level: 1, name: t("agenda.title") })).toBeVisible()
}

async function openNextMondayIndividual(page: Page, t: T) {
  await page.getByRole("button", { name: t("agenda.nextWeek") }).click()
  await sessionCard(page, NEXT_MONDAY_INDIVIDUAL).getByRole("link", { name: "Clase individual" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Clase individual" })).toBeVisible()
}

test.describe("J · waitlist and required name (Phase 4.4)", () => {
  test("a student joins a full class, another one cancels, the first is moved in and sees it in Mis reservas", async ({ page, t }) => {
    // 1. "Nueva" books the free 1:1: the required name step comes first (no way to skip it).
    await page.goto(`/reservas/sesion/?id=${NEXT_MONDAY_INDIVIDUAL}`)
    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await signIn(page, t, NEW_STUDENT_EMAIL)
    await expect(page.getByRole("heading", { level: 1, name: t("profile.title") })).toBeVisible()
    await expect(page.getByRole("button", { name: "Ahora no" })).toHaveCount(0)
    await page.getByRole("button", { name: t("profile.save") }).click()
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(t("profile.error.empty"))
    await page.getByRole("textbox", { name: t("profile.label") }).fill("Nora")
    await page.getByRole("button", { name: t("profile.save") }).click()
    await page.getByRole("dialog", { name: "Clase individual" }).getByRole("button", { name: t("sheet.confirm") }).click()
    await expect(page.getByRole("dialog", { name: t("success.title") })).toBeVisible()
    await page.getByRole("dialog", { name: t("success.title") }).getByRole("button", { name: t("sheet.back") }).click()
    await expect(page.getByText(t("reason.already_booked"))).toBeVisible()
    await signOut(page, t)

    // 2. The main student finds it full and joins the waitlist (signing in on the way).
    await openNextMondayIndividual(page, t)
    await expect(page.getByText(t("reason.session_full"))).toBeVisible()
    await expect(page.getByRole("button", { name: t("session.cta"), exact: true })).toHaveCount(0)
    await expect(page.getByText(t("waitlist.rule", { h: 24 }))).toBeVisible()
    await page.getByRole("button", { name: t("waitlist.join") }).click()
    await signIn(page, t, STUDENT_EMAIL)
    await expect(page.getByRole("heading", { level: 1, name: "Clase individual" })).toBeVisible()
    await page.getByRole("button", { name: t("waitlist.join") }).click()
    await expect(page.getByRole("status").filter({ hasText: t("waitlist.joined", { n: 1 }) })).toBeVisible()
    await expect(page.getByRole("button", { name: t("waitlist.leave") })).toBeVisible()
    // Mis reservas lists the entry with her place.
    await page.getByRole("banner").getByRole("link", { name: t("mine.title") }).click()
    const waiting = page.getByRole("region", { name: t("mine.waitlist") })
    await expect(waiting.getByRole("article").getByText(t("waitlist.joined", { n: 1 }))).toBeVisible()
    await expect(page.getByRole("region", { name: t("pack.title") }).getByText(t("pack.available.many", { n: 7 }))).toBeVisible()
    await signOut(page, t)

    // 3. "Nueva" cancels more than 24 h ahead: the freed spot goes to the list in the same step.
    await signInFromHeader(page, t, NEW_STUDENT_EMAIL)
    await page.getByRole("banner").getByRole("link", { name: t("mine.title") }).click()
    await page.getByRole("region", { name: t("mine.upcoming") }).getByRole("button", { name: t("cancel.cta") }).click()
    await page.getByRole("dialog", { name: t("cancel.title") }).getByRole("button", { name: t("cancel.confirm") }).click()
    await expect(page.getByRole("status").filter({ hasText: t("cancel.done") })).toBeVisible()
    await signOut(page, t)

    // 4. Next time the main student opens the app, the class is hers (no notifications in the MVP).
    await signInFromHeader(page, t, STUDENT_EMAIL)
    await page.getByRole("banner").getByRole("link", { name: t("mine.title") }).click()
    const booking = page.getByRole("region", { name: t("mine.upcoming") }).getByRole("article").filter({ hasText: "Lunes 19 de octubre · 08:00" })
    await expect(booking.getByText(t("mine.confirmed"))).toBeVisible()
    await expect(booking.getByText(t("waitlist.promoted"))).toBeVisible()
    await expect(page.getByRole("region", { name: t("mine.waitlist") })).toHaveCount(0)
    await expect(page.getByRole("region", { name: t("pack.title") }).getByText(t("pack.available.many", { n: 6 }))).toBeVisible()
  })

  test("a signed-in student without a name is asked for it inside the confirm sheet", async ({ page, t }) => {
    await page.goto("/reservas/")
    await signInFromHeader(page, t, NEW_STUDENT_EMAIL, true)
    // She walks away from the step without a name …
    await page.getByRole("banner").getByRole("link", { name: t("mine.title") }).click()
    await page.getByRole("link", { name: t("mine.browse") }).click()
    // … and tries to book: the sheet asks for the name before the confirm button.
    await sessionCard(page, SATURDAY_GROUP).getByRole("button", { name: t("session.cta"), exact: true }).click()
    const sheet = page.getByRole("dialog", { name: "Clase grupal" })
    await expect(sheet.getByText(t("profile.required"))).toBeVisible()
    await expect(sheet.getByRole("button", { name: t("sheet.confirm") })).toHaveCount(0)
    await sheet.getByRole("textbox", { name: t("profile.label") }).fill("Nora")
    await sheet.getByRole("button", { name: t("profile.save") }).click()
    await sheet.getByRole("button", { name: t("sheet.confirm") }).click()
    await expect(page.getByRole("dialog", { name: t("success.title") })).toBeVisible()
  })
})
