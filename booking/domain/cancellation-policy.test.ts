import { describe, expect, it } from "vitest"
import { evaluateCancellation } from "./cancellation-policy"
import { RULES, atOffset, makeBooking, makeSession } from "./test-fixtures"
import { HOUR_MS } from "./time"

const booking = makeBooking({ userId: "u1" })
const session = makeSession()

/**
 * Boundary rule under test: refund deadline D = start - 24 h is INCLUSIVE.
 * Cancelling at exactly D refunds; 1 ms after D is a late cancellation.
 */
describe("evaluateCancellation", () => {
  it("refunds well before the window", () => {
    expect(evaluateCancellation(booking, session, RULES, atOffset(-48 * HOUR_MS))).toEqual({ outcome: "refund" })
  })

  it("refunds at exactly the window boundary (inclusive)", () => {
    expect(evaluateCancellation(booking, session, RULES, atOffset(-24 * HOUR_MS))).toEqual({ outcome: "refund" })
  })

  it("is late 1 ms after the boundary: allowed, no refund", () => {
    expect(evaluateCancellation(booking, session, RULES, atOffset(-24 * HOUR_MS + 1))).toEqual({
      outcome: "late",
      code: "cancellation_too_late",
    })
  })

  it("is late 1 ms before start", () => {
    expect(evaluateCancellation(booking, session, RULES, atOffset(-1))).toMatchObject({ outcome: "late" })
  })

  it("denies late cancellation when the studio policy is deny", () => {
    const rules = { ...RULES, lateCancelPolicy: "deny" as const }
    expect(evaluateCancellation(booking, session, rules, atOffset(-HOUR_MS))).toEqual({
      outcome: "denied",
      code: "cancellation_too_late",
    })
  })

  it("denies at exactly the start and after (session started)", () => {
    for (const now of [atOffset(0), atOffset(HOUR_MS)]) {
      expect(evaluateCancellation(booking, session, RULES, now)).toEqual({
        outcome: "denied",
        code: "cancellation_not_allowed",
      })
    }
  })

  it("denies bookings that are not confirmed", () => {
    for (const status of ["cancelled", "late_cancelled"] as const) {
      const result = evaluateCancellation(makeBooking({ status }), session, RULES, atOffset(-48 * HOUR_MS))
      expect(result).toEqual({ outcome: "denied", code: "cancellation_not_allowed" })
    }
  })

  it("denies on a studio-cancelled session (refund handled by the studio flow)", () => {
    const result = evaluateCancellation(booking, makeSession({ status: "cancelled" }), RULES, atOffset(-48 * HOUR_MS))
    expect(result).toEqual({ outcome: "denied", code: "cancellation_not_allowed" })
  })

  it("with a 0 h window, refunds until 1 ms before start", () => {
    const rules = { ...RULES, cancellationWindowHours: 0 }
    expect(evaluateCancellation(booking, session, rules, atOffset(-1))).toEqual({ outcome: "refund" })
  })
})
