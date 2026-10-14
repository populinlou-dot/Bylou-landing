/**
 * In-memory credit ledger for the `mock` data source (DEMO DATA ONLY). Mirrors `credit_ledger`:
 * append-only, one row per change of a pack's remaining credits, so the admin ledger view of the demo
 * adds up exactly like the real one (remaining = Σ delta per pack).
 */
import type { CreditLedgerReason, IsoDateTime } from "../../domain"

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
