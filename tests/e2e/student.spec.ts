import { readFileSync } from "node:fs"
import { SESSION, STAFF_EMAIL, STUDENT_EMAIL, expect, sessionCard, signIn, test } from "./support/fixtures"

/**
 * Student journeys against the mock data source (PRD §5): A browse + filters, B sign in + book,
 * C every "why not" reason, D cancellation inside/outside the window. The mock studio lives in
 * memory per page load, so each journey moves by in-app navigation after signing in.
 */

test.describe("A · browse the agenda", () => {
  test("shows the pinned week, filters by class type and modality, and pages weeks", { tag: "@white-label" }, async ({ page, t }) => {
    await page.goto("/reservas/")
    await expect(page.getByRole("heading", { level: 1, name: t("agenda.title") })).toBeVisible()
    await expect(page.getByRole("note", { name: t("demo.banner") })).toBeVisible()
    await expect(page.getByText(t("agenda.week", { from: "12", to: "18 de octubre" }))).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: t("agenda.count.many", { n: 10 }) })).toBeVisible()
    await expect(page.getByRole("button", { name: t("agenda.thisWeek") })).toBeDisabled()

    const byType = page.getByRole("group", { name: t("agenda.filter") })
    await byType.getByRole("button", { name: "Meditación" }).click()
    await expect(byType.getByRole("button", { name: "Meditación" })).toHaveAttribute("aria-pressed", "true")
    const cards = page.getByRole("main").getByRole("article")
    await expect(cards).toHaveCount(2)
    await expect(page.getByRole("main").getByRole("article", { name: "Meditación" })).toHaveCount(2)
    await byType.getByRole("button", { name: t("filter.all") }).click()

    const byModality = page.getByRole("group", { name: t("agenda.filter.modality") })
    await byModality.getByRole("button", { name: t("filter.modality.inPerson") }).click()
    await expect(cards).toHaveCount(4)
    await expect(cards.getByText(t("filter.modality.online"), { exact: true })).toHaveCount(0)
    await byModality.getByRole("button", { name: t("filter.all") }).click()
    await expect(cards).toHaveCount(10)

    await page.getByRole("button", { name: t("agenda.nextWeek") }).click()
    await expect(page.getByText(t("agenda.week", { from: "19", to: "25 de octubre" }))).toBeVisible()
    await page.getByRole("button", { name: t("agenda.thisWeek") }).click()
    await expect(page.getByText(t("agenda.week", { from: "12", to: "18 de octubre" }))).toBeVisible()

    // Session detail by in-app navigation, then back.
    await sessionCard(page, SESSION.saturdayGroup).getByRole("link", { name: "Clase grupal" }).click()
    await expect(page).toHaveURL(new RegExp(`/reservas/sesion/\\?id=${SESSION.saturdayGroup}$`))
    await expect(page.getByRole("heading", { level: 1, name: "Clase grupal" })).toBeVisible()
    await expect(page.getByText(t("session.spots.many", { n: 5 }))).toBeVisible()
    await page.getByRole("link", { name: t("session.back") }).click()
    await expect(page.getByRole("heading", { level: 1, name: t("agenda.title") })).toBeVisible()
  })
})

test.describe("B · sign in and book", () => {
  test("books a class after the OTP sign-in and sees it in Mis reservas", { tag: "@white-label" }, async ({ page, t }) => {
    await page.goto(`/reservas/sesion/?id=${SESSION.saturdayGroup}`)
    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await expect(page).toHaveURL(/\/reservas\/ingresar\/\?returnTo=/)
    await expect(page.getByRole("heading", { level: 1, name: t("auth.title") })).toBeVisible()

    await page.getByRole("textbox", { name: t("auth.email.label") }).fill(STUDENT_EMAIL)
    await page.getByRole("button", { name: t("auth.email.submit") }).click()
    await expect(page.getByRole("note").filter({ hasText: t("auth.demoCode", { code: "123456" }) })).toBeVisible()
    await page.getByRole("textbox", { name: t("auth.code.label") }).fill("123456")
    await page.getByRole("button", { name: t("auth.code.submit"), exact: true }).click()

    // Back on the session with the confirm sheet reopened (returnTo).
    const sheet = page.getByRole("dialog", { name: "Clase grupal" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText("Sábado 17 de octubre")).toBeVisible()
    // A double click must not book twice or debit twice (Journey C, PRD §5).
    await sheet.getByRole("button", { name: t("sheet.confirm") }).dblclick()

    const success = page.getByRole("dialog", { name: t("success.title") })
    await expect(success).toBeVisible()
    await success.getByRole("link", { name: t("success.mine") }).click()

    await expect(page).toHaveURL(/\/reservas\/mis-reservas\/$/)
    await expect(page.getByRole("heading", { level: 1, name: t("mine.title") })).toBeVisible()
    await expect(page.getByRole("region", { name: t("pack.title") }).getByText(t("pack.available.many", { n: 6 }))).toBeVisible()
    const upcoming = page.getByRole("region", { name: t("mine.upcoming") }).getByRole("article")
    await expect(upcoming).toHaveCount(1)
    await expect(upcoming.getByText("Sábado 17 de octubre · 10:00")).toBeVisible()
    await expect(upcoming.getByText(t("mine.confirmed"))).toBeVisible()

    // Back on the session (same document, so the in-memory studio is kept): one spot fewer.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/reservas/sesion/\\?id=${SESSION.saturdayGroup}`))
    await expect(page.getByText(t("session.spots.many", { n: 4 }))).toBeVisible()
  })
})

test.describe("B2 · add a booked class to the calendar (ST-11)", () => {
  test("downloads the .ics and links to Google Calendar from the confirmation and Mis reservas", { tag: "@white-label" }, async ({ page, t, brand }) => {
    await page.goto(`/reservas/sesion/?id=${SESSION.saturdayGroup}`)
    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await signIn(page, t, STUDENT_EMAIL)
    const sheet = page.getByRole("dialog", { name: "Clase grupal" })
    await sheet.getByRole("button", { name: t("sheet.confirm") }).click()

    const success = page.getByRole("dialog", { name: t("success.title") })
    const actions = success.getByRole("group", { name: t("success.calendar") })
    await expect(actions).toBeVisible()

    // Saturday 17 October 10:00 Buenos Aires = 13:00 UTC; in person, so the address (shared once booked) is the location.
    const google = actions.getByRole("link", { name: new RegExp(t("calendar.google")) })
    await expect(google).toHaveAttribute("target", "_blank")
    await expect(google).toHaveAttribute("rel", "noopener noreferrer")
    await expect(google).toHaveAttribute("href", /location=Calle%20Falsa%20123%20\(demo\)/)
    const rawHref = (await google.getAttribute("href")) ?? ""
    const href = new URL(rawHref)
    expect(`${href.origin}${href.pathname}`).toBe("https://calendar.google.com/calendar/render")
    expect(href.searchParams.get("action")).toBe("TEMPLATE")
    expect(href.searchParams.get("text")).toBe(`Clase grupal · ${brand.name}`)
    expect(href.searchParams.get("dates")).toMatch(/^20261017T130000Z\/20261017T\d{4}00Z$/)

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      actions.getByRole("button", { name: t("calendar.ics") }).click(),
    ])
    expect(download.suggestedFilename()).toBe("clase-grupal-2026-10-17.ics")
    const ics = readFileSync((await download.path()) ?? "", "utf8")
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
    expect(ics).toContain("\r\nBEGIN:VEVENT\r\n")
    expect(ics).toContain("\r\nDTSTART:20261017T130000Z\r\n")
    expect(ics).toContain(`\r\nUID:session-${SESSION.saturdayGroup}@${brand.domain}\r\n`)
    expect(ics).toContain("\r\nLOCATION:Calle Falsa 123 (demo)\r\n")

    // Same event from Mis reservas: same UID, so importing it again updates instead of duplicating.
    await success.getByRole("link", { name: t("success.mine") }).click()
    const card = page.getByRole("region", { name: t("mine.upcoming") }).getByRole("article", { name: "Clase grupal" })
    const mine = card.getByRole("group", { name: t("success.calendar") })
    await expect(mine.getByRole("link", { name: new RegExp(t("calendar.google")) })).toHaveAttribute("href", rawHref)
    const [again] = await Promise.all([page.waitForEvent("download"), mine.getByRole("button", { name: t("calendar.ics") }).click()])
    expect(again.suggestedFilename()).toBe("clase-grupal-2026-10-17.ics")
    const uid = (text: string) => text.split("\r\n").find((line) => line.startsWith("UID:"))
    expect(uid(readFileSync((await again.path()) ?? "", "utf8"))).toBe(uid(ics))
  })
})

test.describe("C · why a class cannot be booked", () => {
  test("full, finished and cancelled sessions explain why and offer no booking", { tag: "@white-label" }, async ({ page, t }) => {
    await page.goto("/reservas/")
    const full = sessionCard(page, SESSION.fullIndividual)
    await expect(full.getByText(t("session.full"), { exact: true })).toBeVisible()
    await expect(full.getByText(t("reason.session_full"))).toBeVisible()
    await expect(full.getByRole("button", { name: t("session.cta"), exact: true })).toHaveCount(0)

    const finished = sessionCard(page, SESSION.pastGroup)
    await expect(finished.getByText(t("session.past"), { exact: true })).toBeVisible()
    await expect(finished.getByRole("button", { name: t("session.cta"), exact: true })).toHaveCount(0)

    const cancelled = sessionCard(page, SESSION.cancelledMeditation)
    await expect(cancelled.getByText(t("session.cancelled"), { exact: true })).toBeVisible()
    await expect(cancelled.getByText(t("reason.session_cancelled"))).toBeVisible()
    await expect(cancelled.getByRole("button", { name: t("session.cta"), exact: true })).toHaveCount(0)

    // Same reason on the detail page.
    await full.getByRole("link", { name: "Clase individual" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Clase individual" })).toBeVisible()
    await expect(page.getByText(t("reason.session_full"))).toBeVisible()
    await expect(page.getByRole("button", { name: t("session.cta"), exact: true })).toHaveCount(0)
  })

  test("an account without credits is told to get a pack and gets the contact link", async ({ page, t, brand }) => {
    // The demo staff account holds no pack, so it is a signed-in account with no valid credit.
    await page.goto(`/reservas/sesion/?id=${SESSION.saturdayGroup}`)
    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await signIn(page, t, STAFF_EMAIL)
    const sheet = page.getByRole("dialog", { name: "Clase grupal" })
    const noCredit = sheet.getByRole("alert")
    await expect(noCredit.getByText(t("pack.none"))).toBeVisible()
    await expect(noCredit.getByRole("link", { name: t("pack.none.cta") })).toHaveAttribute(
      "href",
      brand.contact.instagramDm ?? `mailto:${brand.contact.email}`,
    )
    await expect(sheet.getByRole("button", { name: t("sheet.confirm") })).toHaveCount(0)
  })
})

test.describe("D · cancellation (Bylou: 24 h, then contact Lou)", () => {
  test("more than 24 h before: cancels and refunds the class", async ({ page, t }) => {
    await page.goto(`/reservas/sesion/?id=${SESSION.saturdayGroup}`)
    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await signIn(page, t, STUDENT_EMAIL)
    await page.getByRole("dialog", { name: "Clase grupal" }).getByRole("button", { name: t("sheet.confirm") }).click()
    await page.getByRole("dialog", { name: t("success.title") }).getByRole("link", { name: t("success.mine") }).click()
    await expect(page.getByRole("region", { name: t("pack.title") }).getByText(t("pack.available.many", { n: 6 }))).toBeVisible()

    await page.getByRole("region", { name: t("mine.upcoming") }).getByRole("button", { name: t("cancel.cta") }).click()
    const sheet = page.getByRole("dialog", { name: t("cancel.title") })
    await expect(sheet.getByText(t("cancel.refund"))).toBeVisible()
    await sheet.getByRole("button", { name: t("cancel.confirm") }).click()

    await expect(page.getByRole("status").filter({ hasText: t("cancel.done") })).toBeVisible()
    await expect(page.getByRole("region", { name: t("pack.title") }).getByText(t("pack.available.many", { n: 7 }))).toBeVisible()
    await expect(page.getByRole("region", { name: t("mine.upcoming") }).getByRole("article")).toHaveCount(0)
    // History keeps the cancelled booking.
    const history = page.getByRole("region", { name: t("mine.history") })
    await expect(history.getByRole("article").filter({ hasText: "Sábado 17 de octubre · 10:00" }).getByText(t("history.cancelled"))).toBeVisible()
  })

  test("less than 24 h before: no online cancel, link to contact the studio", async ({ page, t, brand }) => {
    expect(brand.rules.lateCancelPolicy).toBe("deny")
    await page.goto(`/reservas/sesion/?id=${SESSION.todayGroup}`)
    await page.getByRole("button", { name: t("session.cta"), exact: true }).click()
    await signIn(page, t, STUDENT_EMAIL)
    await page.getByRole("dialog", { name: "Clase grupal" }).getByRole("button", { name: t("sheet.confirm") }).click()
    await page.getByRole("dialog", { name: t("success.title") }).getByRole("link", { name: t("success.mine") }).click()

    const booking = page.getByRole("region", { name: t("mine.upcoming") }).getByRole("article")
    await expect(booking).toHaveCount(1)
    await expect(booking.getByText(t("cancel.closed", { h: brand.rules.cancellationWindowHours }))).toBeVisible()
    await expect(booking.getByRole("button", { name: t("cancel.cta") })).toHaveCount(0)
    await expect(booking.getByRole("link", { name: t("contact.cta") })).toHaveAttribute("href", brand.contact.instagramDm ?? "")
  })
})
