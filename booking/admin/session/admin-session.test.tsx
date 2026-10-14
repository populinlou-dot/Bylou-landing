import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { MarkAttendanceResult } from "../../application"
import { TEST_USER, adminSessionAt, fakeAdminRepository, fakeAuth, rosterEntry } from "../../application/test-support"
import { renderAdmin } from "../test-support"
import { AdminSessionContainer } from "./admin-session-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/clase/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// now = Wed 2026-10-14 12:00 (BA). "s-now" started at 11:30 → attendance window open.
const OPEN = adminSessionAt("2026-10-14T14:30:00.000Z", { id: "s-now", confirmed: 3, capacity: 8 })
const FUTURE = adminSessionAt("2026-10-15T22:00:00.000Z", { id: "s-future", confirmed: 1 })
const OLD = adminSessionAt("2026-10-01T22:00:00.000Z", { id: "s-old", confirmed: 1 })

const XSS = '<script>alert("x")</script><img src=x onerror=alert(1)>'
const ROSTER = {
  "s-now": [
    rosterEntry("b-ana", { displayName: "Ana P.", attendance: "attended" }),
    rosterEntry("b-xss", { displayName: XSS }),
    rosterEntry("b-email", { displayName: null, email: "sin.nombre@example.test" }),
    rosterEntry("b-anon", { displayName: "  ", email: null, status: "cancelled" }),
  ],
  "s-future": [rosterEntry("b-f")],
  "s-old": [rosterEntry("b-o", { attendance: "no_show" })],
}

function setup(id = "s-now") {
  const admin = fakeAdminRepository({ sessions: [OPEN, FUTURE, OLD], roster: ROSTER })
  const view = renderAdmin(<AdminSessionContainer id={id} />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
  return { admin, ...view }
}

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement

describe("Admin roster (AD-06)", () => {
  it("renders names as plain text, never as HTML", async () => {
    const { container } = setup()
    expect(await screen.findByRole("heading", { name: "Clase grupal" })).toBeTruthy()
    expect(screen.getByText(XSS).tagName).toBe("P")
    expect(container.querySelector("script")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
  })

  it("falls back to the email, then a neutral label; shows status and attendance", async () => {
    setup()
    await screen.findByRole("heading", { name: "Reservas" })
    const items = screen.getAllByRole("listitem")
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual([XSS, "Ana P.", "sin.nombre@example.test", "Sin nombre cargado"])
    expect(within(rowOf("Ana P.")).getByRole("button", { name: "Presente" }).getAttribute("aria-pressed")).toBe("true")
    expect(within(rowOf("Sin nombre cargado")).getByText("Canceló")).toBeTruthy()
    expect(within(rowOf("Sin nombre cargado")).queryByRole("button")).toBeNull()
    expect(screen.getByText("3 de 8 lugares ocupados")).toBeTruthy()
  })

  it("shows not found for an invalid id without calling the repository", async () => {
    const { admin } = setup("../etc")
    expect(await screen.findByRole("heading", { name: "No encontramos esta clase." })).toBeTruthy()
    expect(admin.calls).toEqual(["getMyRole"])
  })
})

describe("Admin attendance (AD-07: never optimistic)", () => {
  it("shows pending until the server answers, then the saved value", async () => {
    const { admin } = setup()
    await screen.findByRole("heading", { name: "Reservas" })
    let resolve!: (r: MarkAttendanceResult) => void
    vi.spyOn(admin, "markAttendance").mockImplementation(() => new Promise((r) => (resolve = r)))
    const row = rowOf("sin.nombre@example.test")
    fireEvent.click(within(row).getByRole("button", { name: "Ausente" }))

    expect(within(row).getByRole("button", { name: "Guardando…" })).toBeTruthy()
    // Not optimistic: nothing is marked yet, and the row is locked against double submits.
    expect(within(row).getByRole("button", { name: "Presente" }).getAttribute("aria-pressed")).toBe("false")
    within(row)
      .getAllByRole("button")
      .forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true))

    resolve({ ok: true, bookingId: "b-email", attendance: "no_show" })
    await waitFor(() => expect(within(row).getByRole("button", { name: "Ausente" }).getAttribute("aria-pressed")).toBe("true"))
    expect(screen.getByRole("status").textContent).toBe("Asistencia guardada.")
    expect(admin.markAttendance).toHaveBeenCalledTimes(1)
  })

  it("keeps the previous value and shows an error when the server refuses", async () => {
    const { admin } = setup()
    await screen.findByRole("heading", { name: "Reservas" })
    vi.spyOn(admin, "markAttendance").mockResolvedValue({ ok: false, code: "network_error" })
    const row = rowOf("Ana P.")
    fireEvent.click(within(row).getByRole("button", { name: "Ausente" }))
    expect(await within(row).findByRole("alert")).toBeTruthy()
    expect(within(row).getByRole("alert").textContent).toBe("No pudimos guardar la asistencia. Probá de nuevo.")
    expect(within(row).getByRole("button", { name: "Presente" }).getAttribute("aria-pressed")).toBe("true")
    expect((within(row).getByRole("button", { name: "Ausente" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("explains a server-side window refusal", async () => {
    const { admin } = setup()
    await screen.findByRole("heading", { name: "Reservas" })
    vi.spyOn(admin, "markAttendance").mockResolvedValue({ ok: false, code: "attendance_window_closed" })
    fireEvent.click(within(rowOf("Ana P.")).getByRole("button", { name: "Ausente" }))
    expect((await within(rowOf("Ana P.")).findByRole("alert")).textContent).toBe(
      "Pasaron más de 7 días: la asistencia ya no se puede editar.",
    )
  })

  it("disables the controls before the window opens", async () => {
    const { admin } = setup("s-future")
    await screen.findByRole("heading", { name: "Reservas" })
    expect(screen.getByText("Vas a poder marcar la asistencia desde 15 minutos antes de que empiece la clase.")).toBeTruthy()
    within(rowOf("Alumna b-f"))
      .getAllByRole("button")
      .forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true))
    expect(admin.calls.some((c) => c.startsWith("markAttendance"))).toBe(false)
  })

  it("disables the controls more than 7 days after the session", async () => {
    setup("s-old")
    await screen.findByRole("heading", { name: "Reservas" })
    expect(screen.getByText("Pasaron más de 7 días: la asistencia ya no se puede editar.")).toBeTruthy()
    const row = rowOf("Alumna b-o")
    expect(within(row).getByRole("button", { name: "Ausente" }).getAttribute("aria-pressed")).toBe("true")
    within(row)
      .getAllByRole("button")
      .forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true))
  })
})
