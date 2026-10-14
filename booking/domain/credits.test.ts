import { describe, expect, it } from "vitest"
import { creditBalance, selectCreditGrant } from "./credits"
import { START, makeGrant } from "./test-fixtures"

describe("selectCreditGrant", () => {
  it("picks the earliest-expiring valid grant", () => {
    const grants = [
      makeGrant({ id: "late", expiresAt: "2026-11-30T00:00:00.000Z" }),
      makeGrant({ id: "soon", expiresAt: "2026-10-25T00:00:00.000Z" }),
    ]
    expect(selectCreditGrant(grants, START)?.id).toBe("soon")
  })

  it("skips grants expired at session start (expiry is exclusive)", () => {
    const grants = [
      makeGrant({ id: "expires-at-start", expiresAt: START }),
      makeGrant({ id: "valid", expiresAt: "2026-11-30T00:00:00.000Z" }),
    ]
    expect(selectCreditGrant(grants, START)?.id).toBe("valid")
  })

  it("skips exhausted grants", () => {
    const grants = [
      makeGrant({ id: "empty", remaining: 0, expiresAt: "2026-10-25T00:00:00.000Z" }),
      makeGrant({ id: "valid", expiresAt: "2026-11-30T00:00:00.000Z" }),
    ]
    expect(selectCreditGrant(grants, START)?.id).toBe("valid")
  })

  it("breaks ties by grantedAt, then id, regardless of input order", () => {
    const expiresAt = "2026-11-01T00:00:00.000Z"
    const grants = [
      makeGrant({ id: "c", expiresAt, grantedAt: "2026-10-02T00:00:00.000Z" }),
      makeGrant({ id: "b", expiresAt, grantedAt: "2026-10-01T00:00:00.000Z" }),
      makeGrant({ id: "a", expiresAt, grantedAt: "2026-10-01T00:00:00.000Z" }),
    ]
    expect(selectCreditGrant(grants, START)?.id).toBe("a")
    expect(selectCreditGrant([...grants].reverse(), START)?.id).toBe("a")
  })

  it("does not mutate the input", () => {
    const grants = [makeGrant({ id: "x", expiresAt: "2026-12-01T00:00:00.000Z" }), makeGrant({ id: "y" })]
    selectCreditGrant(grants, START)
    expect(grants.map((g) => g.id)).toEqual(["x", "y"])
  })

  it("returns null when nothing is usable", () => {
    expect(selectCreditGrant([makeGrant({ remaining: 0 })], START)).toBeNull()
    expect(selectCreditGrant([], START)).toBeNull()
  })

  it("respects the required amount", () => {
    expect(selectCreditGrant([makeGrant({ remaining: 1 })], START, 2)).toBeNull()
  })
})

describe("creditBalance", () => {
  const now = new Date("2026-10-15T00:00:00.000Z")

  it("sums remaining credits of non-expired grants", () => {
    const grants = [
      makeGrant({ id: "a", remaining: 3 }),
      makeGrant({ id: "b", remaining: 2, expiresAt: "2026-12-01T00:00:00.000Z" }),
      makeGrant({ id: "expired", remaining: 4, expiresAt: "2026-10-14T00:00:00.000Z" }),
      makeGrant({ id: "empty", remaining: 0 }),
    ]
    expect(creditBalance(grants, now)).toBe(5)
  })

  it("excludes a grant at exactly its expiry instant", () => {
    expect(creditBalance([makeGrant({ expiresAt: now.toISOString() })], now)).toBe(0)
  })

  it("is 0 without grants", () => {
    expect(creditBalance([], now)).toBe(0)
  })
})
