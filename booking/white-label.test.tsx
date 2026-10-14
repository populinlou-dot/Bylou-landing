import { cleanup, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../brands/bylou"
import { demoStudioBrand } from "../brands/demo-studio"
import { AdminDayContainer } from "./admin/day/admin-day-container"
import { AdminSessionContainer } from "./admin/session/admin-session-container"
import { renderAdmin } from "./admin/test-support"
import {
  CLASS_TYPES,
  TEST_USER,
  adminSessionAt,
  availabilityAt,
  fakeAdminRepository,
  fakeAuth,
  fakeRepository,
  fixedClock,
  rosterEntry,
} from "./application/test-support"
import type { BookingRepository, MyBooking } from "./application"
import type { CopyKey } from "./config"
import type { BrandConfig } from "./theme"
import { AgendaContainer } from "./ui/agenda/agenda-container"
import { BookingProvider } from "./ui/booking-context"
import { BookingShell } from "./ui/booking-shell"
import { BookingThemeScope } from "./ui/booking-theme-scope"
import { MyBookingsContainer } from "./ui/mine/my-bookings-container"
import { SessionDetailContainer } from "./ui/session/session-detail-container"
import { SignInContainer } from "./ui/sign-in/sign-in-container"

/**
 * PL-01 / Journey G at the component level: the same screens render under BOTH brands, with
 * every visible string coming from the active brand's copy and none from the other brand.
 * Expectations are derived from `brand.copy`, so one test body proves both brands.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/admin/",
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock = fixedClock(NOW)

const SESSIONS = [availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", classTypeId: "ct-grupal", confirmed: 3 })]

const MY_BOOKING: MyBooking = {
  booking: {
    id: "b-far",
    sessionId: "grupal-free",
    userId: TEST_USER.id,
    status: "confirmed",
    attendance: "unknown",
    idempotencyKey: "k-far",
    creditGrantId: "g-1",
    createdAt: "2026-10-10T12:00:00.000Z",
  },
  session: SESSIONS[0].session,
  classType: CLASS_TYPES[1],
  instructorName: "Lou",
  refunded: false,
  privateDetails: null,
}

/** Brand message with `{placeholders}` filled in. */
const msg = (brand: BrandConfig, key: CopyKey, vars: Record<string, string | number> = {}) =>
  brand.copy[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name]))

function renderStudent(brand: BrandConfig, ui: ReactNode, repository: BookingRepository = fakeRepository(SESSIONS), signedIn = false) {
  return render(
    <BookingProvider brand={brand} runtime={{ status: "ready", repository, clock, isDemo: true, auth: fakeAuth(signedIn ? TEST_USER : null) }}>
      {ui}
    </BookingProvider>,
  )
}

const OTHER: Record<string, BrandConfig> = { bylou: demoStudioBrand, "demo-studio": bylouBrand }

/**
 * None of `keys` may render in the other brand's wording. Templates are checked by their literal
 * fragments (placeholders removed); fragments the active brand shares are skipped.
 */
function expectNoForeignCopy(brand: BrandConfig, keys: CopyKey[]) {
  const other = OTHER[brand.id]
  const text = document.body.textContent ?? ""
  let checked = 0
  for (const key of keys) {
    const fragments = other.copy[key]
      .split(/\{\w+\}/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 6 && !brand.copy[key].includes(part))
    for (const fragment of fragments) {
      expect(text, `${key} in ${other.id} wording`).not.toContain(fragment)
      checked++
    }
  }
  expect(checked, "at least one distinguishing fragment checked").toBeGreaterThan(0)
}

describe.each([bylouBrand, demoStudioBrand])("white-label screens under $id", (brand) => {
  it("applies the brand theme as CSS variables on the booking wrapper", () => {
    const { container } = render(
      <BookingThemeScope brand={brand}>
        <p>x</p>
      </BookingThemeScope>,
    )
    const scope = container.querySelector("[data-booking-theme]") as HTMLElement
    expect(scope.dataset.bookingTheme).toBe(brand.id)
    expect(scope.style.getPropertyValue("--primary")).toBe(brand.theme.palette.primary)
  })

  it("agenda", async () => {
    renderStudent(
      brand,
      <BookingShell>
        <AgendaContainer />
      </BookingShell>,
    )
    expect(await screen.findByRole("heading", { level: 1, name: msg(brand, "agenda.title") })).toBeTruthy()
    expect(screen.getByRole("group", { name: msg(brand, "agenda.filter") })).toBeTruthy()
    expect(screen.getByRole("link", { name: msg(brand, "mine.title") })).toBeTruthy()
    expect(screen.getByRole("note", { name: msg(brand, "demo.banner") })).toBeTruthy()
    expect(await screen.findByText(msg(brand, "session.spots.many", { n: 5 }))).toBeTruthy()
    expectNoForeignCopy(brand, ["agenda.title", "agenda.filter", "mine.title", "session.spots.many", "agenda.count.one"])
  })

  it("session detail", async () => {
    renderStudent(brand, <SessionDetailContainer id="grupal-free" />)
    expect(await screen.findByRole("heading", { level: 1, name: "Clase grupal" })).toBeTruthy()
    expect(screen.getByRole("link", { name: msg(brand, "session.back") })).toBeTruthy()
    expect(screen.getByText(msg(brand, "session.spots.many", { n: 5 }))).toBeTruthy()
    expect(screen.getByRole("button", { name: msg(brand, "session.cta") })).toBeTruthy()
    expect(screen.getByText(brand.terminology.classType.singular)).toBeTruthy()
    expectNoForeignCopy(brand, ["session.back", "session.spots.many"])
  })

  it("sign-in", async () => {
    renderStudent(brand, <SignInContainer returnTo="/reservas/" />)
    expect(await screen.findByRole("heading", { level: 1, name: msg(brand, "auth.title") })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: msg(brand, "auth.email.label") })).toBeTruthy()
    expect(screen.getByRole("button", { name: msg(brand, "auth.email.submit") })).toBeTruthy()
    expect(screen.getByText(msg(brand, "auth.intro"))).toBeTruthy()
    expectNoForeignCopy(brand, ["auth.title", "auth.email.label", "auth.email.submit", "auth.intro"])
  })

  it("mis reservas", async () => {
    renderStudent(brand, <MyBookingsContainer />, fakeRepository(SESSIONS, { myBookings: [MY_BOOKING] }), true)
    expect(await screen.findByRole("heading", { level: 1, name: msg(brand, "mine.title") })).toBeTruthy()
    const pack = await screen.findByRole("region", { name: msg(brand, "pack.title") })
    expect(within(pack).getByText(msg(brand, "pack.available.many", { n: 3 }))).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: msg(brand, "mine.upcoming") })).toBeTruthy()
    expect(screen.getByRole("button", { name: msg(brand, "cancel.cta") })).toBeTruthy()
    expectNoForeignCopy(brand, ["mine.title", "pack.title", "pack.available.many", "mine.upcoming", "cancel.cta"])
  })

  it("admin day", async () => {
    const admin = fakeAdminRepository({ sessions: [adminSessionAt("2026-10-14T22:00:00.000Z", { id: "s-today", confirmed: 2 })] })
    renderAdmin(<AdminDayContainer date={null} />, { brand, admin, auth: fakeAuth(TEST_USER) })
    expect(await screen.findByRole("link", { name: msg(brand, "admin.day.newSession") })).toBeTruthy()
    expect(screen.getByRole("link", { name: msg(brand, "admin.nav.classTypes") })).toBeTruthy()
    expect(screen.getByRole("link", { name: msg(brand, "admin.nav.students") })).toBeTruthy()
    expect(screen.getByText(msg(brand, "admin.session.occupancyLabel", { n: 2, capacity: 8 }))).toBeTruthy()
    expect(screen.getByRole("link", { name: msg(brand, "admin.session.open") })).toBeTruthy()
    expectNoForeignCopy(brand, ["admin.day.newSession", "admin.nav.classTypes", "admin.nav.students", "admin.session.open"])
  })

  it("admin roster", async () => {
    // Started 30 min ago, so attendance can be marked.
    const admin = fakeAdminRepository({
      sessions: [adminSessionAt("2026-10-14T14:30:00.000Z", { id: "s-now", confirmed: 1 })],
      roster: { "s-now": [rosterEntry("b-ana", { displayName: "Ana P." })] },
    })
    renderAdmin(<AdminSessionContainer id="s-now" />, { brand, admin, auth: fakeAuth(TEST_USER) })
    expect(await screen.findByRole("region", { name: msg(brand, "admin.roster.title") })).toBeTruthy()
    const attendance = await screen.findByRole("group", { name: msg(brand, "admin.attendance.legend", { name: "Ana P." }) })
    expect(within(attendance).getByRole("button", { name: msg(brand, "admin.attendance.attended") })).toBeTruthy()
    expect(screen.getByRole("link", { name: msg(brand, "admin.session.back") })).toBeTruthy()
    expectNoForeignCopy(brand, ["admin.roster.title", "admin.session.back", "admin.roster.confirmed"])
  })
})
