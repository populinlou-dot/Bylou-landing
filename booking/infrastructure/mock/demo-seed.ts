/**
 * DEMO DATA — fictional schedule, not Bylou's real agenda.
 * Generated relative to the week of `now` (studio timezone) so the mock agenda is never
 * empty, and deterministic: the same week always yields the same ids and occupancy.
 */
import type { Booking, Modality, Session } from "../../domain"
import { addDays, startOfWeek, localDateOf, zonedTimeToInstant, type ClassTypeView, type LocalDate } from "../../application"

export const DEMO_ID_PREFIX = "demo-"
export const DEMO_INSTRUCTOR = "Lou"

/** Weeks generated around the current one: previous week, this week and the next three. */
export const DEMO_WEEK_OFFSETS = [-1, 0, 1, 2, 3] as const

export const DEMO_CLASS_TYPES: readonly ClassTypeView[] = [
  {
    id: "demo-individual",
    name: "Clase individual",
    durationMinutes: 60,
    defaultCapacity: 1,
    description: "Una clase 1:1 armada para tu cuerpo y lo que necesitás hoy. (Demo)",
  },
  {
    id: "demo-grupal",
    name: "Clase grupal",
    durationMinutes: 60,
    defaultCapacity: 8,
    description: "Hatha yoga con neurociencia práctica, en grupo reducido. (Demo)",
  },
  {
    id: "demo-meditacion",
    name: "Meditación",
    durationMinutes: 30,
    defaultCapacity: 10,
    description: "Una pausa guiada para regular tu sistema nervioso. (Demo)",
  },
]

interface Slot {
  /** ISO weekday, 1 = Monday. */
  weekday: number
  /** Wall-clock start in the studio timezone. */
  time: string
  classTypeId: string
  modality: Modality
}

/**
 * Weekly template. Wednesday 21:30 in Buenos Aires is 00:30 UTC on Thursday: it exercises
 * grouping by the studio's local day instead of the UTC day.
 */
const WEEKLY_SLOTS: readonly Slot[] = [
  { weekday: 1, time: "08:00", classTypeId: "demo-individual", modality: "online" },
  { weekday: 1, time: "19:00", classTypeId: "demo-grupal", modality: "in_person" },
  { weekday: 2, time: "10:00", classTypeId: "demo-individual", modality: "in_person" },
  { weekday: 2, time: "20:00", classTypeId: "demo-meditacion", modality: "online" },
  { weekday: 3, time: "19:00", classTypeId: "demo-grupal", modality: "online" },
  { weekday: 3, time: "21:30", classTypeId: "demo-individual", modality: "online" },
  { weekday: 4, time: "08:00", classTypeId: "demo-individual", modality: "online" },
  { weekday: 4, time: "19:00", classTypeId: "demo-grupal", modality: "in_person" },
  { weekday: 5, time: "18:00", classTypeId: "demo-meditacion", modality: "online" },
  { weekday: 6, time: "10:00", classTypeId: "demo-grupal", modality: "in_person" },
]

/** The one session the studio cancelled: this week's Friday meditation. */
const CANCELLED_SLOT = { weekOffset: 0, weekday: 5, time: "18:00" }

export interface DemoSeed {
  classTypes: ClassTypeView[]
  sessions: Session[]
  /** Fictional bookings of fictional users, only used to count occupancy. */
  bookings: Booking[]
  instructorBySessionId: Record<string, string>
}

export function createDemoSeed(now: Date, timeZone: string): DemoSeed {
  const thisMonday = startOfWeek(localDateOf(now, timeZone))
  const classTypes = DEMO_CLASS_TYPES.map((ct) => ({ ...ct }))
  const byId = new Map(classTypes.map((ct) => [ct.id, ct]))
  const sessions: Session[] = []
  const bookings: Booking[] = []
  const instructorBySessionId: Record<string, string> = {}

  DEMO_WEEK_OFFSETS.forEach((weekOffset, weekIndex) => {
    const monday = addDays(thisMonday, 7 * weekOffset)
    WEEKLY_SLOTS.forEach((slot, slotIndex) => {
      const classType = byId.get(slot.classTypeId)
      if (!classType) throw new Error(`Unknown demo class type ${slot.classTypeId}`)
      const date = addDays(monday, slot.weekday - 1)
      const start = zonedTimeToInstant(date, slot.time, timeZone)
      const end = new Date(start.getTime() + classType.durationMinutes * 60_000)
      const id = sessionId(date, slot.time, classType.id)
      const isCancelled =
        weekOffset === CANCELLED_SLOT.weekOffset && slot.weekday === CANCELLED_SLOT.weekday && slot.time === CANCELLED_SLOT.time

      sessions.push({
        id,
        classTypeId: classType.id,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        capacity: classType.defaultCapacity,
        modality: slot.modality,
        status: isCancelled ? "cancelled" : "scheduled",
      })
      instructorBySessionId[id] = DEMO_INSTRUCTOR

      const confirmed = isCancelled ? 0 : occupancy(weekIndex, slotIndex, classType.defaultCapacity)
      for (let i = 0; i < confirmed; i++) {
        bookings.push(demoBooking(id, i, "confirmed", start))
      }
      // A cancelled booking on every session proves only confirmed ones take a spot.
      bookings.push(demoBooking(id, confirmed, "cancelled", start))
    })
  })

  return { classTypes, sessions, bookings, instructorBySessionId }
}

/** Deterministic occupancy mix: free, partly booked and full sessions every week. */
function occupancy(weekIndex: number, slotIndex: number, capacity: number): number {
  if (capacity === 1) return (weekIndex + slotIndex) % 3 === 0 ? 1 : 0
  const pattern = [2, capacity, 5, capacity - 1, 0, 3]
  return Math.min(capacity, pattern[(weekIndex * 2 + slotIndex) % pattern.length])
}

function sessionId(date: LocalDate, time: string, classTypeId: string): string {
  return `${DEMO_ID_PREFIX}${date}-${time.replace(":", "")}-${classTypeId.replace(DEMO_ID_PREFIX, "")}`
}

function demoBooking(sessionId: string, index: number, status: Booking["status"], start: Date): Booking {
  return {
    id: `${sessionId}-b${index}`,
    sessionId,
    userId: `demo-user-${index + 1}`,
    status,
    attendance: "unknown",
    idempotencyKey: `${sessionId}-k${index}`,
    creditGrantId: null,
    createdAt: new Date(start.getTime() - 3 * 24 * 60 * 60_000).toISOString(),
  }
}
