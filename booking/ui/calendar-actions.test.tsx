import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../brands/bylou"
import { demoStudioBrand } from "../../brands/demo-studio"
import { toAgendaEntry, type BookingRepository, type MyBooking } from "../application"
import { BA_RULES, CLASS_TYPES, availabilityAt, fakeAuth, fakeRepository, fixedClock } from "../application/test-support"
import type { BrandConfig } from "../theme"
import { BookingProvider } from "./booking-context"
import { CalendarActions } from "./calendar-actions"
import { MyBookingsContainer } from "./mine/my-bookings-container"
import { ReserveAction } from "./reserve/reserve-action"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock = fixedClock(NOW)
const MEETING = "https://meet.example.test/room"
const TZ = BA_RULES.timezone

/** Saturday 17 at 23:30 Buenos Aires = Sunday 18 02:30 UTC. */
const LATE = availabilityAt("2026-10-18T02:30:00.000Z", { id: "s-late", modality: "online" })

function wrap(brand: BrandConfig, repository: BookingRepository, children: ReactNode) {
  return render(
    <BookingProvider brand={brand} runtime={{ status: "ready", repository, clock, isDemo: true, auth: fakeAuth() }}>
      {children}
    </BookingProvider>,
  )
}

/** Captures what the download button hands to the browser. */
function captureDownloads() {
  const files: { name: string; blob: Blob }[] = []
  let lastBlob: Blob | null = null
  URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob
    return "blob:calendar"
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (this.href.startsWith("blob:") && lastBlob) files.push({ name: this.download, blob: lastBlob })
  })
  return files
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("CalendarActions", () => {
  it("offers an .ics download and a Google Calendar link, named and grouped", async () => {
    const files = captureDownloads()
    wrap(
      bylouBrand,
      fakeRepository([]),
      <CalendarActions
        session={LATE.session}
        classTypeName="Clase grupal"
        instructorName="Lou"
        privateDetails={{ meetingUrl: MEETING, address: null, instructions: null }}
        timezone={TZ}
      />,
    )
    const group = screen.getByRole("group", { name: "Agregar al calendario" })
    const google = within(group).getByRole("link", { name: "Google Calendar (se abre en otra pestaña)" })
    expect(google.getAttribute("target")).toBe("_blank")
    expect(google.getAttribute("rel")).toBe("noopener noreferrer")
    const href = new URL(google.getAttribute("href") ?? "")
    expect(href.origin + href.pathname).toBe("https://calendar.google.com/calendar/render")
    expect(href.searchParams.get("action")).toBe("TEMPLATE")
    expect(href.searchParams.get("text")).toBe("Clase grupal · Yoga ByLou")
    expect(href.searchParams.get("dates")).toBe("20261018T023000Z/20261018T033000Z")
    expect(href.searchParams.get("details")).toContain(`Link para entrar a la clase: ${MEETING}`)

    fireEvent.click(within(group).getByRole("button", { name: "Descargar evento (.ics)" }))
    expect(files).toHaveLength(1)
    // Named after the studio-timezone day (Saturday 17), not the UTC one.
    expect(files[0].name).toBe("clase-grupal-2026-10-17.ics")
    expect(files[0].blob.type).toBe("text/calendar;charset=utf-8")
    const ics = await readBlob(files[0].blob)
    expect(ics).toContain("BEGIN:VEVENT\r\n")
    expect(ics).toContain("UID:session-s-late@bylou.com.ar\r\n")
    expect(ics).toContain("DTSTAMP:20261014T150000Z\r\n")
    expect(ics).toContain("DTSTART:20261018T023000Z\r\n")
    expect(ics).toContain(`URL:${MEETING}\r\n`)
  })

  it("speaks the demo-studio copy and identifies events by its own domain", async () => {
    const files = captureDownloads()
    wrap(
      demoStudioBrand,
      fakeRepository([]),
      <CalendarActions session={LATE.session} classTypeName="Yoga" instructorName={null} privateDetails={null} timezone={TZ} />,
    )
    const group = screen.getByRole("group", { name: demoStudioBrand.copy["success.calendar"] })
    fireEvent.click(within(group).getByRole("button", { name: demoStudioBrand.copy["calendar.ics"] }))
    const ics = await readBlob(files[0].blob)
    expect(ics).toContain("UID:session-s-late@estudio-demo.example\r\n")
    expect(ics).toContain("SUMMARY:Yoga · Estudio Demo (ficticio)\r\n")
    expect(ics).not.toMatch(/bylou/i)
    expect(ics).not.toContain("URL:")
  })
})

describe("Add to calendar in Mis reservas and after booking", () => {
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

  it("shows the actions on upcoming bookings only, told apart by the class name", async () => {
    const upcoming = myBooking("b-up", "2026-10-17T13:00:00.000Z", {
      privateDetails: { meetingUrl: MEETING, address: null, instructions: null },
    })
    const finished = myBooking("b-past", "2026-10-12T22:00:00.000Z")
    finished.booking = { ...finished.booking, attendance: "attended" }
    const cancelled = myBooking("b-gone", "2026-10-18T13:00:00.000Z")
    cancelled.booking = { ...cancelled.booking, status: "cancelled" }
    wrap(bylouBrand, fakeRepository([], { rules: BA_RULES, myBookings: [upcoming, finished, cancelled] }), <MyBookingsContainer />)

    const upcomingCard = (await screen.findAllByRole("article"))[0]
    const group = within(upcomingCard).getByRole("group", { name: "Agregar al calendario" })
    const download = within(group).getByRole("button", { name: "Descargar evento (.ics)" })
    expect(download.getAttribute("aria-describedby")).toBe(within(upcomingCard).getByRole("heading").id)
    const google = within(group).getByRole("link", { name: /Google Calendar/ })
    expect(new URL(google.getAttribute("href") ?? "").searchParams.get("details")).toContain(MEETING)

    const history = screen.getByRole("region", { name: "Historial" })
    expect(within(history).getAllByRole("article")).toHaveLength(2)
    expect(within(history).queryByRole("group", { name: "Agregar al calendario" })).toBeNull()
  })

  it("appears on the booking confirmation with the details shared once she is booked", async () => {
    const item = availabilityAt("2026-10-16T22:00:00.000Z", { id: "grupal-free", confirmed: 3 })
    const repository = fakeRepository([item], { privateDetails: { "grupal-free": { meetingUrl: MEETING, address: null, instructions: null } } })
    const details = vi.spyOn(repository, "getSessionPrivateDetails")
    wrap(bylouBrand, repository, <ReserveAction entry={toAgendaEntry(item, BA_RULES, new Date(NOW))} timezone={TZ} />)

    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
    const sheet = await screen.findByRole("dialog", { name: "Clase grupal" })
    expect(within(sheet).queryByRole("group", { name: "Agregar al calendario" })).toBeNull()
    expect(details).not.toHaveBeenCalled() // never asked before she holds the booking
    fireEvent.click(await within(sheet).findByRole("button", { name: "Confirmar reserva" }))

    const success = await screen.findByRole("dialog", { name: "¡Listo! Tu clase quedó reservada." })
    const group = within(success).getByRole("group", { name: "Agregar al calendario" })
    expect(within(group).getByRole("button", { name: "Descargar evento (.ics)" })).toBeTruthy()
    const google = within(group).getByRole("link", { name: /Google Calendar/ })
    await waitFor(() => expect(google.getAttribute("href")).toContain(encodeURIComponent(MEETING)))
    expect(details).toHaveBeenCalledWith("grupal-free")
  })
})
