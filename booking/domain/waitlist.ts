import { selectCreditGrant } from "./credits"
import { toEpochMs } from "./time"
import type { CreditGrant, Session, WaitlistEntry } from "./types"

export interface WaitlistSelection {
  /** First waiting entry (FIFO) whose user holds a valid credit, or null. */
  candidate: WaitlistEntry | null
  /** Grant to debit for the candidate. */
  grantId: string | null
  /** Waiting entries ahead of the candidate that were passed over for lack of credit. */
  skipped: WaitlistEntry[]
}

/**
 * FIFO by createdAt (tiebreak: id). Entries of other sessions or not "waiting" are ignored.
 * `grantsByUser` returns the user's grants; a candidate needs a grant valid at session start.
 */
export function nextWaitlistCandidate(
  session: Session,
  entries: readonly WaitlistEntry[],
  grantsByUser: (userId: string) => readonly CreditGrant[],
  creditsPerBooking: number,
): WaitlistSelection {
  const queue = entries
    .filter((e) => e.sessionId === session.id && e.status === "waiting")
    .sort((a, b) => toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const skipped: WaitlistEntry[] = []
  for (const entry of queue) {
    const grant = selectCreditGrant(grantsByUser(entry.userId), session.startsAt, creditsPerBooking)
    if (grant) return { candidate: entry, grantId: grant.id, skipped }
    skipped.push(entry)
  }
  return { candidate: null, grantId: null, skipped }
}
