/**
 * Booking domain vocabulary. Pure types: no framework, backend or brand imports.
 * All instants are UTC ISO-8601 strings (e.g. "2026-10-14T22:00:00.000Z").
 * The studio timezone is only used for display and calendar grouping.
 */

export type IsoDateTime = string

export type Modality = "in_person" | "online"

export interface ClassType {
  id: string
  name: string
  durationMinutes: number
  defaultCapacity: number
}

export type SessionStatus = "scheduled" | "cancelled"

export interface Session {
  id: string
  classTypeId: string
  startsAt: IsoDateTime
  endsAt: IsoDateTime
  capacity: number
  modality: Modality
  status: SessionStatus
}

export type BookingStatus = "confirmed" | "cancelled" | "late_cancelled"

export type Attendance = "unknown" | "attended" | "no_show"

export interface Booking {
  id: string
  sessionId: string
  userId: string
  status: BookingStatus
  attendance: Attendance
  /** Client-generated key; the backend enforces uniqueness per user. */
  idempotencyKey: string
  /** Grant debited by this booking (null when no credit was consumed). */
  creditGrantId: string | null
  createdAt: IsoDateTime
}

export interface CreditGrant {
  id: string
  userId: string
  total: number
  remaining: number
  grantedAt: IsoDateTime
  /** Exclusive: the grant is no longer valid at this exact instant. */
  expiresAt: IsoDateTime
}

export type CreditLedgerReason = "grant" | "booking_debit" | "cancel_refund" | "expiry" | "admin_adjust"

/** Append-only audit row. `delta` is positive for grants/refunds, negative for debits/expiry. */
export interface CreditLedgerEntry {
  id: string
  userId: string
  grantId: string
  delta: number
  reason: CreditLedgerReason
  bookingId: string | null
  createdAt: IsoDateTime
}

/**
 * waiting → promoted (booked from the list) | skipped (passed over: no valid pack / already booked) |
 * left (she left) | closed (session cancelled, account erased, or she booked the class directly).
 */
export type WaitlistStatus = "waiting" | "promoted" | "skipped" | "left" | "closed"

/**
 * Why a waiting student was passed over when a spot opened (ADR-011 owner rule, ADR-021): no valid pack,
 * already booked, no display name, over the self-cancellation limit (ADR-019), or the promotion could not be written.
 */
export type WaitlistSkipReason = "no_valid_credit" | "already_booked" | "profile_incomplete" | "too_many_changes" | "promotion_failed"

export interface WaitlistEntry {
  id: string
  sessionId: string
  userId: string
  status: WaitlistStatus
  createdAt: IsoDateTime
}

/** What happens when a student cancels inside the cancellation window (ADR-011). */
export type LateCancelPolicy = "allow_without_refund" | "deny"

/** Per-studio business rules (ADR-011). Defaults live in booking/config. */
export interface StudioRules {
  /** IANA timezone, e.g. "America/Argentina/Buenos_Aires". Display only. */
  timezone: string
  bookingWindow: {
    /** Booking opens this many days (x 24 h) before the session starts. Inclusive. */
    opensDaysBefore: number
    /** Booking closes this many minutes before the session starts. Exclusive. */
    closesMinutesBefore: number
  }
  /** Free cancellation (with refund) up to this many hours before start. Inclusive. */
  cancellationWindowHours: number
  lateCancelPolicy: LateCancelPolicy
  creditsPerBooking: number
}
