import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { availabilityAt, fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { SessionDetailContainer } from "./session-detail-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

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

afterEach(cleanup)

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
})
