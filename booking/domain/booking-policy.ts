import { availability } from "./availability"
import type { BookingRejectionCode } from "./codes"
import { selectCreditGrant } from "./credits"
import { DAY_MS, MINUTE_MS, toEpochMs } from "./time"
import type { Booking, CreditGrant, Session, StudioRules } from "./types"

export interface BookingAttempt {
  session: Session
  userId: string
  /** Bookings of this session (any user, any status). */
  sessionBookings: readonly Booking[]
  /** Credit grants of the user attempting to book. */
  grants: readonly CreditGrant[]
  rules: StudioRules
  now: Date
}

export type BookingEvaluation = { ok: true; grantId: string } | { ok: false; code: BookingRejectionCode }

/**
 * Booking window, from session start S:
 *   opensAt  = S - opensDaysBefore * 24h      (inclusive: bookable at exactly opensAt)
 *   closesAt = S - closesMinutesBefore        (exclusive: not bookable at exactly closesAt)
 * Checks run in a fixed order so each attempt yields one stable code.
 */
export function evaluateBooking(attempt: BookingAttempt): BookingEvaluation {
  const { session, userId, sessionBookings, grants, rules, now } = attempt
  const nowMs = now.getTime()
  const startMs = toEpochMs(session.startsAt)
  const opensAt = startMs - rules.bookingWindow.opensDaysBefore * DAY_MS
  const closesAt = startMs - rules.bookingWindow.closesMinutesBefore * MINUTE_MS

  if (session.status === "cancelled") return reject("session_cancelled")
  if (nowMs >= startMs) return reject("session_started")
  if (nowMs < opensAt) return reject("booking_not_open")
  if (nowMs >= closesAt) return reject("booking_closed")

  const alreadyBooked = sessionBookings.some(
    (b) => b.sessionId === session.id && b.userId === userId && b.status === "confirmed",
  )
  if (alreadyBooked) return reject("already_booked")
  if (availability(session, sessionBookings).isFull) return reject("session_full")

  const grant = selectCreditGrant(grants, session.startsAt, rules.creditsPerBooking)
  if (!grant) return reject("no_valid_credit")

  return { ok: true, grantId: grant.id }
}

function reject(code: BookingRejectionCode): BookingEvaluation {
  return { ok: false, code }
}
