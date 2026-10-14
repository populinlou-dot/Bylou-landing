import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { demoStudioBrand } from "../../../brands/demo-studio"
import type { CancelSessionResult, UpdateSessionResult } from "../../application"
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

// now = Wed 2026-10-14 12:00 Buenos Aires.
const FUTURE = adminSessionAt("2026-10-15T22:00:00.000Z", { id: "s-future", confirmed: 3, capacity: 8 })
const SOLO = adminSessionAt("2026-10-16T22:00:00.000Z", { id: "s-solo", confirmed: 1, capacity: 1 })
const LIVE = adminSessionAt("2026-10-14T14:30:00.000Z", { id: "s-live", confirmed: 2 })
const DONE = adminSessionAt("2026-10-13T22:00:00.000Z", { id: "s-done", confirmed: 2 })
const CANCELLED = adminSessionAt("2026-10-17T22:00:00.000Z", { id: "s-cx", status: "cancelled" })

function setup(id: string, brand = bylouBrand) {
  const admin = fakeAdminRepository({
    sessions: [FUTURE, SOLO, LIVE, DONE, CANCELLED],
    roster: { "s-future": [rosterEntry("b1"), rosterEntry("b2"), rosterEntry("b3")] },
  })
  const view = renderAdmin(<AdminSessionContainer id={id} />, { brand, admin, auth: fakeAuth(TEST_USER) })
  return { admin, ...view }
}

const capacityInput = () => screen.getByLabelText("Cupo") as HTMLInputElement

describe("Capacity edit (AD-05.1)", () => {
  it("is offered before start only, prefilled, with the confirmed minimum explained", async () => {
    setup("s-future")
    await screen.findByRole("heading", { name: "Reservas" })
    expect(capacityInput().value).toBe("8")
    expect(screen.getByText("No puede ser menor que las reservas confirmadas (3).")).toBeTruthy()
  })

  it("hides capacity on started, finished and cancelled sessions", async () => {
    for (const id of ["s-live", "s-done", "s-cx"]) {
      setup(id)
      await screen.findByRole("heading", { name: "Reservas" })
      expect(screen.queryByLabelText("Cupo")).toBeNull()
      cleanup()
    }
  })

  it("refuses below the confirmed count locally, without a server call", async () => {
    const { admin } = setup("s-future")
    await screen.findByRole("heading", { name: "Reservas" })
    const spy = vi.spyOn(admin, "updateSessionCapacity")
    fireEvent.change(capacityInput(), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar cupo" }))
    expect(screen.getByText("Tiene que ser un número entero entre 3 y 100.")).toBeTruthy()
    expect(capacityInput().getAttribute("aria-invalid")).toBe("true")
    expect(spy).not.toHaveBeenCalled()
  })

  it("shows pending, then the server-confirmed capacity", async () => {
    const { admin } = setup("s-future")
    await screen.findByRole("heading", { name: "Reservas" })
    let resolve!: (r: UpdateSessionResult) => void
    const spy = vi.spyOn(admin, "updateSessionCapacity").mockImplementation(() => new Promise((r) => (resolve = r)))
    fireEvent.change(capacityInput(), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar cupo" }))
    const pending = screen.getByRole("button", { name: "Guardando…" }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    // Not optimistic: occupancy still shows the old capacity.
    expect(screen.getByText("3 de 8 lugares ocupados")).toBeTruthy()
    resolve({ ok: true, sessionId: "s-future", capacity: 5, confirmedCount: 3, changed: true })
    expect(await screen.findByText("Cupo actualizado.")).toBeTruthy()
    expect(screen.getByText("3 de 5 lugares ocupados")).toBeTruthy()
    expect(spy).toHaveBeenCalledWith({ sessionId: "s-future", capacity: 5 })
  })

  it("explains a server refusal (a booking landed meanwhile)", async () => {
    const { admin } = setup("s-future")
    await screen.findByRole("heading", { name: "Reservas" })
    vi.spyOn(admin, "updateSessionCapacity").mockResolvedValue({ ok: false, code: "capacity_below_bookings", confirmedCount: 4 })
    fireEvent.change(capacityInput(), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar cupo" }))
    expect(await screen.findByText("Reservas confirmadas: 4. El cupo no puede ser menor.")).toBeTruthy()
    expect(capacityInput().value).toBe("3")
  })
})

describe("Cancel session (AD-05.2)", () => {
  it("confirm sheet states how many students are affected and that the class goes back to the pack", async () => {
    setup("s-future")
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar clase" }))
    const sheet = screen.getByRole("dialog", { name: "¿Cancelar esta clase?" })
    expect(within(sheet).getByText("Clase grupal")).toBeTruthy()
    expect(within(sheet).getByText("Jueves 15 de octubre · 19:00")).toBeTruthy()
    expect(
      within(sheet).getByText("3 alumnas tienen reserva: se les cancela y la clase vuelve a su pack, aunque falte poco."),
    ).toBeTruthy()
    expect(within(sheet).getByText("No les llega un aviso automático: escribiles vos.")).toBeTruthy()
    fireEvent.click(within(sheet).getByRole("button", { name: "No, volver" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("singular variant", async () => {
    setup("s-solo")
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar clase" }))
    expect(screen.getByText("1 alumna tiene reserva: se le cancela y la clase vuelve a su pack, aunque falte poco.")).toBeTruthy()
  })

  it("pending blocks double submits; success closes, reports refunds and reloads", async () => {
    const { admin } = setup("s-future")
    let resolve!: (r: CancelSessionResult) => void
    const spy = vi.spyOn(admin, "cancelSession").mockImplementation(() => new Promise((r) => (resolve = r)))
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar clase" }))
    const sheet = screen.getByRole("dialog")
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, cancelar clase" }))
    const pending = within(sheet).getByRole("button", { name: "Cancelando…" }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    expect((within(sheet).getByRole("button", { name: "No, volver" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(pending)
    expect(spy).toHaveBeenCalledTimes(1)

    resolve({ ok: true, sessionId: "s-future", cancelledBookings: 3, refunded: 2, refundsSkipped: ["b3"], replayed: false })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(
      screen.getByText(
        "Clase cancelada. Clases devueltas a los packs: 2. Reservas con el pack vencido: 1. Habilitales la clase a mano.",
      ),
    ).toBeTruthy()
    await waitFor(() => expect(admin.calls.filter((c) => c === "getSession s-future")).toHaveLength(2))
  })

  it("server error keeps the sheet open with a retry", async () => {
    const { admin } = setup("s-future")
    const spy = vi
      .spyOn(admin, "cancelSession")
      .mockResolvedValueOnce({ ok: false, code: "network_error" })
      .mockResolvedValueOnce({ ok: true, sessionId: "s-future", cancelledBookings: 0, refunded: 0, refundsSkipped: [], replayed: true })
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar clase" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sí, cancelar clase" }))
    expect((await within(screen.getByRole("dialog")).findByRole("alert")).textContent).toBe(
      "No pudimos cancelar la clase. Probá de nuevo.",
    )
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reintentar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("forbidden is final: no retry button", async () => {
    const { admin } = setup("s-future")
    vi.spyOn(admin, "cancelSession").mockResolvedValue({ ok: false, code: "forbidden" })
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar clase" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sí, cancelar clase" }))
    await within(screen.getByRole("dialog")).findByRole("alert")
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Reintentar" })).toBeNull()
  })

  it("is offered while upcoming or in progress, never on finished or cancelled sessions", async () => {
    setup("s-live")
    expect(await screen.findByRole("button", { name: "Cancelar clase" })).toBeTruthy()
    cleanup()
    for (const id of ["s-done", "s-cx"]) {
      setup(id)
      await screen.findByRole("heading", { name: "Reservas" })
      expect(screen.queryByRole("button", { name: "Cancelar clase" })).toBeNull()
      cleanup()
    }
  })

  it("uses the demo-studio vocabulary", async () => {
    setup("s-future", demoStudioBrand)
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar turno" }))
    expect(screen.getByRole("dialog", { name: "¿Cancelar este turno?" })).toBeTruthy()
  })
})
