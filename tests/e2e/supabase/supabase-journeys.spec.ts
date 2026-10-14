import type { APIRequestContext, Page } from "@playwright/test"
import { expect, fill, test, type BookingFixtures } from "../support/fixtures"

/**
 * OPT-IN (playwright.supabase.config.ts): journeys B and F against the LOCAL Supabase stack
 * seeded by supabase/seed.sql. Sign-in codes are read from the local mail catcher (Mailpit).
 * Dates are relative to the real clock, like the seed, so assertions avoid fixed dates.
 */
const MAILPIT = "http://127.0.0.1:54324/api/v1"
const STUDENT = "alumna1@example.test" // pack of 8, display name "Alumna Demo 1"
const STAFF = "staff@example.test"

async function clearInbox(request: APIRequestContext, email: string) {
  await request.delete(`${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`)
}

/** Newest 6-digit code mailed to `email`, polling Mailpit until it arrives. */
async function otpFor(request: APIRequestContext, email: string): Promise<string> {
  let code: string | null = null
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`)
        const { messages } = (await search.json()) as { messages: { ID: string }[] }
        if (!messages?.length) return null
        const message = await request.get(`${MAILPIT}/message/${messages[0].ID}`)
        const { Text } = (await message.json()) as { Text: string }
        code = /\b(\d{6})\b/.exec(Text)?.[1] ?? null
        return code
      },
      { timeout: 20_000, message: `OTP email for ${email}` },
    )
    .not.toBeNull()
  if (!code) throw new Error(`No OTP found for ${email}`)
  return code
}

async function signInWithMailedCode(page: Page, request: APIRequestContext, t: BookingFixtures["t"], email: string) {
  await clearInbox(request, email)
  await page.getByRole("textbox", { name: t("auth.email.label") }).fill(email)
  await page.getByRole("button", { name: t("auth.email.submit") }).click()
  const code = await otpFor(request, email)
  await page.getByRole("textbox", { name: t("auth.code.label") }).fill(code)
  await page.getByRole("button", { name: t("auth.code.submit"), exact: true }).click()
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Copy template as a regex: placeholders match anything. */
const pattern = (template: string) => new RegExp(escape(template).replace(/\\\{\w+\\\}/g, ".+"))

test.describe("Supabase local · B sign in and book", () => {
  test("a student books a class with the mailed code and sees it in Mis reservas", async ({ page, request, t }) => {
    await page.goto("/reservas/")
    await expect(page.getByRole("heading", { level: 1, name: t("agenda.title") })).toBeVisible()
    await expect(page.getByRole("note", { name: t("demo.banner") })).toHaveCount(0)

    // First bookable Vinyasa (seed: today+2 and today+9 at 09:00), this week or the next.
    const bookable = page.getByRole("article", { name: "Vinyasa" }).filter({ has: page.getByRole("button", { name: t("session.cta"), exact: true }) })
    if ((await bookable.count()) === 0) await page.getByRole("button", { name: t("agenda.nextWeek") }).click()
    await expect(bookable.first()).toBeVisible()
    await bookable.first().getByRole("button", { name: t("session.cta"), exact: true }).click()

    await expect(page.getByRole("heading", { level: 1, name: t("auth.title") })).toBeVisible()
    await signInWithMailedCode(page, request, t, STUDENT)

    const sheet = page.getByRole("dialog", { name: "Vinyasa" })
    await expect(sheet).toBeVisible()
    await sheet.getByRole("button", { name: t("sheet.confirm") }).click()
    const success = page.getByRole("dialog", { name: t("success.title") })
    await expect(success).toBeVisible()
    await success.getByRole("link", { name: t("success.mine") }).click()

    await expect(page.getByRole("heading", { level: 1, name: t("mine.title") })).toBeVisible()
    const upcoming = page.getByRole("region", { name: t("mine.upcoming") })
    await expect(upcoming.getByRole("article", { name: "Vinyasa" })).toHaveCount(1)
    await expect(upcoming.getByRole("article", { name: "Hatha Yoga" }).first()).toBeVisible()
  })
})

test.describe("Supabase local · F staff runs the day", () => {
  test("staff publishes a class, records attendance and grants a pack", async ({ page, request, t }) => {
    await page.goto("/admin/")
    await expect(page.getByRole("heading", { level: 1, name: t("admin.guard.signIn") })).toBeVisible()
    await page.getByRole("main").getByRole("link", { name: t("auth.signIn") }).click()
    await signInWithMailedCode(page, request, t, STAFF)

    // Publish tomorrow at 07:15 (never in the past, whatever time the run starts).
    await expect(page.getByRole("link", { name: t("admin.day.newSession") })).toBeVisible()
    await page.getByRole("link", { name: t("admin.day.next") }).click()
    await expect(page.getByRole("link", { name: t("admin.day.backToToday") })).toBeVisible()
    await page.getByRole("link", { name: t("admin.day.newSession") }).click()
    const form = page.getByRole("region", { name: t("admin.newSession.title") })
    await form.getByRole("combobox", { name: t("admin.newSession.classType") }).selectOption({ label: "Hatha Yoga" })
    await form.getByLabel(t("admin.newSession.time"), { exact: true }).fill("07:15")
    await form.getByRole("radio", { name: t("admin.modality.in_person") }).check()
    await form.getByRole("textbox", { name: t("admin.newSession.address"), exact: true }).fill("Estudio E2E 123")
    await form.getByRole("button", { name: t("admin.newSession.submit.one") }).click()
    const done = page.getByRole("status").filter({ has: page.getByRole("heading", { name: t("admin.newSession.success.one") }) })
    await expect(done).toBeVisible()
    await done.getByRole("link", { name: t("admin.newSession.viewDay") }).click()
    await expect(page.getByRole("article", { name: /^07:15 ?, Hatha Yoga$/ })).toBeVisible()

    // Yesterday's 18:00 Hatha (seed: Alumna Demo 1 attended) → mark absent, then present again.
    await page.getByRole("link", { name: t("admin.day.backToToday") }).click()
    await page.getByRole("link", { name: t("admin.day.prev") }).click()
    await page.getByRole("article", { name: /^18:00 ?, Hatha Yoga$/ }).getByRole("link", { name: t("admin.session.open") }).click()
    const attendance = page.getByRole("group", { name: t("admin.attendance.legend", { name: "Alumna Demo 1" }) })
    await expect(attendance.getByRole("button", { name: t("admin.attendance.attended") })).toHaveAttribute("aria-pressed", "true")
    await attendance.getByRole("button", { name: t("admin.attendance.no_show") }).click()
    await expect(page.getByRole("status").filter({ hasText: t("admin.attendance.saved") })).toBeVisible()
    await expect(attendance.getByRole("button", { name: t("admin.attendance.no_show") })).toHaveAttribute("aria-pressed", "true")

    // Grant a pack to Alumna Demo 3 (her single credit is used up).
    await page.getByRole("link", { name: t("admin.nav.students") }).click()
    await page.getByRole("link", { name: /^Alumna Demo 3/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Alumna Demo 3" })).toBeVisible()
    await page.getByRole("button", { name: t("admin.grant.cta") }).click()
    const sheet = page.getByRole("dialog", { name: t("admin.grant.title") })
    await sheet.getByRole("button", { name: t("admin.grant.submit") }).click()
    await expect(page.getByRole("status").filter({ hasText: pattern(fill(t("admin.grant.done"), { n: 4 })) })).toBeVisible()
    await expect(page.getByRole("heading", { level: 2, name: t("admin.student.balance.many", { n: 4 }) })).toBeVisible()
  })
})
