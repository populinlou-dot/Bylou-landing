import { toEpochMs } from "./time"
import type { CreditGrant, IsoDateTime } from "./types"

/** A grant is usable at `at` when it has not expired yet (expiry is exclusive) and covers `required`. */
export function isGrantUsableAt(grant: CreditGrant, at: number, required = 1): boolean {
  return grant.remaining >= required && toEpochMs(grant.expiresAt) > at
}

/**
 * Picks the grant to debit for a session: earliest-expiring grant still valid at the
 * session start with enough remaining credits. Tiebreak: earliest grantedAt, then id.
 */
export function selectCreditGrant(
  grants: readonly CreditGrant[],
  sessionStartsAt: IsoDateTime,
  required = 1,
): CreditGrant | null {
  const startMs = toEpochMs(sessionStartsAt)
  const usable = grants.filter((g) => isGrantUsableAt(g, startMs, required))
  usable.sort(
    (a, b) =>
      toEpochMs(a.expiresAt) - toEpochMs(b.expiresAt) ||
      toEpochMs(a.grantedAt) - toEpochMs(b.grantedAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return usable[0] ?? null
}

/** Credits available right now: sum of `remaining` over non-expired grants. */
export function creditBalance(grants: readonly CreditGrant[], now: Date): number {
  const nowMs = now.getTime()
  return grants.reduce((sum, g) => (isGrantUsableAt(g, nowMs, 1) ? sum + g.remaining : sum), 0)
}
