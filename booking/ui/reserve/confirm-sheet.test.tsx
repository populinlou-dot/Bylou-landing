import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { toAgendaEntry, type BookResult, type BookingRepository } from "../../application"
import { BA_RULES, DEFAULT_BALANCE, availabilityAt, fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { ReserveAction } from "./reserve-action"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

const NOW = "2026-10-14T15:00:00.000Z"
const clock = fixedClock(NOW)
const item = availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", confirmed: 3 })
const entry = toAgendaEntry(item, BA_RULES, new Date(NOW))

function renderAction(repository: BookingRepository, signedIn = true) {
  return render(
    <BookingProvider
      brand={bylouBrand}
      runtime={{ status: "ready", repository, clock, isDemo: true, auth: fakeAuth(signedIn ? undefined : null) }}
    >
      <ReserveAction entry={entry} timezone={BA_RULES.timezone} />
    </BookingProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  router.push.mockClear()
})

describe("Confirm sheet", () => {
  it("is a labelled dialog showing the session, credits and policy", async () => {
    renderAction(fakeRepository([item]))
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog", { name: "Clase grupal" })
    expect(within(dialog).getByText("Viernes 16 de octubre")).toBeTruthy()
    expect(await within(dialog).findByText("Usás 1 de tus 3 clases.")).toBeTruthy()
    expect(within(dialog).getByText("Podés cancelar hasta 24 h antes.")).toBeTruthy()
    expect(within(dialog).getByText("El link aparece en Mis reservas.")).toBeTruthy()
  })

  it("disables the button while pending and retries a network error with the SAME idempotency key", async () => {
    const repository = fakeRepository([item])
    const first = deferred<BookResult>()
    const book = vi
      .spyOn(repository, "book")
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ok: true, bookingId: "b-1", replayed: true, remainingCredits: 2 })
    renderAction(repository)
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Usás 1 de tus 3 clases.")

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reserva" }))
    const pending = await within(dialog).findByRole("button", { name: "Reservando…" })
    expect((pending as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByRole("status").textContent).toBe("Reservando…")
    fireEvent.click(pending) // ignored: disabled + in-flight guard
    expect(book).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve({ ok: false, code: "network_error" }))
    expect(within(dialog).getByRole("alert").textContent).toContain("No pudimos confirmar la reserva.")

    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByRole("dialog", { name: "¡Listo! Tu clase quedó reservada." })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver mis reservas" })).toBeTruthy()

    expect(book).toHaveBeenCalledTimes(2)
    const [firstKey, secondKey] = book.mock.calls.map(([cmd]) => cmd.idempotencyKey)
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(secondKey).toBe(firstKey)
    expect(book.mock.calls[0][0].sessionId).toBe("grupal-free")
  })

  it("shows the conflict copy for a full session and offers no confirm button", async () => {
    const repository = fakeRepository([item])
    vi.spyOn(repository, "book").mockResolvedValue({ ok: false, code: "session_full" })
    renderAction(repository)
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Usás 1 de tus 3 clases.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reserva" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Alguien reservó el último lugar recién.")
    expect(within(dialog).queryByRole("button", { name: /Confirmar|Reintentar/ })).toBeNull()
  })

  it("previews 'no pack' instead of a confirm button when the balance is empty", async () => {
    const repository = fakeRepository([item], { balance: { ...DEFAULT_BALANCE, available: 0, activeGrants: [] } })
    renderAction(repository)
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog")
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Para reservar necesitás un pack activo.")
    expect(within(dialog).getByRole("link", { name: "Coordiná tu pack con Lou" }).getAttribute("href")).toBe(
      "https://ig.me/m/bylou.yoga",
    )
    expect(within(dialog).queryByRole("button", { name: "Confirmar reserva" })).toBeNull()
  })

  it("closes on Escape and returns focus to 'Reservar'", async () => {
    renderAction(fakeRepository([item]))
    const trigger = screen.getByRole("button", { name: "Reservar" })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Usás 1 de tus 3 clases.")
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    // Radix restores focus on the next tick.
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("sends signed-out users to sign in with the intent preserved", async () => {
    renderAction(fakeRepository([item]), false)
    fireEvent.click(await screen.findByRole("button", { name: "Reservar" }))
    expect(router.push).toHaveBeenCalledWith(
      `/reservas/ingresar/?returnTo=${encodeURIComponent("/reservas/sesion/?id=grupal-free&reservar=1")}`,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
