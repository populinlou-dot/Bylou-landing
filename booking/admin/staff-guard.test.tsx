import { act, cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../brands/bylou"
import { RepositoryError } from "../application"
import { TEST_USER, adminSessionAt, fakeAdminRepository, fakeAuth } from "../application/test-support"
import { AdminDayContainer } from "./day/admin-day-container"
import { NOW, renderAdmin } from "./test-support"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const TODAY = [adminSessionAt("2026-10-14T22:00:00.000Z", { id: "s-evening", confirmed: 3 })]

describe("Admin staff guard (AD-01, UX only)", () => {
  it("anonymous: asks to sign in and returns to /admin/ afterwards; no admin call at all", async () => {
    const admin = fakeAdminRepository({ sessions: TODAY })
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, admin, auth: fakeAuth(null) })
    expect(await screen.findByRole("heading", { name: "Entrá con tu mail para usar el panel." })).toBeTruthy()
    const link = screen.getByRole("link", { name: "Ingresar" })
    expect(link.getAttribute("href")).toMatch(new RegExp(`^/reservas/ingresar/?\\?returnTo=${encodeURIComponent("/admin/")}$`))
    expect(admin.calls).toEqual([])
    expect(screen.queryByText(/Datos de demostración/)).toBeNull()
  })

  it("demo mode: shows the demo banner and the staff sign-in hint", async () => {
    const admin = fakeAdminRepository()
    renderAdmin(<AdminDayContainer date={null} />, {
      brand: bylouBrand,
      admin,
      auth: fakeAuth(null),
      isDemo: true,
      demoStaffEmail: "staff@demo.test",
    })
    expect(await screen.findByText(/entrá con staff@demo\.test/)).toBeTruthy()
    expect(screen.getByRole("note", { name: "Datos de demostración" })).toBeTruthy()
  })

  it("signed-in student: 'Sin acceso' and nothing requested beyond the role check", async () => {
    const admin = fakeAdminRepository({ role: "student", sessions: TODAY })
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
    expect(await screen.findByRole("heading", { name: "Sin acceso" })).toBeTruthy()
    expect(screen.getByText("Este panel es solo para el equipo del estudio.")).toBeTruthy()
    expect(admin.calls).toEqual(["getMyRole"])
    expect(screen.queryByText("Clase grupal")).toBeNull()
  })

  it("server says forbidden on the role read → 'Sin acceso'", async () => {
    const admin = fakeAdminRepository()
    vi.spyOn(admin, "getMyRole").mockRejectedValue(new RepositoryError("forbidden"))
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
    expect(await screen.findByRole("heading", { name: "Sin acceso" })).toBeTruthy()
  })

  it("role check failure offers a retry", async () => {
    const admin = fakeAdminRepository({ sessions: TODAY })
    const spy = vi.spyOn(admin, "getMyRole").mockRejectedValueOnce(new RepositoryError("network_error"))
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }))
    expect(await screen.findByRole("heading", { name: /^Hoy · / })).toBeTruthy()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("staff: renders the day; signing out hides admin content immediately", async () => {
    const admin = fakeAdminRepository({ role: "staff", sessions: TODAY })
    const auth = fakeAuth(TEST_USER)
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, admin, auth })
    expect(await screen.findByRole("heading", { name: "Hoy · Miércoles 14 de octubre" })).toBeTruthy()
    expect(admin.calls[0]).toBe("getMyRole")
    expect(screen.getByText("Clase grupal")).toBeTruthy()
    act(() => auth.setUser(null))
    expect(screen.queryByText("Clase grupal")).toBeNull()
    expect(await screen.findByRole("heading", { name: "Entrá con tu mail para usar el panel." })).toBeTruthy()
    expect(NOW).toBe("2026-10-14T15:00:00.000Z")
  })
})
