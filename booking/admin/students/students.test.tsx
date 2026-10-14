import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { demoStudioBrand } from "../../../brands/demo-studio"
import { RepositoryError } from "../../application"
import { TEST_USER, fakeAdminRepository, fakeAuth, studentSummary } from "../../application/test-support"
import { renderAdmin } from "../test-support"
import { StudentsContainer } from "./students-container"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/alumnas/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  router.replace.mockClear()
})

// now = Wed 2026-10-14 12:00 Buenos Aires (renderAdmin's fixed clock).
const STUDENTS = [
  studentSummary("u-ana", {
    displayName: "Ana <b>Pérez</b>",
    email: "ana@example.test",
    balance: 3,
    nextBooking: { bookingId: "b1", sessionId: "s1", startsAt: "2026-10-15T21:00:00.000Z", classTypeName: "Clase grupal" },
  }),
  studentSummary("u-sin-nombre", { displayName: null, email: "anonima@example.test", balance: 0, nextBooking: null }),
  studentSummary("u-uno", { displayName: "Uno", email: null, balance: 1 }),
]

function setup(initialQuery = "", brand = bylouBrand) {
  const admin = fakeAdminRepository({ students: STUDENTS })
  const view = renderAdmin(<StudentsContainer initialQuery={initialQuery} />, { brand, admin, auth: fakeAuth(TEST_USER) })
  return { admin, ...view }
}

describe("Student search (AD-09)", () => {
  it("lists every student with the server balance and the next booking (plain text)", async () => {
    setup()
    expect(await screen.findByText("Resultados: 3.")).toBeTruthy()
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(3)
    const ana = within(items[0])
    expect(ana.getByText("Ana <b>Pérez</b>")).toBeTruthy()
    expect(ana.getByText("ana@example.test")).toBeTruthy()
    expect(ana.getByText("3 clases disponibles")).toBeTruthy()
    expect(ana.getByText("Próxima clase: Jueves 15 de octubre · 18:00 · Clase grupal")).toBeTruthy()
    expect(ana.getByRole("link").getAttribute("href")).toMatch(/^\/admin\/alumna\/?\?id=u-ana$/)
    expect(within(items[1]).getByText("anonima@example.test")).toBeTruthy()
    expect(within(items[1]).getByText("Sin clases disponibles")).toBeTruthy()
    expect(within(items[1]).getByText("Sin reservas próximas")).toBeTruthy()
    expect(within(items[2]).getByText("1 clase disponible")).toBeTruthy()
    expect(document.querySelector("b")).toBeNull()
  })

  it("searches by name or email, keeps the query in the URL and shows an empty result", async () => {
    const { admin } = setup()
    await screen.findByText("Resultados: 3.")
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar alumna" }), { target: { value: "  ANA@  " } })
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }))
    expect(await screen.findByText("Resultados: 1.")).toBeTruthy()
    expect(admin.calls).toContain("searchStudents ANA@")
    expect(router.replace).toHaveBeenCalledWith("/admin/alumnas/?q=ANA%40")

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar alumna" }), { target: { value: "zzz" } })
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }))
    expect(await screen.findByText("No encontramos alumnas con «zzz».")).toBeTruthy()
  })

  it("starts from ?q= and offers retry on a load error", async () => {
    const admin = fakeAdminRepository({ students: STUDENTS })
    const search = vi.spyOn(admin, "searchStudents").mockRejectedValueOnce(new RepositoryError("network_error"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    renderAdmin(<StudentsContainer initialQuery="uno" />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
    expect((await screen.findByRole("alert")).textContent).toContain("No pudimos cargar las alumnas.")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    await waitFor(() => expect(screen.getByText("Resultados: 1.")).toBeTruthy())
    expect(search).toHaveBeenNthCalledWith(1, "uno")
    expect(search).toHaveBeenNthCalledWith(2, "uno")
  })

  it("speaks the demo studio's words (tú, créditos)", async () => {
    setup("", demoStudioBrand)
    expect(await screen.findByText("3 créditos disponibles")).toBeTruthy()
    expect(screen.getByRole("searchbox", { name: "Buscar cliente" })).toBeTruthy()
  })
})
