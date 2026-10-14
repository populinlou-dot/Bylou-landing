import { SESSION, STAFF_EMAIL, STUDENT_EMAIL, expect, signIn, test } from "./support/fixtures"

/**
 * Admin journeys against the mock data source: E a student is kept out of /admin, F staff
 * publishes a class, reviews rosters, records attendance and grants a pack (AD-03/06/07/08).
 */

test.describe("E · access control", () => {
  test("a student who opens /admin sees 'Sin acceso'", { tag: "@white-label" }, async ({ page, t }) => {
    await page.goto("/admin/")
    await expect(page.getByRole("heading", { level: 1, name: t("admin.guard.signIn") })).toBeVisible()
    await page.getByRole("main").getByRole("link", { name: t("auth.signIn") }).click()
    await signIn(page, t, STUDENT_EMAIL)

    await expect(page).toHaveURL(/\/admin\/$/)
    const denied = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: t("admin.guard.forbidden.title") }) })
    await expect(denied).toBeVisible()
    await expect(denied.getByText(t("admin.guard.forbidden.body"))).toBeVisible()
    await expect(denied.getByRole("link", { name: t("admin.guard.toAgenda") })).toHaveAttribute("href", "/reservas/")
    await expect(page.getByRole("link", { name: t("admin.day.newSession") })).toHaveCount(0)
  })
})

test.describe("F · staff runs the day", () => {
  test("publishes a class, reviews rosters, marks attendance and grants a pack", { tag: "@white-label" }, async ({ page, t }) => {
    await page.goto("/admin/")
    await expect(page.getByText(t("admin.demoHint", { email: STAFF_EMAIL }))).toBeVisible()
    await page.getByRole("main").getByRole("link", { name: t("auth.signIn") }).click()
    await signIn(page, t, STAFF_EMAIL)

    const today = page.getByRole("region", { name: t("admin.day.todayTitle", { date: "Miércoles 14 de octubre" }) })
    await expect(today.getByRole("heading", { level: 1 })).toBeVisible()
    await expect(today.getByRole("article")).toHaveCount(2)

    // Publish a one-off class today at 17:30.
    await today.getByRole("link", { name: t("admin.day.newSession") }).click()
    const form = page.getByRole("region", { name: t("admin.newSession.title") })
    await form.getByRole("combobox", { name: t("admin.newSession.classType") }).selectOption({ label: "Clase grupal" })
    await expect(form.getByRole("textbox", { name: t("admin.newSession.date") })).toHaveValue("2026-10-14")
    await form.getByLabel(t("admin.newSession.time"), { exact: true }).fill("17:30")
    await form.getByRole("radio", { name: t("admin.modality.in_person") }).check()
    await form.getByRole("textbox", { name: t("admin.newSession.address"), exact: true }).fill("Estudio E2E 123")
    await form.getByRole("button", { name: t("admin.newSession.submit.one") }).click()

    const done = page.getByRole("status").filter({ has: page.getByRole("heading", { name: t("admin.newSession.success.one") }) })
    await expect(done).toBeVisible()
    await done.getByRole("link", { name: t("admin.newSession.viewDay") }).click()

    // The new class shows up in the day, empty.
    const created = page.getByRole("article", { name: /^17:30 ?, Clase grupal$/ })
    await expect(created).toBeVisible()
    await expect(created.getByText(t("admin.session.occupancyLabel", { n: 0, capacity: 8 }))).toBeAttached()
    await created.getByRole("link", { name: t("admin.session.open") }).click()
    const roster = page.getByRole("region", { name: t("admin.roster.title") })
    await expect(roster.getByText(t("admin.roster.empty"))).toBeVisible()
    await page.getByRole("link", { name: t("admin.session.back") }).click()

    // Yesterday's 1:1 already happened: record attendance.
    await page.getByRole("link", { name: t("admin.day.prev") }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Martes 13 de octubre" })).toBeVisible()
    await page.getByRole("article", { name: /^10:00 ?, Clase individual$/ }).getByRole("link", { name: t("admin.session.open") }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/clase/\\?id=${SESSION.yesterdayIndividual}$`))
    const attendance = page.getByRole("group", { name: t("admin.attendance.legend", { name: "Ana (demo)" }) })
    await attendance.getByRole("button", { name: t("admin.attendance.attended") }).click()
    await expect(page.getByRole("status").filter({ hasText: t("admin.attendance.saved") })).toBeVisible()
    await expect(attendance.getByRole("button", { name: t("admin.attendance.attended") })).toHaveAttribute("aria-pressed", "true")

    // Grant a pack to a student with no credits.
    await page.getByRole("link", { name: t("admin.nav.students") }).click()
    await expect(page.getByRole("heading", { level: 1, name: t("admin.students.title") })).toBeVisible()
    await page.getByRole("link", { name: /^Ana \(demo\)/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Ana (demo)" })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: t("admin.student.balance.none") })).toBeVisible()
    await page.getByRole("button", { name: t("admin.grant.cta") }).click()
    const sheet = page.getByRole("dialog", { name: t("admin.grant.title") })
    await expect(sheet.getByRole("spinbutton", { name: t("admin.grant.credits") })).toHaveValue("4")
    await sheet.getByRole("button", { name: t("admin.grant.submit") }).click()

    await expect(page.getByRole("status").filter({ hasText: t("admin.grant.done", { n: 4, date: "12 de noviembre" }) })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: t("admin.student.balance.many", { n: 4 }) })).toBeVisible()
  })
})

test.describe("I · account erasure (ADR-020)", () => {
  test("staff cancels her upcoming bookings, then erases her personal data behind the typed email", { tag: "@white-label" }, async ({ page, t }) => {
    await page.goto("/admin/")
    await page.getByRole("main").getByRole("link", { name: t("auth.signIn") }).click()
    await signIn(page, t, STAFF_EMAIL)
    await page.getByRole("link", { name: t("admin.nav.students") }).click()
    // The demo student without a name is listed (and confirmed) by her email.
    const email = "alumna4@demo.test"
    await page.getByRole("main").getByRole("link", { name: new RegExp(`^${email.replace(/\./g, "\\.")}`) }).click()
    await expect(page.getByRole("heading", { level: 1, name: email })).toBeVisible()

    // With an upcoming booking the erasure is refused.
    await page.getByRole("button", { name: t("admin.erase.cta") }).click()
    let sheet = page.getByRole("dialog", { name: t("admin.erase.title", { name: email }) })
    await sheet.getByRole("textbox", { name: t("admin.erase.email") }).fill("otra@demo.test")
    await sheet.getByRole("button", { name: t("admin.erase.confirm") }).click()
    await expect(sheet.getByText(t("admin.erase.mismatch"))).toBeVisible()
    await sheet.getByRole("textbox", { name: t("admin.erase.email") }).fill(email.toUpperCase())
    await sheet.getByRole("button", { name: t("admin.erase.confirm") }).click()
    await expect(sheet.getByRole("alert")).toHaveText(t("admin.erase.upcoming"))
    await sheet.getByRole("button", { name: t("admin.erase.keep") }).click()

    // Cancel every upcoming booking on her behalf.
    const upcoming = page.getByRole("region", { name: t("admin.student.upcoming") })
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const cancelLabel = new RegExp(`^${escape(t("admin.cancelFor.ctaLabel", { date: "" }).trim())}`)
    const cancelButtons = upcoming.getByRole("button", { name: cancelLabel })
    await expect(cancelButtons.first()).toBeVisible()
    while ((await cancelButtons.count()) > 0) {
      const before = await cancelButtons.count()
      await cancelButtons.first().click()
      await page.getByRole("dialog", { name: t("admin.cancelFor.title") }).getByRole("button", { name: t("admin.cancelFor.confirm") }).click()
      await expect(cancelButtons).toHaveCount(before - 1)
    }
    await expect(upcoming.getByText(t("admin.student.noUpcoming"))).toBeVisible()

    await page.getByRole("button", { name: t("admin.erase.cta") }).click()
    sheet = page.getByRole("dialog", { name: t("admin.erase.title", { name: email }) })
    await sheet.getByRole("textbox", { name: t("admin.erase.email") }).fill(email)
    await sheet.getByRole("button", { name: t("admin.erase.confirm") }).click()

    await expect(page.getByRole("status").filter({ hasText: t("admin.erase.done") })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: t("admin.erase.anonymousName") })).toBeVisible()
    await expect(page.getByText(email)).toHaveCount(0)
    await expect(page.getByRole("button", { name: t("admin.erase.cta") })).toHaveCount(0)
    await expect(page.getByRole("button", { name: t("admin.grant.cta") })).toHaveCount(0)
    // History stays (pseudonymous).
    await expect(page.getByRole("region", { name: t("admin.student.history") }).getByRole("listitem").first()).toBeVisible()

    await page.getByRole("link", { name: t("admin.student.back") }).click()
    await expect(page.getByRole("main").getByRole("link", { name: new RegExp(`^${email.replace(/\./g, "\\.")}`) })).toHaveCount(0)
  })
})
