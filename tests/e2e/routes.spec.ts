import type { CopyKey } from "../../booking/config"
import { SESSION, expect, test } from "./support/fixtures"

/**
 * Every booking route served from the static export answers 200 on a cold deep link AND on a
 * browser refresh (GitHub Pages has no SPA fallback), renders its first meaningful state and
 * carries a brand-voiced document title. Plus H: the landing is untouched and unlinked.
 */
interface RouteCase {
  path: string
  /** Page title segment (copy key); null for the section index. */
  title: CopyKey | null
  section: "booking" | "admin"
  /** First meaningful heading for a signed-out visitor (copy key or literal data). */
  heading: { key: CopyKey } | { text: string }
}

const ROUTES: RouteCase[] = [
  { path: "/reservas/", title: null, section: "booking", heading: { key: "agenda.title" } },
  { path: `/reservas/sesion/?id=${SESSION.saturdayGroup}`, title: "meta.session", section: "booking", heading: { text: "Clase grupal" } },
  { path: "/reservas/ingresar/", title: "auth.signIn", section: "booking", heading: { key: "auth.title" } },
  { path: "/reservas/mis-reservas/", title: "mine.title", section: "booking", heading: { key: "mine.title" } },
  { path: "/admin/", title: null, section: "admin", heading: { key: "admin.guard.signIn" } },
  { path: `/admin/clase/?id=${SESSION.todayGroup}`, title: "meta.admin.session", section: "admin", heading: { key: "admin.guard.signIn" } },
  { path: "/admin/practicas/", title: "admin.nav.classTypes", section: "admin", heading: { key: "admin.guard.signIn" } },
  { path: "/admin/nueva-clase/", title: "admin.newSession.title", section: "admin", heading: { key: "admin.guard.signIn" } },
  { path: "/admin/alumnas/", title: "admin.students.title", section: "admin", heading: { key: "admin.guard.signIn" } },
  { path: "/admin/alumna/?id=demo-user-1", title: "meta.admin.student", section: "admin", heading: { key: "admin.guard.signIn" } },
]

test.describe("deep links and refresh", () => {
  for (const route of ROUTES) {
    test(`${route.path} loads and survives a refresh`, { tag: "@white-label" }, async ({ page, t, brand }) => {
      const section = route.section === "booking" ? t("meta.booking.title") : t("admin.label")
      const title = [route.title ? t(route.title) : null, section, brand.name].filter(Boolean).join(" · ")
      const heading = "key" in route.heading ? t(route.heading.key) : route.heading.text

      for (const load of [() => page.goto(route.path), () => page.reload()]) {
        const response = await load()
        expect(response?.status()).toBe(200)
        await expect(page).toHaveTitle(title)
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
        await expect(page.getByRole("note", { name: t("demo.banner") })).toBeVisible()
      }
      // Query-string routes keep their parameters across the refresh.
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(route.path)
    })
  }

  test("a section URL without the trailing slash redirects to it", async ({ page }) => {
    const response = await page.goto("/reservas")
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/reservas\/$/)
  })
})

test.describe("H · landing", () => {
  test("the landing keeps its content and does not link to booking yet (ADR-013)", async ({ page }) => {
    const response = await page.goto("/")
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle("ByLou Yoga - Regulá tu sistema nervioso con yoga + neurociencia")
    await expect(page.getByRole("heading", { level: 1, name: "Regulá tu sistema nervioso" })).toBeVisible()
    await expect(page.getByRole("banner").getByRole("link", { name: "Yoga ByLou" })).toBeVisible()
    const cta = page.getByRole("main").getByRole("link", { name: "Reservar clase de prueba" })
    await expect(cta).toHaveAttribute("href", /^https:\/\/ig\.me\/m\/bylou\.yoga/)
    await expect(page.getByRole("link", { name: "Recibir la guía" })).toBeVisible()
    // No booking/admin entry point on the landing until release.
    const hrefs = await page.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))
    expect(hrefs.length).toBeGreaterThan(5)
    expect(hrefs.filter((href) => /\/(reservas|admin)(\/|$|\?)/.test(href))).toEqual([])
    expect(await page.locator("[data-booking-theme]").count()).toBe(0)
  })
})
