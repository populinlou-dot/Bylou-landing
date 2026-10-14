import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { BookingRepository, MyBooking } from "../../application"
import { CLASS_TYPES, availabilityAt, fakeAuth, fakeRepository, fixedClock, myWaitlistEntry } from "../../application/test-support"
import type { StudioRules } from "../../domain"
import { BookingProvider } from "../booking-context"
import { MyBookingsContainer } from "./my-bookings-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock = fixedClock(NOW)
const BYLOU_RULES: StudioRules = { ...bylouBrand.rules }

function myBooking(id: string, startsAt: string, extra: Partial<MyBooking> = {}): MyBooking {
  const { session } = availabilityAt(startsAt, { id: `s-${id}` })
  return {
    booking: {
      id,
      sessionId: session.id,
      userId: "user-1",
      status: "confirmed",
      attendance: "unknown",
      idempotencyKey: `k-${id}`,
      creditGrantId: "g-1",
      createdAt: "2026-10-10T12:00:00.000Z",
    },
    session,
    classType: CLASS_TYPES[1],
    instructorName: "Lou",
    refunded: false,
    source: "student",
    privateDetails: null,
    ...extra,
  }
}

const SOON = myBooking("b-soon", "2026-10-15T01:00:00.000Z", {
  privateDetails: { meetingUrl: "https://meet.example.test/room", address: null, instructions: null },
}) // in 10 h
const FAR = myBooking("b-far", "2026-10-17T13:00:00.000Z") // in 70 h

function renderMine(repository: BookingRepository, signedIn = true) {
  return render(
    <BookingProvider
      brand={bylouBrand}
      runtime={{ status: "ready", repository, clock, isDemo: true, auth: fakeAuth(signedIn ? undefined : null) }}
    >
      <MyBookingsContainer />
    </BookingProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Mis reservas", () => {
  it("asks signed-out visitors to sign in and comes back here", async () => {
    renderMine(fakeRepository([]), false)
    expect(await screen.findByRole("heading", { name: "Entrá con tu mail para ver tus reservas." })).toBeTruthy()
    // next/link drops the trailing slash outside a trailingSlash build; the export keeps it.
    expect(screen.getByRole("link", { name: "Ingresar" }).getAttribute("href")).toMatch(
      new RegExp(`^/reservas/ingresar/?\\?returnTo=${encodeURIComponent("/reservas/mis-reservas/")}$`),
    )
  })

  it("shows the pack balance and the meeting link of a booked online class", async () => {
    renderMine(fakeRepository([], { rules: BYLOU_RULES, myBookings: [FAR, SOON] }))
    expect(await screen.findByText("Te quedan 3 clases disponibles.")).toBeTruthy()
    expect(screen.getByText("Vence el 12 de noviembre.")).toBeTruthy()
    const cards = screen.getAllByRole("article")
    expect(cards).toHaveLength(2)
    // Soonest first.
    expect(within(cards[0]).getByRole("link", { name: "Entrar a la clase" }).getAttribute("href")).toBe(
      "https://meet.example.test/room",
    )
  })

  it("inside 24 h (Bylou deny): no cancel button, contact Lou instead", async () => {
    renderMine(fakeRepository([], { rules: BYLOU_RULES, myBookings: [SOON] }))
    const card = await screen.findByRole("article")
    expect(within(card).queryByRole("button", { name: "Cancelar reserva" })).toBeNull()
    expect(
      within(card).getByText("Ya no se puede cancelar online: faltan menos de 24 h. Si te surgió algo, escribile a Lou."),
    ).toBeTruthy()
    expect(within(card).getByRole("link", { name: "Escribile a Lou" }).getAttribute("href")).toBe("https://ig.me/m/bylou.yoga")
  })

  it("outside the window: confirms in a dialog, cancels with an idempotency key and announces the refund", async () => {
    const repository = fakeRepository([], { rules: BYLOU_RULES, myBookings: [FAR] })
    const cancel = vi.spyOn(repository, "cancel")
    renderMine(repository)
    const card = await screen.findByRole("article")
    fireEvent.click(within(card).getByRole("button", { name: "Cancelar reserva" }))

    const dialog = await screen.findByRole("dialog", { name: "¿Cancelar esta reserva?" })
    expect(within(dialog).getByText("La clase vuelve a tu pack.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, cancelar" }))

    expect(await screen.findByText("Reserva cancelada. La clase volvió a tu pack.")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(cancel).toHaveBeenCalledWith({ bookingId: "b-far", idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/), acceptLate: false })
  })

  it("re-reads my bookings from the repository after a cancellation (no optimistic update)", async () => {
    const repository = fakeRepository([], { rules: BYLOU_RULES, myBookings: [FAR] })
    const cancelled: MyBooking = { ...FAR, booking: { ...FAR.booking, status: "cancelled" }, refunded: true }
    const list = vi.spyOn(repository, "listMyBookings").mockResolvedValueOnce([FAR]).mockResolvedValueOnce([cancelled])
    renderMine(repository)
    const card = await screen.findByRole("article")
    fireEvent.click(within(card).getByRole("button", { name: "Cancelar reserva" }))
    const dialog = await screen.findByRole("dialog", { name: "¿Cancelar esta reserva?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, cancelar" }))

    expect(await screen.findByText("Reserva cancelada. La clase volvió a tu pack.")).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
    expect(await screen.findByText("Todavía no tenés clases reservadas.")).toBeTruthy()
  })

  it("shows the contact copy when the server denies a late cancellation", async () => {
    const repository = fakeRepository([], { rules: BYLOU_RULES, myBookings: [FAR] })
    vi.spyOn(repository, "cancel").mockResolvedValue({ ok: false, code: "cancellation_too_late" })
    renderMine(repository)
    fireEvent.click(within(await screen.findByRole("article")).getByRole("button", { name: "Cancelar reserva" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, cancelar" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Ya no se puede cancelar online")
    expect(within(dialog).queryByRole("button", { name: /Sí, cancelar|Reintentar/ })).toBeNull()
  })

  it("lists past bookings in the history with their outcome", async () => {
    const past = myBooking("b-past", "2026-10-10T13:00:00.000Z", {
      booking: { ...myBooking("b-past", "2026-10-10T13:00:00.000Z").booking, attendance: "attended" },
    })
    renderMine(fakeRepository([], { rules: BYLOU_RULES, myBookings: [past] }))
    const history = await screen.findByRole("region", { name: "Historial" })
    expect(within(history).getByText("Asististe")).toBeTruthy()
    expect(screen.getByText("Todavía no tenés clases reservadas.")).toBeTruthy()
  })
})

describe("Mis reservas: waitlist (Phase 4.4)", () => {
  const FULL = availabilityAt("2026-10-18T13:00:00.000Z", { id: "s-full", capacity: 2, confirmed: 2 }).session

  it("marks a booking that came from the waitlist", async () => {
    const promoted = myBooking("b-w", "2026-10-17T13:00:00.000Z", { source: "waitlist" })
    renderMine(fakeRepository([], { rules: BYLOU_RULES, myBookings: [promoted] }))
    const card = (await screen.findAllByRole("article"))[0]
    expect(within(card).getByText("¡Se liberó un lugar! Tu clase quedó reservada.")).toBeTruthy()
  })

  it("lists the classes she waits for with her place, and lets her leave", async () => {
    const repository = fakeRepository([], {
      rules: BYLOU_RULES,
      waitlist: [
        myWaitlistEntry(FULL, { entryId: "w-1", position: 2 }),
        myWaitlistEntry(FAR.session, { entryId: "w-2", status: "skipped", skipReason: "no_valid_credit", position: null }),
      ],
    })
    const leave = vi.spyOn(repository, "leaveWaitlist")
    renderMine(repository)
    const section = await screen.findByRole("region", { name: "Lista de espera" })
    const cards = within(section).getAllByRole("article")
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText(/no tenías un pack vigente/)).toBeTruthy()
    expect(within(cards[1]).getByText("Estás en la lista de espera · lugar 2")).toBeTruthy()
    await act(async () => fireEvent.click(within(cards[1]).getByRole("button", { name: "Salir de la lista" })))
    expect(leave).toHaveBeenCalledWith("s-full")
    expect(await screen.findByText("Saliste de la lista de espera.")).toBeTruthy()
  })
})
