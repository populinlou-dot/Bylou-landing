/**
 * In-memory credit ledger for the `mock` data source (DEMO DATA ONLY). Mirrors `credit_ledger`:
 * append-only, one row per change of a pack's remaining credits, so the admin ledger view of the demo
 * adds up exactly like the real one (remaining = Σ delta per pack).
 */
import type { CreditGrant, CreditLedgerReason, IsoDateTime } from "../../domain"

export interface MockLedgerEntry {
  id: string
  userId: string
  grantId: string
  bookingId: string | null
  reason: CreditLedgerReason
  delta: number
  note: string | null
  /** null = system job. */
  actorId: string | null
  /** `admin_adjust` idempotency key (null otherwise). */
  requestKey: string | null
  createdAt: IsoDateTime
}

/** Admin-only pack columns (`credit_grants.note`, `granted_by`, `idempotency_key`, `created_at`). */
export interface MockGrantMeta {
  note: string | null
  createdAt: IsoDateTime
  grantedBy: string
  requestKey: string
}

export function appendLedger(
  ledger: MockLedgerEntry[],
  entry: Omit<MockLedgerEntry, "id" | "requestKey" | "note" | "bookingId"> & {
    requestKey?: string | null
    note?: string | null
    bookingId?: string | null
  },
): MockLedgerEntry {
  const row: MockLedgerEntry = {
    ...entry,
    id: String(ledger.length + 1),
    bookingId: entry.bookingId ?? null,
    note: entry.note ?? null,
    requestKey: entry.requestKey ?? null,
  }
  ledger.push(row)
  return row
}

/**
 * Mirror of `private.expire_credit_grants` (DATA_MODEL §6.8): every pack that expired with unused credits
 * drops to 0 remaining and gets ONE `expiry` row (delta = −unused, system actor, no note), so Σ ledger per
 * student = usable balance. Bookings already paid by the pack are untouched (their debit is in the ledger).
 * Idempotent: a pack with an expiry row, or with nothing left, is skipped. Mutates `grants` and `ledger`.
 * The real job runs hourly with a 5-minute grace; the in-memory demo applies it on every read.
 */
export function expireDueGrants(grants: CreditGrant[], ledger: MockLedgerEntry[], now: Date): number {
  const expired = new Set(ledger.filter((e) => e.reason === "expiry").map((e) => e.grantId))
  let count = 0
  for (const grant of [...grants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (grant.remaining <= 0 || expired.has(grant.id) || Date.parse(grant.expiresAt) > now.getTime()) continue
    appendLedger(ledger, {
      userId: grant.userId,
      grantId: grant.id,
      reason: "expiry",
      delta: -grant.remaining,
      actorId: null,
      createdAt: now.toISOString(),
    })
    grant.remaining = 0
    count += 1
  }
  return count
}
