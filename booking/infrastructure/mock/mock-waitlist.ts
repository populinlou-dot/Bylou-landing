/**
 * In-memory waitlist for the `mock` data source (DEMO DATA ONLY). Mirrors migration 20261014001300:
 * FIFO, promotion only while the session starts more than `cancellationWindowHours` ahead (owner rule,
 * ADR-011), a student already booked, without a visible name, over the self-cancellation limit (ADR-019) or
 * without a valid pack is skipped, a promotion debits once with book_session's credit selection, writes a
 * `waitlist` booking and a system ledger debit.
 */
import {
  availability,
  isWaitlistPromotionOpen,
  nextWaitlistCandidate,
  toEpochMs,
  type Booking,
  type CreditGrant,
  type IsoDateTime,
  type Session,
  type StudioRules,
  type WaitlistEntry,
  type WaitlistSkipReason,
} from "../../domain"
import { hasVisibleName, type BookingSource } from "../../application"
import { appendLedger, type MockLedgerEntry } from "./mock-ledger"

export type WaitlistCloseReason = "session_cancelled" | "account_erased" | "booked"

/** Mirrors a `waitlist_entries` row. */
export interface MockWaitlistEntry extends WaitlistEntry {
  requestKey: string
  skipReason: WaitlistSkipReason | null
  closeReason: WaitlistCloseReason | null
  bookingId: string | null
  resolvedAt: IsoDateTime | null
}

/** The slice of the in-memory studio the waitlist reads and writes. */
export interface MockWaitlistStudio {
  sessions: Session[]
  bookings: Booking[]
  grants: CreditGrant[]
  ledger: MockLedgerEntry[]
  keys: Map<string, string>
  bookingSources: Record<string, BookingSource>
  waitlist: MockWaitlistEntry[]
  waitlistEnabled: boolean
  rules: StudioRules
  displayNames: Record<string, string>
  selfCancellations: { userId: string; at: IsoDateTime }[]
  throttle: { maxSelfCancellations24h: number | null }
}

/** Ids sort in creation order, so (createdAt, id) stays FIFO even when the demo clock is frozen. */
export function nextWaitlistId(entries: readonly MockWaitlistEntry[]): string {
  return `demo-wait-${String(entries.length + 1).padStart(5, "0")}`
}

const byQueue = (a: MockWaitlistEntry, b: MockWaitlistEntry) =>
  toEpochMs(a.createdAt) - toEpochMs(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** 1-based place of a waiting entry (null when it is not waiting). Mirrors private.waitlist_position. */
export function waitlistPosition(entries: readonly MockWaitlistEntry[], entry: MockWaitlistEntry): number | null {
  if (entry.status !== "waiting") return null
  return entries.filter((e) => e.sessionId === entry.sessionId && e.status === "waiting" && byQueue(e, entry) < 0).length + 1
}

export function resolveEntry(
  entry: MockWaitlistEntry,
  now: Date,
  patch: Pick<MockWaitlistEntry, "status"> & Partial<Pick<MockWaitlistEntry, "skipReason" | "closeReason" | "bookingId">>,
): void {
  Object.assign(entry, patch, { resolvedAt: now.toISOString() })
}

/** Closes every waiting entry that matches (session cancelled, account erased, booked directly). Returns how many. */
export function closeWaiting(
  entries: MockWaitlistEntry[],
  matches: (entry: MockWaitlistEntry) => boolean,
  reason: WaitlistCloseReason,
  now: Date,
): number {
  let closed = 0
  for (const entry of entries) {
    if (entry.status !== "waiting" || !matches(entry)) continue
    resolveEntry(entry, now, { status: "closed", closeReason: reason })
    closed++
  }
  return closed
}

function ineligibleReason(studio: MockWaitlistStudio, sessionId: string, userId: string, now: Date): WaitlistSkipReason | null {
  if (studio.bookings.some((b) => b.sessionId === sessionId && b.userId === userId && b.status === "confirmed")) {
    return "already_booked"
  }
  if (!hasVisibleName(studio.displayNames[userId])) return "profile_incomplete"
  const limit = studio.throttle.maxSelfCancellations24h
  const since = now.getTime() - 24 * 60 * 60_000
  if (limit !== null && studio.selfCancellations.filter((c) => c.userId === userId && toEpochMs(c.at) > since).length >= limit) {
    return "too_many_changes"
  }
  return null
}

/**
 * Fills free spots of one session from its waitlist (call after a spot opens: cancellation, capacity increase).
 * Returns the number of students promoted. Nothing happens when the waitlist is off or the session starts
 * within the cancellation window (the spot stays open for normal booking).
 */
export function promoteFromWaitlist(studio: MockWaitlistStudio, sessionId: string, now: Date): number {
  const session = studio.sessions.find((s) => s.id === sessionId)
  if (!studio.waitlistEnabled || !session || !isWaitlistPromotionOpen(session, studio.rules, now)) return 0
  const perBooking = studio.rules.creditsPerBooking
  let promoted = 0
  while (!availability(session, studio.bookings).isFull) {
    const selection = nextWaitlistCandidate(
      session,
      studio.waitlist,
      // Same rule as the RPC: a pack counts once it is valid now and still valid at the class.
      (userId) => studio.grants.filter((g) => g.userId === userId && toEpochMs(g.grantedAt) <= now.getTime()),
      perBooking,
      (userId) => ineligibleReason(studio, session.id, userId, now),
    )
    for (const skip of selection.skipped) {
      const entry = studio.waitlist.find((e) => e.id === skip.entry.id)
      if (entry) resolveEntry(entry, now, { status: "skipped", skipReason: skip.reason })
    }
    const entry = selection.candidate && studio.waitlist.find((e) => e.id === selection.candidate?.id)
    const grant = studio.grants.find((g) => g.id === selection.grantId)
    if (!entry || !grant) break

    grant.remaining -= perBooking
    const booking: Booking = {
      id: `demo-booking-${entry.id}`,
      sessionId: session.id,
      userId: entry.userId,
      status: "confirmed",
      attendance: "unknown",
      idempotencyKey: entry.id,
      creditGrantId: grant.id,
      createdAt: now.toISOString(),
    }
    studio.bookings.push(booking)
    studio.keys.set(`${entry.userId}|${entry.id}`, booking.id)
    studio.bookingSources[booking.id] = "waitlist"
    appendLedger(studio.ledger, {
      userId: entry.userId,
      grantId: grant.id,
      bookingId: booking.id,
      reason: "booking_debit",
      delta: -perBooking,
      actorId: null,
      createdAt: booking.createdAt,
    })
    resolveEntry(entry, now, { status: "promoted", bookingId: booking.id })
    promoted++
  }
  return promoted
}
