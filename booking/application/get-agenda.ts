/**
 * Read-only agenda use cases (Phase 2, slice 2.1).
 * Availability is a client-side PREVIEW (ADR-005); the backend stays the authority.
 */
import { evaluateBooking, toEpochMs, type IsoDateTime, type Session, type StudioRules } from "../domain"
import type { BookingRepository, ClassTypeView, Clock, SessionAvailability, SessionPrivateDetails } from "./ports"
import { addDays, localDateOf, startOfWeek, zonedTimeToInstant, type LocalDate } from "./time-zone"

export interface AgendaDeps {
  repository: BookingRepository
  clock: Clock
}

/**
 * What a visitor can do with a session right now:
 * - available / full: bookable window open; full when no spots are left
 * - not_open / closed: outside the booking window (domain `booking_not_open` / `booking_closed`)
 * - in_progress / past: started / ended
 * - cancelled: cancelled by the studio
 */
export type SessionState = "available" | "full" | "not_open" | "closed" | "in_progress" | "past" | "cancelled"

export interface AgendaEntry {
  session: Session
  classType: ClassTypeView
  instructorName: string | null
  /** Calendar day of `session.startsAt` in the studio timezone. */
  localDate: LocalDate
  durationMinutes: number
  capacity: number
  confirmedCount: number
  spotsLeft: number
  state: SessionState
  /** Current user's confirmed booking of this session (null when signed out / not booked). */
  myBookingId: string | null
}

export interface AgendaDay {
  date: LocalDate
  entries: AgendaEntry[]
}

export interface Agenda {
  timezone: string
  from: IsoDateTime
  to: IsoDateTime
  /** Instant used to derive every `state`, so the UI and the data agree. */
  now: IsoDateTime
  /** All class types (unfiltered) so the UI can render every filter chip. */
  classTypes: ClassTypeView[]
  /** Days that have at least one session after filtering, in chronological order. */
  days: AgendaDay[]
  total: number
}

export interface AgendaQuery {
  from: IsoDateTime
  to: IsoDateTime
  /** Only sessions of this class type; omitted / null = all. */
  classTypeId?: string | null
}

export async function getAgenda(deps: AgendaDeps, query: AgendaQuery): Promise<Agenda> {
  const rules = await deps.repository.getStudioRules()
  return buildAgenda(deps, query, rules)
}

export interface AgendaWeekQuery {
  /** 0 = week containing "now" in the studio timezone, -1 = previous, 1 = next. */
  weekOffset?: number
  classTypeId?: string | null
}

export interface AgendaWeek extends Agenda {
  /** Monday of the displayed week (studio timezone). */
  weekStart: LocalDate
  /** Sunday of the displayed week (studio timezone). */
  weekEnd: LocalDate
  /** Today in the studio timezone. */
  today: LocalDate
}

/** Monday 00:00 → next Monday 00:00 in the studio timezone, shifted by `weekOffset` weeks. */
export async function getAgendaWeek(deps: AgendaDeps, query: AgendaWeekQuery = {}): Promise<AgendaWeek> {
  const rules = await deps.repository.getStudioRules()
  const weekOffset = query.weekOffset ?? 0
  if (!Number.isInteger(weekOffset)) throw new RangeError(`weekOffset must be an integer: ${weekOffset}`)
  const tz = rules.timezone
  const today = localDateOf(deps.clock.now(), tz)
  const weekStart = addDays(startOfWeek(today), 7 * weekOffset)
  const nextWeekStart = addDays(weekStart, 7)
  const agenda = await buildAgenda(
    deps,
    {
      from: zonedTimeToInstant(weekStart, "00:00", tz).toISOString(),
      to: zonedTimeToInstant(nextWeekStart, "00:00", tz).toISOString(),
      classTypeId: query.classTypeId,
    },
    rules,
  )
  return { ...agenda, weekStart, weekEnd: addDays(weekStart, 6), today }
}

export interface SessionDetail {
  timezone: string
  now: IsoDateTime
  entry: AgendaEntry
  /** Meeting link / address: only when the backend returns them (booked users, ADR-005). */
  privateDetails: SessionPrivateDetails | null
}

/** Ids travel in the URL (`?id=`); reject anything that is not a plain token before hitting the repository. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID.test(id)
}

/** Detail for `/reservas/sesion/?id=`. Returns null for invalid or unknown ids (not-found state). */
export async function getSessionDetail(deps: AgendaDeps, query: { id: string | null }): Promise<SessionDetail | null> {
  if (!isValidSessionId(query.id)) return null
  const [rules, found] = await Promise.all([deps.repository.getStudioRules(), deps.repository.getSession(query.id)])
  if (!found) return null
  const now = deps.clock.now()
  // Only ask for private details when the user holds a booking; RLS decides anyway.
  const privateDetails = found.myBookingId ? await deps.repository.getSessionPrivateDetails(found.session.id) : null
  return { timezone: rules.timezone, now: now.toISOString(), entry: toAgendaEntry(found, rules, now), privateDetails }
}

async function buildAgenda(deps: AgendaDeps, query: AgendaQuery, rules: StudioRules): Promise<Agenda> {
  const fromMs = toEpochMs(query.from)
  const toMs = toEpochMs(query.to)
  if (fromMs >= toMs) throw new RangeError(`Empty agenda range: ${query.from} → ${query.to}`)

  const now = deps.clock.now()
  const [classTypes, listed] = await Promise.all([
    deps.repository.listClassTypes(),
    deps.repository.listSessions({ from: query.from, to: query.to }),
  ])

  const entries = listed
    // Defensive: adapters must honour [from, to), but a leaky one must not move sessions across weeks.
    .filter((item) => {
      const start = toEpochMs(item.session.startsAt)
      return start >= fromMs && start < toMs
    })
    .filter((item) => !query.classTypeId || item.session.classTypeId === query.classTypeId)
    .map((item) => toAgendaEntry(item, rules, now))
    .sort((a, b) => toEpochMs(a.session.startsAt) - toEpochMs(b.session.startsAt) || a.session.id.localeCompare(b.session.id))

  const byDay = new Map<LocalDate, AgendaEntry[]>()
  for (const entry of entries) {
    const day = byDay.get(entry.localDate)
    if (day) day.push(entry)
    else byDay.set(entry.localDate, [entry])
  }

  return {
    timezone: rules.timezone,
    from: query.from,
    to: query.to,
    now: now.toISOString(),
    classTypes,
    days: Array.from(byDay, ([date, dayEntries]) => ({ date, entries: dayEntries })),
    total: entries.length,
  }
}

export function toAgendaEntry(item: SessionAvailability, rules: StudioRules, now: Date): AgendaEntry {
  const { session } = item
  const spotsLeft = Math.max(0, session.capacity - item.confirmedCount)
  const startMs = toEpochMs(session.startsAt)
  const endMs = toEpochMs(session.endsAt)
  return {
    session,
    classType: item.classType,
    instructorName: item.instructorName,
    localDate: localDateOf(session.startsAt, rules.timezone),
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    capacity: session.capacity,
    confirmedCount: item.confirmedCount,
    spotsLeft,
    state: sessionState(session, spotsLeft, rules, now),
    myBookingId: item.myBookingId,
  }
}

function sessionState(session: Session, spotsLeft: number, rules: StudioRules, now: Date): SessionState {
  if (session.status === "cancelled") return "cancelled"
  const nowMs = now.getTime()
  if (nowMs >= toEpochMs(session.endsAt)) return "past"
  if (nowMs >= toEpochMs(session.startsAt)) return "in_progress"
  // Anonymous preview through the domain policy: with no bookings and no grants, the only
  // checks that can fail before `no_valid_credit` are status / start / booking window.
  const preview = evaluateBooking({ session, userId: "", sessionBookings: [], grants: [], rules, now })
  if (!preview.ok && preview.code === "booking_not_open") return "not_open"
  if (!preview.ok && preview.code === "booking_closed") return "closed"
  return spotsLeft === 0 ? "full" : "available"
}
