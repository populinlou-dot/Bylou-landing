import { describe, expect, it } from "vitest"
import type { CreditGrant } from "../../domain"
import { appendLedger, expireDueGrants, type MockLedgerEntry } from "./mock-ledger"

const NOW = new Date("2026-10-14T15:00:00.000Z")

function pack(id: string, total: number, remaining: number, expiresAt: string): { grant: CreditGrant; ledger: MockLedgerEntry[] } {
  const grant: CreditGrant = { id, userId: "u1", total, remaining, grantedAt: "2026-09-01T12:00:00.000Z", expiresAt }
  const ledger: MockLedgerEntry[] = []
  appendLedger(ledger, { userId: "u1", grantId: id, reason: "grant", delta: total, actorId: "staff", createdAt: grant.grantedAt })
  if (remaining < total) {
    appendLedger(ledger, {
      userId: "u1",
      grantId: id,
      bookingId: `b-${id}`,
      reason: "booking_debit",
      delta: remaining - total,
      actorId: "u1",
      createdAt: grant.grantedAt,
    })
  }
  return { grant, ledger }
}

const sumFor = (ledger: MockLedgerEntry[], grantId: string) =>
  ledger.filter((e) => e.grantId === grantId).reduce((sum, e) => sum + e.delta, 0)

describe("expireDueGrants (mirror of private.expire_credit_grants)", () => {
  it("expires only the unused credits of a due pack, once, as a system row without a note", () => {
    const { grant, ledger } = pack("g1", 5, 3, "2026-10-14T15:00:00.000Z") // expiry is exclusive: due at NOW
    expect(expireDueGrants([grant], ledger, NOW)).toBe(1)
    expect(grant.remaining).toBe(0)
    expect(ledger.filter((e) => e.reason === "expiry")).toEqual([
      expect.objectContaining({ grantId: "g1", delta: -3, actorId: null, note: null, bookingId: null }),
    ])
    expect(ledger.filter((e) => e.reason === "booking_debit")).toHaveLength(1) // the held booking is untouched
    expect(sumFor(ledger, "g1")).toBe(grant.remaining)

    expect(expireDueGrants([grant], ledger, new Date(NOW.getTime() + 86_400_000))).toBe(0)
    expect(ledger.filter((e) => e.reason === "expiry")).toHaveLength(1)
  })

  it("leaves packs that are still valid or fully used alone", () => {
    const valid = pack("g-valid", 4, 4, "2026-10-14T15:00:00.001Z")
    const used = pack("g-used", 2, 0, "2026-10-01T03:00:00.000Z")
    const grants = [valid.grant, used.grant]
    const ledger = [...valid.ledger, ...used.ledger]
    expect(expireDueGrants(grants, ledger, NOW)).toBe(0)
    expect(valid.grant.remaining).toBe(4)
    expect(ledger.some((e) => e.reason === "expiry")).toBe(false)
  })
})
