import { bylouBrand } from "../../brands/bylou"
import { expect, test } from "./support/fixtures"

/**
 * G · white-label smoke for the build compiled with NEXT_PUBLIC_BOOKING_BRAND=demo-studio.
 * The brand-agnostic journeys (tagged @white-label) also run against that build; this file adds
 * the visual identity checks. Runs only in the `demo-studio` project.
 */
test.describe("G · demo-studio brand", () => {
  test("student and admin screens use the demo identity, theme and vocabulary", async ({ page, t, brand }) => {
    expect(brand.id).toBe("demo-studio")
    await page.goto("/reservas/")
    await expect(page.getByRole("heading", { level: 1, name: t("agenda.title") })).toBeVisible()
    await expect(page.getByRole("banner").getByRole("link", { name: brand.logo.wordmark })).toBeVisible()

    const scope = page.locator("[data-booking-theme]")
    await expect(scope).toHaveAttribute("data-booking-theme", "demo-studio")
    const tokens = await scope.evaluate((el) => {
      const style = getComputedStyle(el)
      return { primary: style.getPropertyValue("--primary").trim(), font: style.fontFamily }
    })
    expect(tokens.primary.toUpperCase()).toBe(brand.theme.palette.primary.toUpperCase())
    expect(tokens.primary.toUpperCase()).not.toBe(bylouBrand.theme.palette.primary.toUpperCase())

    // Terminology: "turnos" and "actividad", never Bylou's "clases" / "práctica".
    await expect(page.getByRole("group", { name: t("agenda.filter") })).toBeVisible()
    await expect(page.getByText(bylouBrand.copy["agenda.title"])).toHaveCount(0)
    const text = (await page.getByRole("main").textContent()) ?? ""
    expect(text).not.toMatch(/\bLou\b.*(escribile|pack)|Elegí|práctica/i)

    await page.goto("/admin/")
    await expect(page.getByRole("heading", { level: 1, name: t("admin.guard.signIn") })).toBeVisible()
    const nav = page.getByRole("banner").getByRole("navigation")
    await expect(nav.getByRole("link", { name: t("admin.nav.classTypes") })).toBeVisible()
    await expect(nav.getByRole("link", { name: t("admin.nav.students") })).toBeVisible()
    await expect(nav.getByRole("link", { name: bylouBrand.copy["admin.nav.students"] })).toHaveCount(0)
  })
})
