/**
 * Ports for the booking application layer (ARCHITECTURE.md §3).
 * Phase 2 only needs the read side; write methods (book, cancel, listMyBookings,
 * getMyCreditBalance) are added with the transactional slice (Phase 3).
 */
import type { ClassType, IsoDateTime, Session, StudioRules } from "../domain"

export interface Clock {
  /** Injected so tests and the mock seed control time. */
  now(): Date
}

/** Half-open instant range `[from, to)` on `Session.startsAt`, UTC ISO-8601. */
export interface InstantRange {
  from: IsoDateTime
  to: IsoDateTime
}

/**
 * Read model of a class type. `description` is display-only and lives here (not in the
 * domain `ClassType`) until DATA_MODEL decides where catalog text is stored.
 */
export interface ClassTypeView extends ClassType {
  description: string | null
}

/** One session as the public agenda sees it. Never carries other users' rows. */
export interface SessionAvailability {
  session: Session
  classType: ClassTypeView
  /** Aggregate count of confirmed bookings (SECURITY DEFINER view/RPC in Supabase). */
  confirmedCount: number
  /** Display name of whoever teaches it; null when not assigned. */
  instructorName: string | null
  /** Current user's active booking id (always null while the agenda is anonymous). */
  myBookingId: string | null
  /** Phase 4. */
  myWaitlistPosition: number | null
}

export interface BookingRepository {
  getStudioRules(): Promise<StudioRules>
  listClassTypes(): Promise<ClassTypeView[]>
  listSessions(range: InstantRange): Promise<SessionAvailability[]>
  getSession(id: string): Promise<SessionAvailability | null>
}
