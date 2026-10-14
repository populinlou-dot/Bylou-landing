import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { AdjustCreditsResult, BookForStudentResult, GrantCreditsResult } from "../../application"
import {
  TEST_USER,
  adminSessionAt,
  fakeAdminRepository,
  fakeAuth,
  grantView,
  ledgerEntry,
  studentBooking,
  studentSummary,
} from "../../application/test-support"
import { renderAdmin } from "../test-support"
import { StudentDetailContainer } from "./student-detail-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/alumna/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// now = Wed 2026-10-14 12:00 Buenos Aires (renderAdmin's fixed clock).
function setup() {
  const admin = fakeAdminRepository({
    students: [studentSummary("u-ana", { displayName: "Ana", balance: 3, nextExpiry: "2026-11-12T03:00:00.000Z" })],
    grants: {
      "u-ana": [
        grantView("g-1", { total: 4, remaining: 3, expiresAt: "2026-11-12T03:00:00.000Z", note: "Pack 4 <script>x</script>" }),
        grantView("g-old", { expiresAt: "2026-10-01T03:00:00.000Z", validFrom: "2026-09-01T03:00:00.000Z" }),
      ],
    },
    studentBookings: {
      "u-ana": [
        studentBooking("b-next", "2026-10-15T21:00:00.000Z", { source: "staff" }),
        studentBooking("b-past", "2026-10-10T21:00:00.000Z", { attendance: "attended" }),
      ],
    },
    ledger: {
      "u-ana": [
        ledgerEntry("1", { delta: 4, note: "Pack 4", createdAt: "2026-10-01T12:00:00.000Z" }),
        ledgerEntry("2", { reason: "admin_adjust", delta: -1, note: "Clase tomada fuera de la app", createdAt: "2026-10-02T12:00:00.000Z" }),
        ledgerEntry("3", { reason: "booking_debit", delta: -1, actor: "student", bookingId: "b-past", createdAt: "2026-10-03T12:00:00.000Z" }),
      ],
    },
    sessions: [
      adminSessionAt("2026-10-16T21:00:00.000Z", { id: "s-free", name: "Clase grupal", confirmed: 2, capacity: 8 }),
      adminSessionAt("2026-10-17T21:00:00.000Z", { id: "s-full", name: "Clase individual", confirmed: 1, capacity: 1 }),
    ],
  })
  const view = renderAdmin(<StudentDetailContainer id="u-ana" />, { brand: bylouBrand, admin, auth: fakeAuth(TEST_USER) })
  return { admin, ...view }
}

const ready = () => screen.findByRole("heading", { name: "Ana", level: 1 })

describe("Student detail (AD-09, AD-08.3)", () => {
  it("shows the server balance, active packs, bookings and the ledger newest first, as plain text", async () => {
    setup()
    await ready()
    expect(screen.getByRole("heading", { name: "3 clases disponibles" })).toBeTruthy()
    expect(screen.getByText("La próxima clase disponible vence el 11 de noviembre.")).toBeTruthy()
    const packs = within(screen.getByRole("region", { name: "Packs vigentes" }))
    expect(packs.getAllByRole("listitem")).toHaveLength(1)
    expect(packs.getByText("3 de 4 clases · válido hasta el 11 de noviembre")).toBeTruthy()
    expect(packs.getByText("Pack 4 <script>x</script>")).toBeTruthy()
    const upcoming = within(screen.getByRole("region", { name: "Próximas reservas" }))
    expect(upcoming.getByText("Jueves 15 de octubre · 18:00")).toBeTruthy()
    expect(upcoming.getByText("Reservada por el estudio")).toBeTruthy()
    expect(within(screen.getByRole("region", { name: "Historial" })).getByText("Presente")).toBeTruthy()
    const ledger = within(screen.getByRole("region", { name: "Movimientos" })).getAllByRole("listitem")
    expect(ledger.map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Reserva · por la alumna",
      "Ajuste · por el estudio",
      "Pack cargado · por el estudio",
    ])
    expect(within(ledger[1]).getByText("resta 1")).toBeTruthy()
    expect(within(ledger[1]).getByText("Clase tomada fuera de la app")).toBeTruthy()
    expect(document.querySelector("script")).toBeNull()
  })
})

describe("Grant a pack (AD-08)", () => {
  it("warns that the note is visible to the student, never mentions an online payment, shows pending, retries with the same key", async () => {
    const { admin } = setup()
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Cargar pack" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Cargar un pack" }))
    const note = dialog.getByLabelText("Nota (opcional)")
    const warning = dialog.getByText("La alumna puede ver esta nota. No anotes datos de pago ni comentarios internos.")
    expect(note.getAttribute("aria-describedby")).toContain(warning.id)
    expect(dialog.getByText(/Acá no se cobra nada/)).toBeTruthy()
    expect((dialog.getByLabelText("Válido hasta (inclusive)") as HTMLInputElement).value).toBe("2026-11-12")

    let resolve!: (r: GrantCreditsResult) => void
    const grant = vi
      .spyOn(admin, "grantCredits")
      .mockResolvedValueOnce({ ok: false, code: "network_error" })
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    fireEvent.change(dialog.getByLabelText("Cantidad de clases"), { target: { value: "8" } })
    fireEvent.change(note, { target: { value: "Pack 8" } })
    fireEvent.click(dialog.getByRole("button", { name: "Cargar pack" }))
    expect((await dialog.findByRole("alert")).textContent).toBe("No pudimos cargar el pack. Revisá tu conexión y probá de nuevo.")

    fireEvent.click(dialog.getByRole("button", { name: "Reintentar" }))
    const pending = dialog.getByRole("button", { name: "Cargando…" }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    expect(grant).toHaveBeenCalledTimes(2)
    expect(grant.mock.calls[1][0]).toEqual(grant.mock.calls[0][0])
    expect(grant.mock.calls[0][0]).toMatchObject({ userId: "u-ana", credits: 8, validDays: 30, note: "Pack 8" })

    await act(async () => resolve({ ok: true, grantId: "g-new", credits: 8, expiresAt: "2026-11-13T03:00:00.000Z", replayed: false }))
    expect(await screen.findByText("Pack cargado: 8 clases, válido hasta el 12 de noviembre.")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("validates locally (no call): a past expiry", async () => {
    const { admin } = setup()
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Cargar pack" }))
    const dialog = within(await screen.findByRole("dialog"))
    const grant = vi.spyOn(admin, "grantCredits")
    fireEvent.change(dialog.getByLabelText("Válido hasta (inclusive)"), { target: { value: "2026-10-13" } })
    fireEvent.click(dialog.getByRole("button", { name: "Cargar pack" }))
    expect(dialog.getByText("Elegí una fecha desde hoy.")).toBeTruthy()
    expect(grant).not.toHaveBeenCalled()
  })
})

describe("Adjust credits (AD-08.2)", () => {
  it("requires a reason, warns it is visible, sends a signed delta and explains server refusals", async () => {
    const { admin } = setup()
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Ajustar el pack válido hasta el 11 de noviembre" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Ajustar el pack" }))
    expect((dialog.getByRole("radio", { name: "Restar clases" }) as HTMLInputElement).checked).toBe(true)
    expect(dialog.getByText("La alumna puede ver el motivo en sus movimientos.")).toBeTruthy()
    const adjust = vi.spyOn(admin, "adjustCredits")

    fireEvent.click(dialog.getByRole("button", { name: "Guardar ajuste" }))
    expect(dialog.getByText("Completá este dato.")).toBeTruthy()
    expect(dialog.getByLabelText("Motivo (obligatorio)").getAttribute("aria-invalid")).toBe("true")
    expect(adjust).not.toHaveBeenCalled()

    fireEvent.change(dialog.getByLabelText("Cantidad"), { target: { value: "4" } })
    fireEvent.change(dialog.getByLabelText("Motivo (obligatorio)"), { target: { value: "Clase tomada" } })
    fireEvent.click(dialog.getByRole("button", { name: "Guardar ajuste" }))
    expect(dialog.getByText("Tiene que ser un número entero entre 1 y 3.")).toBeTruthy()
    expect(adjust).not.toHaveBeenCalled()

    adjust.mockResolvedValueOnce({ ok: false, code: "insufficient_balance", creditsRemaining: 1 } satisfies AdjustCreditsResult)
    fireEvent.change(dialog.getByLabelText("Cantidad"), { target: { value: "2" } })
    fireEvent.click(dialog.getByRole("button", { name: "Guardar ajuste" }))
    expect((await dialog.findByRole("alert")).textContent).toBe("Clases que le quedan al pack: 1. No se puede restar más.")
    expect(adjust.mock.calls[0][0]).toMatchObject({ grantId: "g-1", delta: -2, reason: "Clase tomada" })

    fireEvent.change(dialog.getByLabelText("Cantidad"), { target: { value: "1" } })
    fireEvent.click(dialog.getByRole("button", { name: "Guardar ajuste" }))
    expect(await screen.findByText("Ajuste guardado. Clases disponibles: 2.")).toBeTruthy()
    expect(adjust.mock.calls[1][0].requestKey).toBe(adjust.mock.calls[0][0].requestKey)
  })
})

describe("Book / cancel on behalf (AD-10)", () => {
  it("books a session for the student; full sessions are listed but disabled", async () => {
    const { admin } = setup()
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Reservar una clase" }))
    const dialog = within(await screen.findByRole("dialog", { name: "Reservar para Ana" }))
    const select = (await dialog.findByLabelText("Clase")) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => [o.text, o.disabled])).toEqual([
      ["Viernes 16 de octubre · 18:00 · Clase grupal (2/8)", false],
      ["Sábado 17 de octubre · 18:00 · Clase individual (1/1) · completa", true],
    ])
    let resolve!: (r: BookForStudentResult) => void
    const book = vi
      .spyOn(admin, "bookForStudent")
      .mockResolvedValueOnce({ ok: false, code: "no_valid_credit" })
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    fireEvent.click(dialog.getByRole("button", { name: "Reservar" }))
    expect((await dialog.findByRole("alert")).textContent).toBe(
      "No tiene un pack con clases disponibles para esa fecha. Cargale un pack primero.",
    )
    fireEvent.click(dialog.getByRole("button", { name: "Reservar" }))
    expect((dialog.getByRole("button", { name: "Reservando…" }) as HTMLButtonElement).disabled).toBe(true)
    expect(book.mock.calls[0][0]).toMatchObject({ userId: "u-ana", sessionId: "s-free" })
    expect(book.mock.calls[1][0].requestKey).toBe(book.mock.calls[0][0].requestKey)
    await act(async () => resolve({ ok: true, bookingId: "b-new", replayed: false, remainingCredits: 2 }))
    expect(await screen.findByText("Reserva hecha. Le quedan 2 clases disponibles.")).toBeTruthy()
  })

  it("cancels on behalf; the refund is on by default and can be turned off", async () => {
    const { admin } = setup()
    await ready()
    const cancel = vi.spyOn(admin, "cancelForStudent")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar la reserva del Jueves 15 de octubre · 18:00" }))
    const dialog = within(await screen.findByRole("dialog", { name: "¿Cancelar esta reserva?" }))
    expect(dialog.getByText(/el plazo de cancelación no aplica/)).toBeTruthy()
    const refund = dialog.getByRole("checkbox", { name: "Devolver la clase a su pack" }) as HTMLInputElement
    expect(refund.checked).toBe(true)
    fireEvent.click(refund)
    fireEvent.click(dialog.getByRole("button", { name: "Sí, cancelar reserva" }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ bookingId: "b-next", refund: false }))
    expect(await screen.findByText("Reserva cancelada sin devolver la clase.")).toBeTruthy()
  })

  it("explains a refusal (attendance already marked) and offers no blind retry", async () => {
    const { admin } = setup()
    await ready()
    vi.spyOn(admin, "cancelForStudent").mockResolvedValueOnce({ ok: false, code: "cancellation_not_allowed" })
    fireEvent.click(screen.getByRole("button", { name: "Cancelar la reserva del Jueves 15 de octubre · 18:00" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.click(dialog.getByRole("button", { name: "Sí, cancelar reserva" }))
    expect((await dialog.findByRole("alert")).textContent).toBe("La asistencia ya está marcada: desmarcala antes de cancelar.")
    expect(dialog.queryByRole("button", { name: "Reintentar" })).toBeNull()
  })
})
