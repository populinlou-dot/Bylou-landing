import type { CancellationCode } from "./codes"
import { HOUR_MS, toEpochMs } from "./time"
import type { Booking, Session, StudioRules } from "./types"

export type CancellationEvaluation =
  /** Cancelled in time: the debited credit is refunded. */
  | { outcome: "refund" }
  /** Allowed, but inside the window: booking becomes late_cancelled, no refund. */
  | { outcome: "late"; code: "cancellation_too_late" }
  | { outcome: "denied"; code: CancellationCode }

/**
 * Refund deadline D = S - cancellationWindowHours.
 *   now <= D      -> refund   (inclusive: cancelling at exactly D still refunds)
 *   D < now < S   -> late     (or denied with cancellation_too_late when lateCancelPolicy = "deny")
 *   now >= S      -> denied   (cancellation_not_allowed: session started)
 * Non-confirmed bookings and studio-cancelled sessions are denied with cancellation_not_allowed.
 */
export function evaluateCancellation(
  booking: Booking,
  session: Session,
  rules: StudioRules,
  now: Date,
): CancellationEvaluation {
  if (booking.status !== "confirmed" || session.status === "cancelled") {
    return { outcome: "denied", code: "cancellation_not_allowed" }
  }

  const nowMs = now.getTime()
  const startMs = toEpochMs(session.startsAt)
  if (nowMs >= startMs) return { outcome: "denied", code: "cancellation_not_allowed" }

  const refundDeadline = startMs - rules.cancellationWindowHours * HOUR_MS
  if (nowMs <= refundDeadline) return { outcome: "refund" }

  return rules.lateCancelPolicy === "allow_without_refund"
    ? { outcome: "late", code: "cancellation_too_late" }
    : { outcome: "denied", code: "cancellation_too_late" }
}
