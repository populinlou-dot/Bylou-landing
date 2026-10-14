import { selectCreditGrant } from "./credits"
import { toEpochMs } from "./time"
import type { CreditGrant, Session, StudioRules, WaitlistEntry, WaitlistSkipReason } from "./types"

const HOUR_MS = 60 * 60_000

/**
 * Owner rule (ADR-011, 2026-10-14): a freed spot goes to the waitlist only while the session starts MORE
 * than `cancellationWindowHours` from now, so a promoted student can still cancel for free. Inside the
 * window nobody is promoted and the spot is bookable first-come. Cancelled sessions never promote.
 */
export function isWaitlistPromotionOpen(session: Session, rules: StudioRules, now: Date): boolean {
  if (session.status !== "scheduled") return false
  return now.getTime() < toEpochMs(session.startsAt) - rules.cancellationWindowHours * HOUR_MS
}

export interface WaitlistSkip {
  entry: WaitlistEntry
  reason: WaitlistSkipReason
}

export interface WaitlistSelection {
  /** First waiting entry (FIFO) whose user holds a valid credit and no booking of the session, or null. */
  candidate: WaitlistEntry | null
  /** Grant to debit for the candidate. */
  grantId: string | null
  /** Waiting entries ahead of the candidate that were passed over, with the reason. */
  skipped: WaitlistSkip[]
}

/**
 * FIFO by createdAt (tiebreak: id). Entries of other sessions or not "waiting" are ignored.
 * `grantsByUser` returns the user's grants; a candidate needs a grant valid at session start.
 * `ineligible` (optional) is checked first and names why a student cannot be promoted at all (already booked,
 * no display name, over the self-cancellation limit), or null when she can.
 */
export function nextWaitlistCandidate(
  session: Session,
  entries: readonly WaitlistEntry[],
  grantsByUser: (userId: string) => readonly CreditGrant[],
  creditsPerBooking: number,
  ineligible: (userId: string) => WaitlistSkipReason | null = () => null,
): WaitlistSelection {
  const queue = entries
    .filter((e) => e.sessionId === session.id && e.status === "waiting")
    .sort((a, b) => toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const skipped: WaitlistSkip[] = []
  for (const entry of queue) {
    const reason = ineligible(entry.userId)
    if (reason) {
      skipped.push({ entry, reason })
      continue
    }
    const grant = selectCreditGrant(grantsByUser(entry.userId), session.startsAt, creditsPerBooking)
    if (grant) return { candidate: entry, grantId: grant.id, skipped }
    skipped.push({ entry, reason: "no_valid_credit" })
  }
  return { candidate: null, grantId: null, skipped }
}
