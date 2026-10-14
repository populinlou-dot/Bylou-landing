import { describe, expect, it } from "vitest"
import {
  RepositoryError,
  cancelBooking,
  getAgendaWeek,
  getMyAccount,
  reserveSession,
  type AgendaEntry,
  type Clock,
} from "../../application"
import type { StudioRules } from "../../domain"
import { DEFAULT_STUDIO_RULES } from "../../config"
import { DEMO_OTP_CODE, MockAuth } from "./mock-auth"
import { MockBookingRepository, type MockThrottle } from "./mock-booking-repository"

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock: Clock = { now: () => new Date(NOW) }
const DAY = 24 * 60 * 60_000
/** Bylou rules (ADR-011): 24 h free cancellation, then deny. */
const BYLOU_RULES: StudioRules = { ...DEFAULT_STUDIO_RULES, cancellationWindowHours: 24, lateCancelPolicy: "deny" }
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

async function setup(rules: StudioRules = BYLOU_RULES, signIn = true, throttle?: MockThrottle) {
  const auth = new MockAuth()
  const repository = new MockBookingRepository({ clock, rules, currentUserId: () => auth.currentUserId(), throttle })
  if (signIn) {
    expect(await auth.requestCode("alumna@example.test")).toEqual({ ok: true, demoCode: DEMO_OTP_CODE })
    expect((await auth.verifyCode("alumna@example.test", DEMO_OTP_CODE)).ok).toBe(true)
  }
  const weeks = await Promise.all([0, 1].map((weekOffset) => getAgendaWeek({ repository, clock }, { weekOffset })))
  const entries = weeks.flatMap((w) => w.days.flatMap((d) => d.entries))
  const startsIn = (e: AgendaEntry) => Date.parse(e.session.startsAt) - Date.parse(NOW)
  const pick = (predicate: (e: AgendaEntry) => boolean) => {
    const found = entries.find(predicate)
    if (!found) throw new Error("demo seed has no matching session")
    return found.session.id
  }
  return {
    auth,
    repository,
    /** Bookable, more than 24 h ahead: cancellation refunds. */
    farId: pick((e) => e.state === "available" && startsIn(e) > 2 * DAY),
    otherFarId: pick((e) => e.state === "available" && startsIn(e) > 3 * DAY),
    /** Bookable, less than 24 h ahead: Bylou denies cancellation. */
    soonId: pick((e) => e.state === "available" && startsIn(e) < DAY),
    fullId: pick((e) => e.state === "full"),
  }
}

describe("mock auth (demo OTP shown on screen)", () => {
  it("rejects a wrong code and a malformed email", async () => {
    const auth = new MockAuth()
    expect(await auth.requestCode("not-an-email")).toEqual({ ok: false, code: "invalid_email" })
    await auth.requestCode("alumna@example.test")
    expect(await auth.verifyCode("alumna@example.test", "000000")).toEqual({ ok: false, code: "invalid_code" })
    expect(await auth.getUser()).toBeNull()
  })

  it("notifies subscribers on sign-in and sign-out", async () => {
    const auth = new MockAuth()
    const seen: Array<string | null> = []
    const off = auth.onChange((user) => seen.push(user?.email ?? null))
    await auth.requestCode("Alumna@Example.test")
    await auth.verifyCode("alumna@example.test", DEMO_OTP_CODE)
    await auth.signOut()
    off()
    expect(seen).toEqual([null, "alumna@example.test", null])
  })
})

describe("reserveSession with the mock adapter", () => {
  it("books, debits one credit and exposes myBookingId", async () => {
    const { repository, farId } = await setup()
    const before = await repository.getMyCreditBalance()
    const result = await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(1) })
    expect(result).toMatchObject({ ok: true, replayed: false, remainingCredits: before.available - 1 })
    const session = await repository.getSession(farId)
    expect(session?.myBookingId).toBe(result.ok ? result.bookingId : "x")
  })

  it("replays the same booking for a retried key without debiting twice", async () => {
    const { repository, farId, otherFarId } = await setup()
    const first = await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(2) })
    const retry = await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(2) })
    expect(first.ok && retry.ok).toBe(true)
    if (!first.ok || !retry.ok) return
    expect(retry.bookingId).toBe(first.bookingId)
    expect(retry.replayed).toBe(true)
    expect(retry.remainingCredits).toBe(first.remainingCredits)
    // Same key for another session is a client bug → invalid_input (RPC: 22023).
    expect(await reserveSession({ repository }, { sessionId: otherFarId, idempotencyKey: key(2) })).toEqual({
      ok: false,
      code: "invalid_input",
    })
  })

  it("refuses a full session, a second booking and a missing pack", async () => {
    const { repository, farId, fullId } = await setup()
    expect(await reserveSession({ repository }, { sessionId: fullId, idempotencyKey: key(3) })).toEqual({
      ok: false,
      code: "session_full",
    })
    await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(4) })
    expect(await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(5) })).toEqual({
      ok: false,
      code: "already_booked",
    })

    const greedy = await setup({ ...BYLOU_RULES, creditsPerBooking: 10 })
    expect(await reserveSession({ repository: greedy.repository }, { sessionId: greedy.farId, idempotencyKey: key(6) })).toEqual({
      ok: false,
      code: "no_valid_credit",
    })
  })

  it("validates input before calling the adapter", async () => {
    const { repository, farId } = await setup()
    expect(await reserveSession({ repository }, { sessionId: farId, idempotencyKey: "not-a-uuid" })).toEqual({
      ok: false,
      code: "invalid_input",
    })
    expect(await reserveSession({ repository }, { sessionId: "../x", idempotencyKey: key(7) })).toEqual({
      ok: false,
      code: "invalid_input",
    })
  })

  it("answers unauthenticated when signed out", async () => {
    const { repository, farId } = await setup(BYLOU_RULES, false)
    expect(await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(8) })).toEqual({
      ok: false,
      code: "unauthenticated",
    })
    await expect(repository.listMyBookings()).rejects.toBeInstanceOf(RepositoryError)
    expect(await repository.getSessionPrivateDetails(farId)).toBeNull()
  })
})

describe("cancelBooking with the mock adapter (Bylou: 24 h + deny)", () => {
  it("refunds outside the window and replays by state", async () => {
    const { repository, farId } = await setup()
    const booked = await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(10) })
    if (!booked.ok) throw new Error("booking failed")
    const balanceAfterBooking = (await repository.getMyCreditBalance()).available

    const cancelled = await cancelBooking({ repository }, { bookingId: booked.bookingId, idempotencyKey: key(11) })
    expect(cancelled).toEqual({ ok: true, bookingId: booked.bookingId, status: "cancelled", refunded: true, replayed: false })
    expect((await repository.getMyCreditBalance()).available).toBe(balanceAfterBooking + 1)

    const again = await cancelBooking({ repository }, { bookingId: booked.bookingId, idempotencyKey: key(12) })
    expect(again).toMatchObject({ ok: true, replayed: true, refunded: true })
    expect((await repository.getMyCreditBalance()).available).toBe(balanceAfterBooking + 1)
    expect((await repository.getSession(farId))?.myBookingId).toBeNull()
  })

  it("throttles churn like book_session (ADR-019): a 4th booking of one session in 24 h is refused; replays still answer", async () => {
    const { repository, farId, otherFarId } = await setup()
    for (let i = 0; i < 3; i++) {
      const booked = await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(40 + i) })
      if (!booked.ok) throw new Error(`booking ${i} failed: ${booked.code}`)
      expect(await cancelBooking({ repository }, { bookingId: booked.bookingId, idempotencyKey: key(50 + i) })).toMatchObject({ ok: true })
    }
    expect(await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(60) })).toEqual({ ok: false, code: "too_many_changes" })
    expect(await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(42) })).toMatchObject({ ok: true, replayed: true })
    expect(await reserveSession({ repository }, { sessionId: otherFarId, idempotencyKey: key(61) })).toMatchObject({ ok: true })
  })

  it("throttles after N self-cancellations in 24 h; null limits switch the throttle off", async () => {
    const limited = await setup(BYLOU_RULES, true, { maxSelfCancellations24h: 2, maxSessionBookings24h: null })
    for (let i = 0; i < 2; i++) {
      const booked = await reserveSession({ repository: limited.repository }, { sessionId: limited.farId, idempotencyKey: key(70 + i) })
      if (!booked.ok) throw new Error("booking failed")
      await cancelBooking({ repository: limited.repository }, { bookingId: booked.bookingId, idempotencyKey: key(80 + i) })
    }
    expect(await reserveSession({ repository: limited.repository }, { sessionId: limited.otherFarId, idempotencyKey: key(72) })).toEqual({
      ok: false,
      code: "too_many_changes",
    })

    const off = await setup(BYLOU_RULES, true, { maxSelfCancellations24h: null, maxSessionBookings24h: null })
    for (let i = 0; i < 5; i++) {
      const booked = await reserveSession({ repository: off.repository }, { sessionId: off.farId, idempotencyKey: key(90 + i) })
      if (!booked.ok) throw new Error(`booking ${i} failed: ${booked.code}`)
      await cancelBooking({ repository: off.repository }, { bookingId: booked.bookingId, idempotencyKey: key(100 + i) })
    }
  })

  it("denies inside the window without writing, and the account preview hides the button", async () => {
    const { repository, soonId } = await setup()
    const booked = await reserveSession({ repository }, { sessionId: soonId, idempotencyKey: key(13) })
    if (!booked.ok) throw new Error("booking failed")

    expect(await cancelBooking({ repository }, { bookingId: booked.bookingId, idempotencyKey: key(14), acceptLate: true })).toEqual({
      ok: false,
      code: "cancellation_too_late",
    })
    const account = await getMyAccount({ repository, clock })
    const entry = account.upcoming.find((e) => e.booking.id === booked.bookingId)
    expect(entry?.booking.status).toBe("confirmed")
    expect(entry?.cancellation).toEqual({ outcome: "denied", code: "cancellation_too_late" })
    expect(entry?.privateDetails).not.toBeNull()
  })

  it("allows a late cancellation without refund only with acceptLate (allow_without_refund studios)", async () => {
    const rules: StudioRules = { ...BYLOU_RULES, lateCancelPolicy: "allow_without_refund" }
    const { repository, soonId } = await setup(rules)
    const booked = await reserveSession({ repository }, { sessionId: soonId, idempotencyKey: key(15) })
    if (!booked.ok) throw new Error("booking failed")
    expect(await cancelBooking({ repository }, { bookingId: booked.bookingId, idempotencyKey: key(16) })).toEqual({
      ok: false,
      code: "cancellation_too_late",
    })
    expect(
      await cancelBooking({ repository }, { bookingId: booked.bookingId, idempotencyKey: key(17), acceptLate: true }),
    ).toEqual({ ok: true, bookingId: booked.bookingId, status: "late_cancelled", refunded: false, replayed: false })
  })

  it("answers not_found for unknown bookings", async () => {
    const { repository } = await setup()
    expect(await cancelBooking({ repository }, { bookingId: "demo-nope", idempotencyKey: key(18) })).toEqual({
      ok: false,
      code: "not_found",
    })
  })
})

describe("getMyAccount", () => {
  it("splits upcoming (soonest first) from history and reports the pack", async () => {
    const { repository, farId, soonId } = await setup()
    await reserveSession({ repository }, { sessionId: farId, idempotencyKey: key(20) })
    await reserveSession({ repository }, { sessionId: soonId, idempotencyKey: key(21) })
    const account = await getMyAccount({ repository, clock })

    expect(account.upcoming.map((e) => e.session.id)).toEqual([soonId, farId])
    expect(account.upcoming[1].cancellation).toEqual({ outcome: "refund" })
    expect(account.history).toHaveLength(1)
    expect(account.history[0].historyOutcome).toBe("attended")
    expect(account.balance.available).toBe(5)
    expect(account.rules.lateCancelPolicy).toBe("deny")
  })
})
