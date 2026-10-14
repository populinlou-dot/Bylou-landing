/** Test data builders (domain-pure, no test-runner imports). */
import type { Booking, CreditGrant, Session, StudioRules, WaitlistEntry } from "./types"

/** Session starts Tue 2026-10-20 22:00Z (19:00 Buenos Aires). */
export const START = "2026-10-20T22:00:00.000Z"

export const RULES: StudioRules = {
  timezone: "America/Argentina/Buenos_Aires",
  bookingWindow: { opensDaysBefore: 30, closesMinutesBefore: 0 },
  cancellationWindowHours: 24,
  lateCancelPolicy: "allow_without_refund",
  creditsPerBooking: 1,
}

/** Instant `ms` milliseconds relative to START (negative = before). */
export const atOffset = (ms: number): Date => new Date(Date.parse(START) + ms)

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    classTypeId: "ct-individual",
    startsAt: START,
    endsAt: "2026-10-20T23:00:00.000Z",
    capacity: 2,
    modality: "online",
    status: "scheduled",
    ...overrides,
  }
}

export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    sessionId: "s1",
    userId: "u-other",
    status: "confirmed",
    attendance: "unknown",
    idempotencyKey: "key-1",
    creditGrantId: "g-other",
    createdAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  }
}

export function makeGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: "g1",
    userId: "u1",
    total: 4,
    remaining: 4,
    grantedAt: "2026-10-01T12:00:00.000Z",
    expiresAt: "2026-10-31T12:00:00.000Z",
    ...overrides,
  }
}

export function makeWaitlistEntry(overrides: Partial<WaitlistEntry> = {}): WaitlistEntry {
  return {
    id: "w1",
    sessionId: "s1",
    userId: "u1",
    status: "waiting",
    createdAt: "2026-10-10T12:00:00.000Z",
    ...overrides,
  }
}
