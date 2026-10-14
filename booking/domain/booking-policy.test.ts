import { describe, expect, it } from "vitest"
import { availability } from "./availability"
import { type BookingAttempt, evaluateBooking } from "./booking-policy"
import { RULES, atOffset, makeBooking, makeGrant, makeSession } from "./test-fixtures"
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time"

const attempt = (overrides: Partial<BookingAttempt> = {}): BookingAttempt => ({
  session: makeSession(),
  userId: "u1",
  sessionBookings: [],
  grants: [makeGrant()],
  rules: RULES,
  now: atOffset(-2 * DAY_MS),
  ...overrides,
})

describe("availability", () => {
  it("counts only confirmed bookings of the session", () => {
    const bookings = [
      makeBooking({ id: "b1", status: "confirmed" }),
      makeBooking({ id: "b2", status: "cancelled" }),
      makeBooking({ id: "b3", status: "late_cancelled" }),
      makeBooking({ id: "b4", sessionId: "other" }),
    ]
    expect(availability(makeSession({ capacity: 3 }), bookings)).toEqual({
      capacity: 3,
      booked: 1,
      spotsLeft: 2,
      isFull: false,
    })
  })

  it("never reports negative spots when overbooked", () => {
    const bookings = [makeBooking({ id: "b1" }), makeBooking({ id: "b2" })]
    expect(availability(makeSession({ capacity: 1 }), bookings)).toMatchObject({ spotsLeft: 0, isFull: true })
  })
})

describe("evaluateBooking", () => {
  it("accepts a valid attempt and returns the grant to debit", () => {
    expect(evaluateBooking(attempt())).toEqual({ ok: true, grantId: "g1" })
  })

  it("accepts the last spot", () => {
    const result = evaluateBooking(attempt({ session: makeSession({ capacity: 2 }), sessionBookings: [makeBooking()] }))
    expect(result.ok).toBe(true)
  })

  it("rejects a full session", () => {
    const sessionBookings = [makeBooking({ id: "b1" }), makeBooking({ id: "b2", userId: "u-third" })]
    expect(evaluateBooking(attempt({ sessionBookings }))).toEqual({ ok: false, code: "session_full" })
  })

  it("rejects a 1:1 session already taken", () => {
    const result = evaluateBooking(attempt({ session: makeSession({ capacity: 1 }), sessionBookings: [makeBooking()] }))
    expect(result).toEqual({ ok: false, code: "session_full" })
  })

  it("rejects when the user already holds a confirmed booking (takes precedence over full)", () => {
    const sessionBookings = [makeBooking({ id: "b1", userId: "u1" }), makeBooking({ id: "b2" })]
    expect(evaluateBooking(attempt({ sessionBookings }))).toEqual({ ok: false, code: "already_booked" })
  })

  it("lets the user re-book after cancelling", () => {
    const sessionBookings = [makeBooking({ userId: "u1", status: "cancelled" })]
    expect(evaluateBooking(attempt({ sessionBookings })).ok).toBe(true)
  })

  it("rejects a cancelled session", () => {
    const result = evaluateBooking(attempt({ session: makeSession({ status: "cancelled" }) }))
    expect(result).toEqual({ ok: false, code: "session_cancelled" })
  })

  describe("session started", () => {
    it("rejects at exactly the start instant", () => {
      expect(evaluateBooking(attempt({ now: atOffset(0) }))).toEqual({ ok: false, code: "session_started" })
    })

    it("rejects after the start", () => {
      expect(evaluateBooking(attempt({ now: atOffset(10 * MINUTE_MS) }))).toEqual({
        ok: false,
        code: "session_started",
      })
    })
  })

  describe("booking window (opens inclusive, closes exclusive)", () => {
    const rules = { ...RULES, bookingWindow: { opensDaysBefore: 7, closesMinutesBefore: 60 } }

    it("is not open 1 ms before opensAt", () => {
      const result = evaluateBooking(attempt({ rules, now: atOffset(-7 * DAY_MS - 1) }))
      expect(result).toEqual({ ok: false, code: "booking_not_open" })
    })

    it("is open at exactly opensAt", () => {
      expect(evaluateBooking(attempt({ rules, now: atOffset(-7 * DAY_MS) })).ok).toBe(true)
    })

    it("is open 1 ms before closesAt", () => {
      expect(evaluateBooking(attempt({ rules, now: atOffset(-HOUR_MS - 1) })).ok).toBe(true)
    })

    it("is closed at exactly closesAt", () => {
      const result = evaluateBooking(attempt({ rules, now: atOffset(-HOUR_MS) }))
      expect(result).toEqual({ ok: false, code: "booking_closed" })
    })

    it("with closesMinutesBefore = 0, is bookable 1 ms before start", () => {
      expect(evaluateBooking(attempt({ now: atOffset(-1) })).ok).toBe(true)
    })
  })

  describe("credits", () => {
    it("rejects without grants", () => {
      expect(evaluateBooking(attempt({ grants: [] }))).toEqual({ ok: false, code: "no_valid_credit" })
    })

    it("rejects when the only grant expires before the session starts", () => {
      const grants = [makeGrant({ expiresAt: "2026-10-20T21:59:59.999Z" })]
      expect(evaluateBooking(attempt({ grants }))).toEqual({ ok: false, code: "no_valid_credit" })
    })

    it("rejects when remaining credits are below creditsPerBooking", () => {
      const result = evaluateBooking(
        attempt({ grants: [makeGrant({ remaining: 1 })], rules: { ...RULES, creditsPerBooking: 2 } }),
      )
      expect(result).toEqual({ ok: false, code: "no_valid_credit" })
    })
  })

  it("reports the first failing rule in a fixed order", () => {
    const result = evaluateBooking(
      attempt({ session: makeSession({ status: "cancelled" }), grants: [], now: atOffset(HOUR_MS) }),
    )
    expect(result).toEqual({ ok: false, code: "session_cancelled" })
  })
})
