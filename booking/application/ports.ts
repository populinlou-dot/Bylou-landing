/**
 * Ports for the booking application layer (ARCHITECTURE.md §3).
 * Read side (Phase 2) plus the transactional side (Phase 3): book, cancel, my bookings,
 * credit balance and the auth port. All instants are UTC ISO-8601 strings.
 */
import type {
  Booking,
  BookingRejectionCode,
  CancellationCode,
  ClassType,
  IsoDateTime,
  Session,
  StudioRules,
} from "../domain"

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
  /** Current user's active (confirmed) booking id; null when signed out or not booked. */
  myBookingId: string | null
  /** Phase 4. */
  myWaitlistPosition: number | null
}

/**
 * Attendee-only details (meeting link, address). The backend returns them only to staff and
 * to holders of a confirmed booking (RLS); the UI shows them only when present.
 */
export interface SessionPrivateDetails {
  meetingUrl: string | null
  address: string | null
  instructions: string | null
}

export interface MyBooking {
  booking: Booking
  session: Session
  classType: ClassTypeView
  instructorName: string | null
  /** True when the debited credit went back to the pack on cancellation. */
  refunded: boolean
  /** Present only for confirmed bookings the backend still shares details for. */
  privateDetails: SessionPrivateDetails | null
}

export interface CreditGrantView {
  id: string
  total: number
  remaining: number
  validFrom: IsoDateTime
  expiresAt: IsoDateTime
  note: string | null
}

export interface CreditBalance {
  /** Credits usable right now (non-expired, already valid, not consumed). */
  available: number
  /** Earliest expiry among grants that still have credits; null when none. */
  nextExpiry: IsoDateTime | null
  /** Grants valid now with credits left, earliest expiry first. */
  activeGrants: CreditGrantView[]
}

/** Transport-level failures shared by every call (ARCHITECTURE §5). */
export const TRANSPORT_CODES = ["unauthenticated", "forbidden", "invalid_input", "network_error", "unknown"] as const
export type TransportCode = (typeof TRANSPORT_CODES)[number]

/** `not_found` is an application/RPC code (unknown or invisible id). */
export type BookCode = BookingRejectionCode | "not_found" | TransportCode
export type CancelCode = CancellationCode | "not_found" | "not_owner" | TransportCode

export interface BookCommand {
  sessionId: string
  /** Generated once per confirm sheet and reused on retries (DATA_MODEL §5). */
  idempotencyKey: string
}

export interface CancelCommand {
  bookingId: string
  idempotencyKey: string
  /** Maps to p_accept_late; only meaningful when lateCancelPolicy = "allow_without_refund". */
  acceptLate?: boolean
}

export type BookResult =
  | { ok: true; bookingId: string; replayed: boolean; remainingCredits: number | null }
  | { ok: false; code: BookCode }

export type CancelResult =
  | { ok: true; bookingId: string; status: "cancelled" | "late_cancelled"; refunded: boolean; replayed: boolean }
  | { ok: false; code: CancelCode }

/** Read failures raise this so containers can tell "sign in" apart from "retry". */
export class RepositoryError extends Error {
  constructor(
    readonly code: TransportCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = "RepositoryError"
  }
}

export interface BookingRepository {
  getStudioRules(): Promise<StudioRules>
  listClassTypes(): Promise<ClassTypeView[]>
  listSessions(range: InstantRange): Promise<SessionAvailability[]>
  getSession(id: string): Promise<SessionAvailability | null>
  /** Null when the caller may not see them (signed out, not booked, cancelled booking). */
  getSessionPrivateDetails(sessionId: string): Promise<SessionPrivateDetails | null>
  /** Signed-in user's bookings (any status). Throws RepositoryError("unauthenticated") when signed out. */
  listMyBookings(): Promise<MyBooking[]>
  /** Throws RepositoryError("unauthenticated") when signed out. */
  getMyCreditBalance(): Promise<CreditBalance>
  /** Business refusals come back as data; never throws for expected failures. */
  book(cmd: BookCommand): Promise<BookResult>
  cancel(cmd: CancelCommand): Promise<CancelResult>
}

export interface AuthUser {
  id: string
  email: string
}

export type AuthCode = "invalid_email" | "invalid_code" | "code_expired" | "rate_limited" | "network_error" | "unknown"

export type RequestCodeResult =
  /** `demoCode` is set only by the mock adapter, which shows it on screen (ARCHITECTURE §10). */
  | { ok: true; demoCode?: string }
  | { ok: false; code: AuthCode }

export type VerifyCodeResult = { ok: true; user: AuthUser } | { ok: false; code: AuthCode }

export interface AuthPort {
  /** Current session's user, or null. UX only: RLS/RPC re-check every call. */
  getUser(): Promise<AuthUser | null>
  /** Called with the current user on subscribe and on every change. Returns unsubscribe. */
  onChange(listener: (user: AuthUser | null) => void): () => void
  requestCode(email: string): Promise<RequestCodeResult>
  verifyCode(email: string, code: string): Promise<VerifyCodeResult>
  signOut(): Promise<void>
}
