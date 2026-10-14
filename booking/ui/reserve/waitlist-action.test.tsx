import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { toAgendaEntry, type AgendaEntry, type BookingRepository, type JoinWaitlistResult } from "../../application"
import { BA_RULES, availabilityAt, fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { DataRefreshContext } from "./refresh-context"
import { ReserveAction } from "./reserve-action"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

const NOW = "2026-10-14T15:00:00.000Z"
const now = new Date(NOW)
const clock = fixedClock(NOW)
const full = availabilityAt("2026-10-17T13:00:00.000Z", { id: "full-far", capacity: 2, confirmed: 2 })
const joinable = toAgendaEntry(full, BA_RULES, now, { enabled: true, position: null, open: true })
const waiting = toAgendaEntry(full, BA_RULES, now, { enabled: true, position: 2, open: true })
const waitingLate = toAgendaEntry(full, BA_RULES, now, { enabled: true, position: 1, open: false })

function renderAction(entry: AgendaEntry, repository: BookingRepository, options: { signedIn?: boolean; hours?: number | null } = {}) {
  const refresh = vi.fn()
  const view = render(
    <BookingProvider
      brand={bylouBrand}
      runtime={{ status: "ready", repository, clock, isDemo: true, auth: fakeAuth(options.signedIn === false ? null : undefined) }}
    >
      <DataRefreshContext.Provider value={refresh}>
        <ReserveAction entry={entry} timezone={BA_RULES.timezone} waitlistHours={options.hours === undefined ? 24 : options.hours} />
      </DataRefreshContext.Provider>
    </BookingProvider>,
  )
  return { refresh, ...view }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  router.push.mockClear()
})

describe("Waitlist action (Phase 4.4, ST-12)", () => {
  it("offers 'Anotarme en la lista' with the owner rule on a full session", async () => {
    renderAction(joinable, fakeRepository([full]))
    const join = await screen.findByRole("button", { name: "Anotarme en la lista" })
    const rule = "Si se libera un lugar hasta 24 h antes, te pasamos a la clase por orden de llegada y usamos 1 clase de tu pack."
    expect(screen.getByText(new RegExp(`^${rule}`))).toBeTruthy()
    expect(join.getAttribute("aria-describedby")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Reservar" })).toBeNull()
  })

  it("joins once with one request key (double tap) and re-reads the session", async () => {
    const repository = fakeRepository([full])
    let resolve!: (value: JoinWaitlistResult) => void
    const join = vi.spyOn(repository, "joinWaitlist").mockImplementation(() => new Promise((r) => (resolve = r)))
    const { refresh } = renderAction(joinable, repository)
    const button = await screen.findByRole("button", { name: "Anotarme en la lista" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByRole("button", { name: "Anotándote…" })).toHaveProperty("disabled", true)
    await act(async () => resolve({ ok: true, entryId: "w1", status: "waiting", position: 2, replayed: false }))
    expect(join).toHaveBeenCalledTimes(1)
    expect(join.mock.calls[0][0]).toMatchObject({ sessionId: "full-far" })
    expect(refresh).toHaveBeenCalledWith("full-far")
  })

  it("shows her place and leaves the list", async () => {
    const repository = fakeRepository([full])
    const leave = vi.spyOn(repository, "leaveWaitlist")
    const { refresh } = renderAction(waiting, repository)
    expect(screen.getByRole("status").textContent).toBe("Estás en la lista de espera · lugar 2")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Salir de la lista" })))
    expect(leave).toHaveBeenCalledWith("full-far")
    expect(refresh).toHaveBeenCalledWith("full-far")
  })

  it("explains that nobody is promoted any more inside the window", () => {
    renderAction(waitingLate, fakeRepository([full]))
    expect(screen.getByText(/^Faltan menos de 24 h: ya no pasamos a nadie desde la lista\./)).toBeTruthy()
  })

  it("sends a signed-out visitor to sign in and back to the class", async () => {
    renderAction(joinable, fakeRepository([full]), { signedIn: false })
    fireEvent.click(await screen.findByRole("button", { name: "Anotarme en la lista" }))
    await waitFor(() => expect(router.push).toHaveBeenCalled())
    expect(router.push.mock.calls[0][0]).toContain(encodeURIComponent("/reservas/sesion/?id=full-far"))
  })

  it("asks for the required name inline when the server says profile_incomplete, then joins", async () => {
    const repository = fakeRepository([full], { displayName: null })
    const join = vi
      .spyOn(repository, "joinWaitlist")
      .mockResolvedValueOnce({ ok: false, code: "profile_incomplete" })
      .mockResolvedValueOnce({ ok: true, entryId: "w1", status: "waiting", position: 1, replayed: false })
    const update = vi.spyOn(repository, "updateMyDisplayName")
    renderAction(joinable, repository)
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Anotarme en la lista" })))
    expect(screen.getByText("Antes de reservar, contanos cómo te llamás.")).toBeTruthy()
    const input = screen.getByLabelText("Tu nombre")
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: "Ana" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar" })))
    expect(update).toHaveBeenCalledWith("Ana")
    await waitFor(() => expect(join).toHaveBeenCalledTimes(2))
    // Same attempt, same key: a retry never creates a second entry.
    expect(join.mock.calls[1][0].requestKey).toBe(join.mock.calls[0][0].requestKey)
  })

  it.each([
    ["waitlist_closed", "La lista de espera cierra 24 h antes de la clase."],
    ["session_not_full", "¡Se liberó un lugar! Ya podés reservar."],
    ["too_many_changes", "Hoy ya te anotaste varias veces en esta lista. Si querés un lugar, escribile a Lou."],
    ["waitlist_full", "La lista de espera de esta clase ya está completa."],
    ["too_many_waitlists", "Ya estás en 10 listas de espera. Salí de alguna para anotarte en esta."],
  ] as const)("explains a %s refusal", async (code, message) => {
    const repository = fakeRepository([full])
    vi.spyOn(repository, "joinWaitlist").mockResolvedValue({ ok: false, code })
    renderAction(joinable, repository)
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Anotarme en la lista" })))
    expect(within(screen.getByRole("alert")).getByText(message)).toBeTruthy()
  })
})
