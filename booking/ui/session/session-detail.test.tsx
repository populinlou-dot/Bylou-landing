import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { BookingRepository } from "../../application"
import { TEST_USER, availabilityAt, fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { SessionDetailContainer } from "./session-detail-container"

// A stable router, like Next's (effects depend on it).
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

const clock = fixedClock("2026-10-14T15:00:00.000Z")
const repository = fakeRepository([
  availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", classTypeId: "ct-grupal", confirmed: 3 }),
])

function renderDetail(id: string | null) {
  return render(
    <BookingProvider brand={bylouBrand} runtime={{ status: "ready", repository, clock, isDemo: true, auth: fakeAuth(null) }}>
      <SessionDetailContainer id={id} />
    </BookingProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderSignedIn(id: string, repo: BookingRepository) {
  return render(
    <BookingProvider brand={bylouBrand} runtime={{ status: "ready", repository: repo, clock, isDemo: true, auth: fakeAuth(TEST_USER) }}>
      <SessionDetailContainer id={id} />
    </BookingProvider>,
  )
}

describe("SessionDetailContainer", () => {
  it("renders a known session with time in the studio timezone", async () => {
    renderDetail("grupal-free")
    expect(await screen.findByRole("heading", { level: 1, name: "Clase grupal" })).toBeTruthy()
    expect(screen.getByText("Viernes 16 de octubre")).toBeTruthy()
    expect(screen.getByText("19:00 – 20:00")).toBeTruthy()
    expect(screen.getByText("Quedan 5 lugares")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reservar" }).getAttribute("aria-disabled")).toBeNull()
    // next/link drops the trailing slash outside a trailingSlash build; the export keeps it.
    expect(screen.getByRole("link", { name: "Volver a la agenda" }).getAttribute("href")).toMatch(/^\/reservas\/?$/)
  })

  it.each([null, "", "no-such-session", "../../etc"])("shows not-found for id %j", async (id) => {
    renderDetail(id)
    expect(await screen.findByRole("heading", { level: 1, name: "No encontramos esta clase." })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Volver a la agenda" })).toBeTruthy()
  })

  it("a past session the student attended reads 'Finalizada' + 'Asististe', with no booking CTA or note", async () => {
    renderSignedIn(
      "past",
      fakeRepository([availabilityAt("2026-10-13T13:00:00.000Z", { id: "past", myBookingId: "b1", myAttendance: "attended" })]),
    )
    expect(await screen.findByRole("heading", { level: 1, name: "Clase grupal" })).toBeTruthy()
    expect(screen.getByText("Finalizada")).toBeTruthy()
    expect(screen.getByText("Asististe")).toBeTruthy()
    expect(screen.queryByText("Ya tenés esta clase reservada.")).toBeNull()
    expect(screen.queryByRole("button", { name: "Reservar" })).toBeNull()
  })

  it("re-reads the session from the repository right after booking", async () => {
    const item = availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", confirmed: 3 })
    const repo = fakeRepository([item])
    vi.spyOn(repo, "book").mockImplementation(async () => {
      item.confirmedCount += 1
      item.myBookingId = "b-new"
      item.myAttendance = "unknown"
      return { ok: true, bookingId: "b-new", replayed: false, remainingCredits: 2 }
    })
    renderSignedIn("grupal-free", repo)
    fireEvent.click(await screen.findByRole("button", { name: "Reservar" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Usás 1 de tus 3 clases.")
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reserva" })))

    expect(await screen.findByRole("dialog", { name: "¡Listo! Tu clase quedó reservada." })).toBeTruthy()
    await waitFor(() => expect(screen.getByText("Quedan 4 lugares")).toBeTruthy())
    expect(screen.getByText("Ya tenés esta clase reservada.")).toBeTruthy()
    expect(repo.calls.filter((c) => c === "getSession grupal-free")).toHaveLength(2)
  })
})
