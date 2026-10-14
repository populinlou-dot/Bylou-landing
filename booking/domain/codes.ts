/**
 * Machine-readable reason codes. They are data, never UI strings:
 * brands map each one to copy (booking/config copy catalog).
 */

export const BOOKING_REJECTION_CODES = [
  "session_cancelled",
  "session_started",
  "booking_not_open",
  "booking_closed",
  "session_full",
  "already_booked",
  "no_valid_credit",
] as const

export type BookingRejectionCode = (typeof BOOKING_REJECTION_CODES)[number]

export const CANCELLATION_CODES = ["cancellation_too_late", "cancellation_not_allowed"] as const

export type CancellationCode = (typeof CANCELLATION_CODES)[number]

export const DOMAIN_REASON_CODES = [...BOOKING_REJECTION_CODES, ...CANCELLATION_CODES] as const

export type DomainReasonCode = (typeof DOMAIN_REASON_CODES)[number]
