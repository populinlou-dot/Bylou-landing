import { describe, expect, it } from "vitest"
import { RULES, atOffset, makeGrant, makeSession, makeWaitlistEntry } from "./test-fixtures"
import type { CreditGrant } from "./types"
import { isWaitlistPromotionOpen, nextWaitlistCandidate } from "./waitlist"

const session = makeSession()
const grantsFor =
  (byUser: Record<string, CreditGrant[]>) =>
  (userId: string): CreditGrant[] =>
    byUser[userId] ?? []

describe("nextWaitlistCandidate", () => {
  it("returns the oldest waiting entry (FIFO), regardless of input order", () => {
    const entries = [
      makeWaitlistEntry({ id: "w2", userId: "u2", createdAt: "2026-10-11T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "w1", userId: "u1", createdAt: "2026-10-10T00:00:00.000Z" }),
    ]
    const grants = grantsFor({ u1: [makeGrant({ id: "g-u1", userId: "u1" })], u2: [makeGrant({ userId: "u2" })] })
    expect(nextWaitlistCandidate(session, entries, grants, 1)).toEqual({
      candidate: entries[1],
      grantId: "g-u1",
      skipped: [],
    })
  })

  it("skips candidates without a valid credit and reports them", () => {
    const entries = [
      makeWaitlistEntry({ id: "w1", userId: "no-credit", createdAt: "2026-10-10T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "w2", userId: "expired", createdAt: "2026-10-11T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "w3", userId: "ok", createdAt: "2026-10-12T00:00:00.000Z" }),
    ]
    const grants = grantsFor({
      expired: [makeGrant({ userId: "expired", expiresAt: "2026-10-19T00:00:00.000Z" })],
      ok: [makeGrant({ id: "g-ok", userId: "ok" })],
    })
    const result = nextWaitlistCandidate(session, entries, grants, 1)
    expect(result.candidate?.id).toBe("w3")
    expect(result.grantId).toBe("g-ok")
    expect(result.skipped.map((s) => [s.entry.id, s.reason])).toEqual([
      ["w1", "no_valid_credit"],
      ["w2", "no_valid_credit"],
    ])
  })

  it("ignores entries that are not waiting or belong to other sessions", () => {
    const entries = [
      makeWaitlistEntry({ id: "promoted", status: "promoted", createdAt: "2026-10-01T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "left", status: "left", createdAt: "2026-10-02T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "other", sessionId: "s2", createdAt: "2026-10-03T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "w1", createdAt: "2026-10-04T00:00:00.000Z" }),
    ]
    const result = nextWaitlistCandidate(session, entries, grantsFor({ u1: [makeGrant()] }), 1)
    expect(result.candidate?.id).toBe("w1")
    expect(result.skipped).toEqual([])
  })

  it("breaks createdAt ties by id", () => {
    const createdAt = "2026-10-10T00:00:00.000Z"
    const entries = [makeWaitlistEntry({ id: "wb", createdAt }), makeWaitlistEntry({ id: "wa", createdAt })]
    expect(nextWaitlistCandidate(session, entries, grantsFor({ u1: [makeGrant()] }), 1).candidate?.id).toBe("wa")
  })

  it("returns null when nobody qualifies", () => {
    const entries = [makeWaitlistEntry()]
    expect(nextWaitlistCandidate(session, entries, grantsFor({}), 1)).toEqual({
      candidate: null,
      grantId: null,
      skipped: [{ entry: entries[0], reason: "no_valid_credit" }],
    })
  })

  it("skips a student who already holds a booking of the session, before looking at her credit", () => {
    const entries = [
      makeWaitlistEntry({ id: "w1", userId: "booked", createdAt: "2026-10-10T00:00:00.000Z" }),
      makeWaitlistEntry({ id: "w2", userId: "ok", createdAt: "2026-10-11T00:00:00.000Z" }),
    ]
    const grants = grantsFor({ booked: [makeGrant({ userId: "booked" })], ok: [makeGrant({ id: "g-ok", userId: "ok" })] })
    const result = nextWaitlistCandidate(session, entries, grants, 1, (userId) => (userId === "booked" ? "already_booked" : null))
    expect(result.candidate?.id).toBe("w2")
    expect(result.skipped).toEqual([{ entry: entries[0], reason: "already_booked" }])
  })
})

describe("isWaitlistPromotionOpen (owner rule: more than the cancellation window ahead)", () => {
  const HOUR = 60 * 60_000
  it("is open while the session starts more than cancellationWindowHours from now", () => {
    expect(isWaitlistPromotionOpen(session, RULES, atOffset(-25 * HOUR))).toBe(true)
    expect(isWaitlistPromotionOpen(session, RULES, atOffset(-24 * HOUR - 1))).toBe(true)
  })

  it("is closed exactly at the window edge and inside it", () => {
    expect(isWaitlistPromotionOpen(session, RULES, atOffset(-24 * HOUR))).toBe(false)
    expect(isWaitlistPromotionOpen(session, RULES, atOffset(-HOUR))).toBe(false)
  })

  it("follows the studio setting, not a constant", () => {
    const rules = { ...RULES, cancellationWindowHours: 48 }
    expect(isWaitlistPromotionOpen(session, rules, atOffset(-30 * HOUR))).toBe(false)
    expect(isWaitlistPromotionOpen(session, { ...RULES, cancellationWindowHours: 0 }, atOffset(-1))).toBe(true)
  })

  it("never promotes into a cancelled session", () => {
    expect(isWaitlistPromotionOpen(makeSession({ status: "cancelled" }), RULES, atOffset(-72 * HOUR))).toBe(false)
  })
})
