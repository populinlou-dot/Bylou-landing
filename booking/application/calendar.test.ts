import { describe, expect, it } from "vitest"
import {
  bookingCalendarEvent,
  buildIcs,
  calendarEventUid,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  icsFileName,
  toCalendarUtc,
  type BookingCalendarInput,
  type CalendarEvent,
} from "./calendar"
import { zonedTimeToInstant } from "./time-zone"

const TZ = "America/Argentina/Buenos_Aires"
const BRAND = { name: "Yoga Studio", domain: "studio.example" }
const NOW = new Date("2026-10-14T12:00:00.000Z")
const MEETING = "https://meet.example.test/room?id=1&pwd=x"

function input(patch: Partial<BookingCalendarInput> = {}): BookingCalendarInput {
  return {
    session: {
      id: "s-1",
      startsAt: "2026-10-17T13:00:00.000Z",
      endsAt: "2026-10-17T14:00:00.000Z",
      modality: "online",
    },
    className: "Clase grupal",
    brand: BRAND,
    booked: true,
    privateDetails: { meetingUrl: MEETING, address: null, instructions: "Traé tu mat." },
    labels: { modality: "Online", instructor: "Con Lou", meetingLine: (url) => `Link: ${url}` },
    ...patch,
  }
}

/** Unfolds the file into logical content lines (no unescaping). */
function contentLines(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n")
}

describe("toCalendarUtc", () => {
  it("formats an instant as UTC basic format", () => {
    expect(toCalendarUtc("2026-10-17T13:05:09.000Z")).toBe("20261017T130509Z")
    expect(toCalendarUtc(new Date(Date.UTC(2027, 0, 2, 3, 4, 5)))).toBe("20270102T030405Z")
  })

  it("puts a Buenos Aires class near midnight on the next UTC day", () => {
    const start = zonedTimeToInstant("2026-10-14", "23:30", TZ)
    const end = zonedTimeToInstant("2026-10-15", "00:30", TZ)
    expect(toCalendarUtc(start)).toBe("20261015T023000Z")
    expect(toCalendarUtc(end)).toBe("20261015T033000Z")
  })

  it("rejects an invalid instant", () => {
    expect(() => toCalendarUtc("not a date")).toThrow(RangeError)
  })
})

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and every kind of line break", () => {
    expect(escapeIcsText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d")
    expect(escapeIcsText("one\r\ntwo\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour")
  })

  it("drops control characters but keeps tabs and accents", () => {
    expect(escapeIcsText("Me\u0000di\u0007ta\u007fción\tok")).toBe("Meditación\tok")
  })
})

describe("foldIcsLine", () => {
  it("leaves lines of up to 75 octets alone", () => {
    const line = "X".repeat(75)
    expect(foldIcsLine(line)).toBe(line)
  })

  it("folds at 75 octets with CRLF + space, continuation lines included", () => {
    const folded = foldIcsLine("A".repeat(200))
    const parts = folded.split("\r\n")
    expect(parts.length).toBe(3)
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    expect(parts[1].startsWith(" ")).toBe(true)
    expect(folded.replace(/\r\n /g, "")).toBe("A".repeat(200))
  })

  it("never splits a multi-byte character", () => {
    const line = `SUMMARY:${"ñ".repeat(60)}🧘${"á".repeat(40)}`
    const parts = foldIcsLine(line).split("\r\n")
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
      expect(part).not.toContain("�")
    }
    expect(foldIcsLine(line).replace(/\r\n /g, "")).toBe(line)
  })
})

describe("calendarEventUid", () => {
  it("is stable for the same session and brand, distinct across sessions and brands", () => {
    expect(calendarEventUid("s-1", "studio.example")).toBe("session-s-1@studio.example")
    expect(calendarEventUid("s-1", "studio.example")).toBe(calendarEventUid("s-1", "studio.example"))
    expect(calendarEventUid("s-2", "studio.example")).not.toBe(calendarEventUid("s-1", "studio.example"))
    expect(calendarEventUid("s-1", "other.example")).not.toBe(calendarEventUid("s-1", "studio.example"))
  })

  it("refuses ids or domains that could break the property", () => {
    expect(() => calendarEventUid("s-1\r\nX-EVIL:1", "studio.example")).toThrow(RangeError)
    expect(() => calendarEventUid("s-1", "https://studio.example")).toThrow(RangeError)
  })
})

describe("bookingCalendarEvent", () => {
  it("builds title, times, description and the meeting link for her own online booking", () => {
    const event = bookingCalendarEvent(input())
    expect(event).toEqual({
      uid: "session-s-1@studio.example",
      title: "Clase grupal · Yoga Studio",
      startsAt: "2026-10-17T13:00:00.000Z",
      endsAt: "2026-10-17T14:00:00.000Z",
      location: null,
      description: `Online\nCon Lou\nLink: ${MEETING}\nTraé tu mat.`,
      url: MEETING,
    })
  })

  it("never includes the meeting link, address or instructions when she is not booked", () => {
    const event = bookingCalendarEvent(
      input({
        booked: false,
        privateDetails: { meetingUrl: MEETING, address: "Calle 1", instructions: "Secret" },
      }),
    )
    expect(event.url).toBeNull()
    expect(event.description).toBe("Online\nCon Lou")
    const ics = buildIcs(event, { now: NOW, brand: BRAND })
    expect(ics).not.toContain("meet.example.test")
    expect(ics).not.toContain("Secret")
    expect(googleCalendarUrl(event)).not.toContain("meet.example")
  })

  it("leaves the link out when the backend shared no details", () => {
    const event = bookingCalendarEvent(input({ privateDetails: null }))
    expect(event.url).toBeNull()
    expect(event.description).toBe("Online\nCon Lou")
  })

  it("refuses a non-https meeting link", () => {
    const event = bookingCalendarEvent(
      input({ privateDetails: { meetingUrl: "javascript:alert(1)", address: null, instructions: null } }),
    )
    expect(event.url).toBeNull()
    expect(event.description).not.toContain("javascript")
  })

  it("uses the address as LOCATION for an in-person class, the modality label without one", () => {
    const session = { ...input().session, modality: "in_person" as const }
    const labels = { ...input().labels, modality: "Presencial" }
    const withAddress = bookingCalendarEvent(
      input({ session, labels, privateDetails: { meetingUrl: MEETING, address: "Calle Falsa 123", instructions: null } }),
    )
    expect(withAddress.location).toBe("Calle Falsa 123")
    expect(withAddress.url).toBeNull() // a meeting link on an in-person class is ignored
    expect(bookingCalendarEvent(input({ session, labels, privateDetails: null })).location).toBe("Presencial")
  })
})

describe("buildIcs", () => {
  const event = bookingCalendarEvent(input())
  const ics = buildIcs(event, { now: NOW, brand: BRAND })

  it("uses CRLF line endings only and ends with one", () => {
    expect(ics.endsWith("\r\n")).toBe(true)
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/)
  })

  it("keeps every physical line within 75 octets", () => {
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })

  it("has the calendar envelope and one event with UTC instants", () => {
    const lines = contentLines(ics)
    expect(lines.slice(0, 6)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//studio.example//Booking//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
    ])
    expect(lines).toContain("UID:session-s-1@studio.example")
    expect(lines).toContain("DTSTAMP:20261014T120000Z")
    expect(lines).toContain("DTSTART:20261017T130000Z")
    expect(lines).toContain("DTEND:20261017T140000Z")
    expect(lines).toContain("SUMMARY:Clase grupal · Yoga Studio")
    expect(lines).toContain(`DESCRIPTION:Online\\nCon Lou\\nLink: ${MEETING}\\nTraé tu mat.`)
    expect(lines).toContain(`URL:${MEETING}`)
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1)
    expect(lines.slice(-3)).toEqual(["END:VEVENT", "END:VCALENDAR", ""])
    expect(lines.some((l) => l.startsWith("LOCATION:"))).toBe(false)
  })

  it("escapes text values and cannot be injected through them", () => {
    const tricky: CalendarEvent = {
      ...event,
      title: "Yoga, flow; calm\\deep",
      location: "Av. 1, piso 2\nDepto B",
      description: "Hi\r\nEND:VEVENT\r\nBEGIN:VEVENT",
      url: "https://x.example/a b",
    }
    const lines = contentLines(buildIcs(tricky, { now: NOW, brand: BRAND }))
    expect(lines).toContain("SUMMARY:Yoga\\, flow\\; calm\\\\deep")
    expect(lines).toContain("LOCATION:Av. 1\\, piso 2\\nDepto B")
    expect(lines).toContain("DESCRIPTION:Hi\\nEND:VEVENT\\nBEGIN:VEVENT")
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1)
    expect(lines.some((l) => l.startsWith("URL:"))).toBe(false) // whitespace in a URI → dropped
  })

  it("re-exporting the same booking keeps the UID (the calendar updates instead of duplicating)", () => {
    const later = buildIcs(bookingCalendarEvent(input()), { now: new Date("2026-10-15T00:00:00Z"), brand: BRAND })
    const uid = (text: string) => contentLines(text).find((l) => l.startsWith("UID:"))
    expect(uid(later)).toBe(uid(ics))
  })
})

describe("googleCalendarUrl", () => {
  it("builds the template link with UTC dates and percent-encoded values", () => {
    const event = bookingCalendarEvent(input({ className: "Yoga & Meditación", brand: { ...BRAND, name: "A+B" } }))
    const url = googleCalendarUrl(event)
    expect(url.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE&")).toBe(true)
    expect(url).toContain("&dates=20261017T130000Z/20261017T140000Z")
    expect(url).toContain(`&text=${encodeURIComponent("Yoga & Meditación · A+B")}`)
    expect(url).not.toMatch(/text=[^&]*[ +]/) // spaces as %20, a literal "+" encoded as %2B
    const params = new URL(url).searchParams
    expect(params.get("text")).toBe("Yoga & Meditación · A+B")
    expect(params.get("details")).toBe(`Online\nCon Lou\nLink: ${MEETING}\nTraé tu mat.`)
    expect(params.get("location")).toBeNull()
  })

  it("adds the location of an in-person class", () => {
    const event = bookingCalendarEvent(
      input({
        session: { ...input().session, modality: "in_person" },
        privateDetails: { meetingUrl: null, address: "Calle Falsa 123, CABA", instructions: null },
      }),
    )
    expect(new URL(googleCalendarUrl(event)).searchParams.get("location")).toBe("Calle Falsa 123, CABA")
  })
})

describe("icsFileName", () => {
  it("reduces the class name to a safe slug and dates it in the studio timezone", () => {
    const lateNight = zonedTimeToInstant("2026-10-14", "23:30", TZ).toISOString()
    expect(icsFileName("Clase grupal", lateNight, TZ)).toBe("clase-grupal-2026-10-14.ics")
    expect(icsFileName("Meditación / Yoga: «nivel 1»", lateNight, TZ)).toBe("meditacion-yoga-nivel-1-2026-10-14.ics")
    expect(icsFileName("../../etc/passwd", lateNight, TZ)).toBe("etc-passwd-2026-10-14.ics")
    expect(icsFileName("🧘", lateNight, TZ)).toBe("event-2026-10-14.ics")
  })
})
