/**
 * Read-only agenda use cases (Phase 2, slice 2.1).
 * Availability is a client-side PREVIEW (ADR-005); the backend stays the authority.
 */
import {
  evaluateBooking,
  isWaitlistPromotionOpen,
  toEpochMs,
  type Attendance,
  type IsoDateTime,
  type Modality,
  type Session,
  type StudioRules,
} from "../domain"
import { RepositoryError, type BookingRepository, type ClassTypeView, type Clock, type SessionAvailability, type SessionPrivateDetails } from "./ports"
import { addDays, localDateOf, startOfWeek, zonedTimeToInstant, type LocalDate } from "./time-zone"

export interface AgendaDeps {
  repository: BookingRepository
  clock: Clock
  /** Brand flag `features.waitlist` (the server enforces its own switch). Off/absent → no waitlist actions. */
  waitlist?: boolean
}

/**
 * What a visitor can do with a session right now:
 * - available / full: bookable window open; full when no spots are left
 * - not_open / closed: outside the booking window (domain `booking_not_open` / `booking_closed`)
 * - in_progress / past: started / ended
 * - cancelled: cancelled by the studio
 */
export type SessionState = "available" | "full" | "not_open" | "closed" | "in_progress" | "past" | "cancelled"

/**
 * What the current student can do with a session:
 * - book: show "Reservar"
 * - booked: an upcoming session she already holds ("Ya tenés esta clase reservada" + Mis reservas)
 * - join_waitlist: a full session she can wait for (waitlist on, more than the cancellation window ahead)
 * - waiting: she is on its waitlist (place + "Salir de la lista")
 * - none: nothing to do; the card explains why (state badge / reason / outcome)
 */
export type StudentAction = "book" | "booked" | "join_waitlist" | "waiting" | "none"

/** Waitlist facts `studentAction` needs; all off when the brand has no waitlist. */
export interface WaitlistContext {
  enabled: boolean
  /** Her 1-based place while waiting on this session; null when she is not waiting. */
  position: number | null
  /** A freed spot would still go to the list (owner rule: more than the cancellation window ahead). */
  open: boolean
}

const NO_WAITLIST: WaitlistContext = { enabled: false, position: null, open: false }

/** How the student's own booking of a started or ended session reads (Asististe / No asististe / Reservada). */
export type MyOutcome = "attended" | "absent" | "booked"

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
  /** Decided by `studentAction` (domain order); the UI renders it and never re-derives it. */
  action: StudentAction
  /** Her place on this session's waitlist while waiting; null otherwise (and when the waitlist is off). */
  myWaitlistPosition: number | null
  /** Waitlist on and a freed spot would still be promoted (false inside the cancellation window). */
  waitlistOpen: boolean
  /** Only for a started or ended session the student had booked; null otherwise. */
  myOutcome: MyOutcome | null
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
  /** Only sessions of this modality; omitted / null = all. */
  modality?: Modality | null
}

export async function getAgenda(deps: AgendaDeps, query: AgendaQuery): Promise<Agenda> {
  const rules = await deps.repository.getStudioRules()
  return buildAgenda(deps, query, rules)
}

export interface AgendaWeekQuery {
  /** 0 = week containing "now" in the studio timezone, -1 = previous, 1 = next. */
  weekOffset?: number
  classTypeId?: string | null
  modality?: Modality | null
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
      modality: query.modality,
    },
    rules,
  )
  return { ...agenda, weekStart, weekEnd: addDays(weekStart, 6), today }
}

export interface SessionDetail {
  timezone: string
  now: IsoDateTime
  /** From the studio rules: free cancellation (and waitlist promotion) stops this many hours before start. */
  cancellationWindowHours: number
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
  const [rules, found, positions] = await Promise.all([
    deps.repository.getStudioRules(),
    deps.repository.getSession(query.id),
    myWaitingPositions(deps),
  ])
  if (!found) return null
  const now = deps.clock.now()
  // Only ask for private details when the user holds a booking; RLS decides anyway.
  const privateDetails = found.myBookingId ? await deps.repository.getSessionPrivateDetails(found.session.id) : null
  return {
    timezone: rules.timezone,
    now: now.toISOString(),
    cancellationWindowHours: rules.cancellationWindowHours,
    entry: toAgendaEntry(found, rules, now, waitlistContext(deps, found, rules, now, positions)),
    privateDetails,
  }
}

async function buildAgenda(deps: AgendaDeps, query: AgendaQuery, rules: StudioRules): Promise<Agenda> {
  const fromMs = toEpochMs(query.from)
  const toMs = toEpochMs(query.to)
  if (fromMs >= toMs) throw new RangeError(`Empty agenda range: ${query.from} → ${query.to}`)

  const now = deps.clock.now()
  const [classTypes, listed, positions] = await Promise.all([
    deps.repository.listClassTypes(),
    deps.repository.listSessions({ from: query.from, to: query.to }),
    myWaitingPositions(deps),
  ])

  const entries = listed
    // Defensive: adapters must honour [from, to), but a leaky one must not move sessions across weeks.
    .filter((item) => {
      const start = toEpochMs(item.session.startsAt)
      return start >= fromMs && start < toMs
    })
    .filter((item) => !query.classTypeId || item.session.classTypeId === query.classTypeId)
    .filter((item) => !query.modality || item.session.modality === query.modality)
    .map((item) => toAgendaEntry(item, rules, now, waitlistContext(deps, item, rules, now, positions)))
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

/**
 * session id → her place, for the sessions she is waiting on. Off, signed out or a failed read → empty: the
 * waitlist is extra information and must never break the agenda (a repeated join just replays her entry).
 */
async function myWaitingPositions(deps: AgendaDeps): Promise<ReadonlyMap<string, number>> {
  if (!deps.waitlist) return new Map()
  try {
    const entries = await deps.repository.listMyWaitlist()
    return new Map(
      entries.flatMap((e) => (e.status === "waiting" && e.position !== null ? [[e.session.id, e.position] as const] : [])),
    )
  } catch (error) {
    if (!(error instanceof RepositoryError)) console.error("[booking] waitlist load failed", error)
    return new Map()
  }
}

function waitlistContext(
  deps: AgendaDeps,
  item: SessionAvailability,
  rules: StudioRules,
  now: Date,
  positions: ReadonlyMap<string, number>,
): WaitlistContext {
  if (!deps.waitlist) return NO_WAITLIST
  return {
    enabled: true,
    position: positions.get(item.session.id) ?? null,
    open: isWaitlistPromotionOpen(item.session, rules, now),
  }
}

export function toAgendaEntry(
  item: SessionAvailability,
  rules: StudioRules,
  now: Date,
  waitlist: WaitlistContext = NO_WAITLIST,
): AgendaEntry {
  const { session } = item
  const spotsLeft = Math.max(0, session.capacity - item.confirmedCount)
  const startMs = toEpochMs(session.startsAt)
  const endMs = toEpochMs(session.endsAt)
  const state = sessionState(session, spotsLeft, rules, now)
  return {
    session,
    classType: item.classType,
    instructorName: item.instructorName,
    localDate: localDateOf(session.startsAt, rules.timezone),
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    capacity: session.capacity,
    confirmedCount: item.confirmedCount,
    spotsLeft,
    state,
    myBookingId: item.myBookingId,
    action: studentAction(state, item.myBookingId, waitlist),
    myWaitlistPosition: waitlist.enabled ? waitlist.position : null,
    waitlistOpen: waitlist.enabled && waitlist.open,
    myOutcome: myOutcome(state, item.myBookingId, item.myAttendance),
  }
}

/**
 * Same order as the domain policy (`evaluateBooking`): cancelled → started (in progress / past)
 * → already booked → booking window → full. A started or ended session therefore never reads
 * as "already booked", even when the student holds a confirmed booking for it.
 * Waitlist (Phase 4.4): a free spot is always offered as "book" (also to someone still waiting inside
 * the window); otherwise her place shows while she waits, and a full session she could wait for offers
 * "join_waitlist" only while a freed spot would still be promoted (owner rule, ADR-011).
 */
export function studentAction(
  state: SessionState,
  myBookingId: string | null,
  waitlist: WaitlistContext = NO_WAITLIST,
): StudentAction {
  if (state === "cancelled") return "none"
  if (state === "in_progress" || state === "past") return "none"
  if (myBookingId) return "booked"
  if (state === "available") return "book"
  if (waitlist.enabled && waitlist.position !== null) return "waiting"
  if (waitlist.enabled && state === "full" && waitlist.open) return "join_waitlist"
  return "none"
}

/** Outcome of the student's own booking, only once the session has started. */
export function myOutcome(state: SessionState, myBookingId: string | null, attendance: Attendance | null): MyOutcome | null {
  if (!myBookingId || (state !== "in_progress" && state !== "past")) return null
  if (attendance === "attended") return "attended"
  if (attendance === "no_show") return "absent"
  return "booked"
}

/**
 * Re-reads one session from the repository (after a booking or a cancellation) so its counts
 * come from the backend, never from an optimistic guess. Null when it is no longer visible.
 */
export async function getAgendaEntry(deps: AgendaDeps, sessionId: string): Promise<AgendaEntry | null> {
  if (!isValidSessionId(sessionId)) return null
  const [rules, found, positions] = await Promise.all([
    deps.repository.getStudioRules(),
    deps.repository.getSession(sessionId),
    myWaitingPositions(deps),
  ])
  if (!found) return null
  const now = deps.clock.now()
  return toAgendaEntry(found, rules, now, waitlistContext(deps, found, rules, now, positions))
}

/**
 * Swaps a re-read entry into a loaded agenda. An agenda that does not list the session (the
 * student moved to another week meanwhile) comes back unchanged; `null` drops the session.
 */
export function replaceAgendaEntry<A extends Agenda>(agenda: A, sessionId: string, fresh: AgendaEntry | null): A {
  if (!agenda.days.some((day) => day.entries.some((entry) => entry.session.id === sessionId))) return agenda
  const days = agenda.days
    .map((day) => ({
      ...day,
      entries: day.entries.flatMap((entry) => (entry.session.id !== sessionId ? [entry] : fresh ? [fresh] : [])),
    }))
    .filter((day) => day.entries.length > 0)
  return { ...agenda, days, total: days.reduce((sum, day) => sum + day.entries.length, 0) }
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
