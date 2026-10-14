import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { demoStudioBrand } from "../../../brands/demo-studio"
import { TEST_USER, adminSessionAt, fakeAdminRepository, fakeAuth } from "../../application/test-support"
import { renderAdmin } from "../test-support"
import { AdminDayContainer } from "./admin-day-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Today (studio TZ) is Wednesday 2026-10-14; now = 12:00.
const SESSIONS = [
  adminSessionAt("2026-10-14T22:00:00.000Z", { id: "s-group", confirmed: 8, capacity: 8 }), // 19:00
  adminSessionAt("2026-10-14T11:00:00.000Z", { id: "s-one", confirmed: 1, capacity: 1, name: "Clase individual" }), // 08:00
  adminSessionAt("2026-10-14T19:00:00.000Z", { id: "s-cx", status: "cancelled", published: false, name: "Meditación" }),
  adminSessionAt("2026-10-15T22:00:00.000Z", { id: "s-tomorrow", confirmed: 2 }),
]

const staff = () => ({ admin: fakeAdminRepository({ sessions: SESSIONS }), auth: fakeAuth(TEST_USER) })

describe("Admin 'Hoy' (AD-06)", () => {
  it("lists today's sessions by time with occupancy and a text status", async () => {
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, ...staff() })
    expect(await screen.findByRole("heading", { name: "Hoy · Miércoles 14 de octubre" })).toBeTruthy()
    const cards = screen.getAllByRole("article")
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual([
      "08:00 · , Clase individual",
      "16:00 · , Meditación",
      "19:00 · , Clase grupal",
    ])
    expect(within(cards[0]).getByText("Finalizada")).toBeTruthy()
    expect(within(cards[0]).getByText("1 de 1 lugares ocupados")).toBeTruthy()
    expect(within(cards[1]).getByText("Cancelada")).toBeTruthy()
    expect(within(cards[1]).getByText("Oculta")).toBeTruthy()
    expect(within(cards[2]).getByText("8/8")).toBeTruthy()
    expect(within(cards[2]).getByText("Próxima")).toBeTruthy()
    expect(within(cards[2]).getByRole("link", { name: "Ver lista y asistencia" }).getAttribute("href")).toMatch(
      /^\/admin\/clase\/?\?id=s-group$/,
    )
  })

  it("navigates days with links (prev/next, back to today)", async () => {
    renderAdmin(<AdminDayContainer date="2026-10-15" />, { brand: bylouBrand, ...staff() })
    expect(await screen.findByRole("heading", { name: "Jueves 15 de octubre" })).toBeTruthy()
    expect(screen.getAllByRole("article")).toHaveLength(1)
    expect(screen.getByRole("link", { name: "Día anterior" }).getAttribute("href")).toMatch(/^\/admin\/?\?dia=2026-10-14$/)
    expect(screen.getByRole("link", { name: "Día siguiente" }).getAttribute("href")).toMatch(/^\/admin\/?\?dia=2026-10-16$/)
    expect(screen.getByRole("link", { name: "Volver a hoy" }).getAttribute("href")).toMatch(/^\/admin\/?$/)
  })

  it("shows the empty state for a day without sessions", async () => {
    renderAdmin(<AdminDayContainer date="2026-10-18" />, { brand: bylouBrand, ...staff() })
    expect(await screen.findByText("No hay clases este día.")).toBeTruthy()
  })

  it("shows an error with retry", async () => {
    const deps = staff()
    vi.spyOn(deps.admin, "listSessions").mockRejectedValueOnce(new Error("offline"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderAdmin(<AdminDayContainer date={null} />, { brand: bylouBrand, ...deps })
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }))
    expect(await screen.findAllByRole("article")).toHaveLength(3)
  })

  it("uses the active brand's copy (white-label)", async () => {
    renderAdmin(<AdminDayContainer date="2026-10-18" />, { brand: demoStudioBrand, ...staff() })
    expect(await screen.findByText("No hay turnos este día.")).toBeTruthy()
  })
})
