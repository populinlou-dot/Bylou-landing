/**
 * "Add to calendar" (PRD ST-11), generated on the device: an RFC 5545 `.ics` file and a Google Calendar
 * template link for one booked class. Pure functions, no framework or browser APIs, so the rules
 * (UTC instants, escaping, folding, stable UID, meeting-link exclusion) are unit-tested here and the UI
 * only composes them.
 */
import type { IsoDateTime, Modality } from "../domain"
import type { SessionPrivateDetails } from "./ports"
import { localDateOf } from "./time-zone"

/** One calendar event, already translated. Every field is plain text except `url` (https only). */
export interface CalendarEvent {
  uid: string
  title: string
  startsAt: IsoDateTime
  endsAt: IsoDateTime
  location: string | null
  description: string | null
  /** Online meeting link; only ever set for her own active booking. */
  url: string | null
}

/** Brand identity used for the UID and PRODID (from the brand config, never hardcoded). */
export interface CalendarBrand {
  name: string
  /** DNS domain of the studio, e.g. "bylou.com.ar". */
  domain: string
}

export interface BookingCalendarInput {
  session: { id: string; startsAt: IsoDateTime; endsAt: IsoDateTime; modality: Modality }
  className: string
  brand: CalendarBrand
  /**
   * True only for her own confirmed booking of a class that has not finished. When false, the meeting
   * link, address and instructions are dropped even if the caller passed them (ADR-005, ST-11).
   */
  booked: boolean
  /** Attendee-only details as the backend returned them (RLS: booked students only); null when unknown. */
  privateDetails: SessionPrivateDetails | null
  /** Already translated by the UI with the brand copy. */
  labels: {
    /** Modality as the brand names it ("Presencial", "Online"). */
    modality: string
    /** e.g. "Con Lou"; null when no instructor is assigned. */
    instructor: string | null
    /** Line that introduces the meeting link, e.g. "Link para entrar: {url}" already filled. */
    meetingLine: (url: string) => string
  }
}

/** Defense in depth (the DB CHECK already requires https): no javascript:/data: links, no whitespace or controls. */
const SAFE_MEETING_URL = /^https:\/\/[^\s\u0000-\u001f\u007f]+$/i
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const UID_TOKEN = /^[A-Za-z0-9_-]{1,100}$/

export function isSafeMeetingUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && SAFE_MEETING_URL.test(url)
}

/**
 * Stable per session and brand: re-importing the file (or adding it again from the other screen)
 * updates the same event instead of duplicating it. One active booking per student per session.
 */
export function calendarEventUid(sessionId: string, domain: string): string {
  if (!UID_TOKEN.test(sessionId)) throw new RangeError(`Invalid session id for a calendar UID: ${sessionId}`)
  if (!DOMAIN.test(domain)) throw new RangeError(`Invalid brand domain: ${domain}`)
  return `session-${sessionId}@${domain}`
}

/** The event for one booking, applying the attendee-only rule for the meeting link, address and instructions. */
export function bookingCalendarEvent(input: BookingCalendarInput): CalendarEvent {
  const { session, labels } = input
  const details = input.booked ? input.privateDetails : null
  const online = session.modality === "online"
  const candidateUrl = details?.meetingUrl ?? null
  const meetingUrl = online && isSafeMeetingUrl(candidateUrl) ? candidateUrl : null
  const address = !online ? cleanLine(details?.address) : null
  const instructions = cleanLine(details?.instructions)

  const lines = [
    labels.modality,
    labels.instructor,
    meetingUrl ? labels.meetingLine(meetingUrl) : null,
    instructions,
  ].filter((line): line is string => Boolean(line && line.trim()))

  return {
    uid: calendarEventUid(session.id, input.brand.domain),
    title: `${input.className.trim()} · ${input.brand.name.trim()}`,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    location: online ? null : (address ?? labels.modality),
    description: lines.length > 0 ? lines.join("\n") : null,
    url: meetingUrl,
  }
}

function cleanLine(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** UTC basic format used by iCalendar and Google: "YYYYMMDDTHHMMSSZ". */
export function toCalendarUtc(instant: IsoDateTime | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant
  const ms = date.getTime()
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant: ${String(instant)}`)
  const d = new Date(ms)
  const pad = (n: number, width = 2) => String(n).padStart(width, "0")
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

// C0 controls except TAB / LF / CR, plus DEL: not allowed in iCalendar TEXT (RFC 5545 §3.3.11).
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks (as "\n"). */
export function escapeIcsText(value: string): string {
  return value
    .replace(CONTROL_CHARS, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

const MAX_LINE_OCTETS = 75

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * Folds one content line at 75 octets (UTF-8), never splitting a character; continuation lines start
 * with a single space, which counts toward their 75 (RFC 5545 §3.1). Returns the lines joined with CRLF.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = []
  let current = ""
  let octets = 0
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0) ?? 0)
    if (octets + size > MAX_LINE_OCTETS) {
      parts.push(current)
      current = " "
      octets = 1
    }
    current += char
    octets += size
  }
  parts.push(current)
  return parts.join("\r\n")
}

/** A complete VCALENDAR (one VEVENT, METHOD:PUBLISH) with CRLF line endings. */
export function buildIcs(event: CalendarEvent, options: { now: Date; brand: CalendarBrand }): string {
  if (!DOMAIN.test(options.brand.domain)) throw new RangeError(`Invalid brand domain: ${options.brand.domain}`)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${options.brand.domain}//Booking//ES`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${toCalendarUtc(options.now)}`,
    `DTSTART:${toCalendarUtc(event.startsAt)}`,
    `DTEND:${toCalendarUtc(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
    event.description ? `DESCRIPTION:${escapeIcsText(event.description)}` : null,
    // URI value: not TEXT-escaped, so only a vetted https link without whitespace ever gets here.
    isSafeMeetingUrl(event.url) ? `URL:${event.url}` : null,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null)
  return lines.map(foldIcsLine).join("\r\n") + "\r\n"
}

/**
 * Google Calendar "create event" template. Instants in UTC ("Z"), every value percent-encoded
 * (spaces as %20, never "+"); the meeting link travels inside `details` only when the event carries it.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const details = [event.description, event.url && !event.description?.includes(event.url) ? event.url : null]
    .filter(Boolean)
    .join("\n")
  const params: [string, string][] = [
    ["action", "TEMPLATE"],
    ["text", event.title],
    ["dates", `${toCalendarUtc(event.startsAt)}/${toCalendarUtc(event.endsAt)}`],
  ]
  if (details) params.push(["details", details])
  if (event.location) params.push(["location", event.location])
  const query = params
    .map(([key, value]) => (key === "dates" ? `${key}=${value}` : `${key}=${encodeURIComponent(value)}`))
    .join("&")
  return `https://calendar.google.com/calendar/render?${query}`
}

/**
 * Download name: "<class>-<YYYY-MM-DD>.ics" with the class name reduced to ASCII letters, digits and
 * dashes (no path separators, quotes or reserved characters), the date in the studio timezone.
 */
export function icsFileName(className: string, startsAt: IsoDateTime, timeZone: string): string {
  const slug = className
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
  return `${slug || "event"}-${localDateOf(startsAt, timeZone)}.ics`
}
