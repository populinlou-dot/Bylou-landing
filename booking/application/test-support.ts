/** Test helpers for application use cases (no test-runner imports, no adapters). */
import type { Session, StudioRules } from "../domain"
import type { BookingRepository, ClassTypeView, Clock, SessionAvailability } from "./ports"

export const BA_RULES: StudioRules = {
  timezone: "America/Argentina/Buenos_Aires",
  bookingWindow: { opensDaysBefore: 30, closesMinutesBefore: 0 },
  cancellationWindowHours: 24,
  lateCancelPolicy: "allow_without_refund",
  creditsPerBooking: 1,
}

export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) })

export const CLASS_TYPES: ClassTypeView[] = [
  { id: "ct-individual", name: "Clase individual", durationMinutes: 60, defaultCapacity: 1, description: null },
  { id: "ct-grupal", name: "Clase grupal", durationMinutes: 60, defaultCapacity: 8, description: "Grupo reducido" },
]

export function availabilityAt(
  startsAt: string,
  overrides: { id?: string; classTypeId?: string; capacity?: number; confirmed?: number; status?: Session["status"]; minutes?: number } = {},
): SessionAvailability {
  const classTypeId = overrides.classTypeId ?? "ct-grupal"
  const classType = CLASS_TYPES.find((ct) => ct.id === classTypeId) ?? CLASS_TYPES[1]
  const minutes = overrides.minutes ?? 60
  return {
    session: {
      id: overrides.id ?? `s-${startsAt}`,
      classTypeId,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
      capacity: overrides.capacity ?? 8,
      modality: "online",
      status: overrides.status ?? "scheduled",
    },
    classType,
    confirmedCount: overrides.confirmed ?? 0,
    instructorName: "Lou",
    myBookingId: null,
    myWaitlistPosition: null,
  }
}

/** In-memory fake that records calls. `leakRange` returns every session regardless of range. */
export function fakeRepository(
  sessions: SessionAvailability[],
  options: { rules?: StudioRules; leakRange?: boolean } = {},
): BookingRepository & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getStudioRules() {
      calls.push("getStudioRules")
      return options.rules ?? BA_RULES
    },
    async listClassTypes() {
      calls.push("listClassTypes")
      return CLASS_TYPES
    },
    async listSessions(range) {
      calls.push(`listSessions ${range.from} ${range.to}`)
      if (options.leakRange) return sessions
      return sessions.filter((s) => s.session.startsAt >= range.from && s.session.startsAt < range.to)
    },
    async getSession(id) {
      calls.push(`getSession ${id}`)
      return sessions.find((s) => s.session.id === id) ?? null
    },
  }
}
