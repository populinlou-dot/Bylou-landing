import { describe, expect, it } from "vitest"
import { cancelBooking, getAgendaWeek, getMyAccount, joinWaitlist, leaveWaitlist, reserveSession, type Clock } from "../../application"
import { DEFAULT_STUDIO_RULES } from "../../config"
import type { StudioRules } from "../../domain"
import { MockAdminRepository } from "./mock-admin-repository"
import { DEMO_NEW_STUDENT_ID, DEMO_OTP_CODE, DEMO_USER_ID, MockAuth } from "./mock-auth"
import { MockBookingRepository } from "./mock-booking-repository"

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock: Clock = { now: () => new Date(NOW) }
const DAY = 24 * 60 * 60_000
const BYLOU_RULES: StudioRules = { ...DEFAULT_STUDIO_RULES, cancellationWindowHours: 24, lateCancelPolicy: "deny" }
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/** One mock studio, two demo students (alumna + "nueva") and the demo staff, switching identity by email. */
async function setup(options: { waitlistEnabled?: boolean } = {}) {
  const auth = new MockAuth()
  const currentUserId = () => auth.currentUserId()
  const repository = new MockBookingRepository({ clock, rules: BYLOU_RULES, currentUserId, waitlistEnabled: options.waitlistEnabled ?? true })
  const admin = new MockAdminRepository({ clock, store: repository, currentUserId })
  const as = async (email: string) => {
    await auth.requestCode(email)
    expect((await auth.verifyCode(email, DEMO_OTP_CODE)).ok).toBe(true)
  }
  const deps = { repository, clock, waitlist: true }
  const weeks = await Promise.all([0, 1].map((weekOffset) => getAgendaWeek(deps, { weekOffset })))
  const entries = weeks.flatMap((w) => w.days.flatMap((d) => d.entries))
  /** A free 1:1 more than 24 h ahead: one booking makes it full. */
  const individual = entries.find(
    (e) => e.capacity === 1 && e.state === "available" && Date.parse(e.session.startsAt) - Date.parse(NOW) > 2 * DAY,
  )
  if (!individual) throw new Error("demo seed has no free 1:1 more than 2 days ahead")
  const soonFull = entries.find((e) => e.state === "full" && Date.parse(e.session.startsAt) - Date.parse(NOW) < DAY)
  if (!soonFull) throw new Error("demo seed has no full session inside 24 h")
  return { auth, repository, admin, as, deps, sessionId: individual.session.id, soonFullId: soonFull.session.id }
}

describe("mock waitlist (mirrors migration 20261014001300)", () => {
  it("requires a display name to book or join (profile_incomplete), then works once she has one", async () => {
    const { repository, as, sessionId } = await setup()
    await as("nueva@demo.test")
    expect(await reserveSession({ repository }, { sessionId, idempotencyKey: key(1) })).toEqual({ ok: false, code: "profile_incomplete" })
    expect(await repository.updateMyDisplayName("Nora")).toEqual({ ok: true, displayName: "Nora" })
    expect((await reserveSession({ repository }, { sessionId, idempotencyKey: key(1) })).ok).toBe(true)
  })

  it("join → place 1; cancel by the holder promotes her with one debit and a 'waitlist' booking", async () => {
    const { repository, as, deps, sessionId } = await setup()
    await as("nueva@demo.test")
    await repository.updateMyDisplayName("Nora")
    const held = await reserveSession({ repository }, { sessionId, idempotencyKey: key(1) })
    if (!held.ok) throw new Error("setup booking failed")

    await as("alumna@demo.test")
    const before = (await repository.getMyCreditBalance()).available
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(2) })).toMatchObject({ ok: true, position: 1, replayed: false })
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(2) })).toMatchObject({ ok: true, position: 1, replayed: true })
    expect((await getAgendaWeek(deps, { weekOffset: 1 })).days.flatMap((d) => d.entries).find((e) => e.session.id === sessionId)).toMatchObject(
      { action: "waiting", myWaitlistPosition: 1 },
    )

    await as("nueva@demo.test")
    expect(await cancelBooking({ repository }, { bookingId: held.bookingId, idempotencyKey: key(3) })).toMatchObject({ ok: true, refunded: true })

    await as("alumna@demo.test")
    const account = await getMyAccount(deps)
    const promoted = account.upcoming.find((b) => b.session.id === sessionId)
    expect(promoted?.source).toBe("waitlist")
    expect(account.balance.available).toBe(before - 1)
    expect(account.waitlist).toEqual([])
    expect(await leaveWaitlist({ repository }, sessionId)).toMatchObject({ ok: true, status: "promoted", replayed: true })
  })

  it("skips a waiting student without a valid pack (she sees it) and promotes the next one", async () => {
    const { repository, admin, as, deps, sessionId } = await setup()
    // The demo staff account holds no pack: as a "student" it is the one without credit.
    await as("staff@demo.test")
    const full = await admin.bookForStudent({ userId: DEMO_USER_ID, sessionId, requestKey: key(1) })
    if (!full.ok) throw new Error("setup booking failed")
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(2) })).toMatchObject({ ok: true, position: 1 })
    await as("nueva@demo.test")
    await repository.updateMyDisplayName("Nora")
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(3) })).toMatchObject({ ok: true, position: 2 })

    await as("staff@demo.test")
    expect(await admin.cancelForStudent({ bookingId: full.bookingId, refund: true })).toMatchObject({ ok: true, promoted: 1 })
    const roster = await admin.getWaitlist(sessionId)
    expect(roster.map((e) => [e.userId, e.status, e.skipReason])).toEqual([
      ["demo-staff", "skipped", "no_valid_credit"],
      [DEMO_NEW_STUDENT_ID, "promoted", null],
    ])
    // Staff sees her (skipped) entry in Mis reservas as a student would.
    expect((await getMyAccount(deps)).waitlist.map((w) => w.status)).toEqual(["skipped"])
  })

  it("inside the cancellation window: joining is closed and nobody is promoted", async () => {
    const { repository, as, soonFullId } = await setup()
    await as("alumna@demo.test")
    expect(await joinWaitlist({ repository }, { sessionId: soonFullId, requestKey: key(1) })).toEqual({ ok: false, code: "waitlist_closed" })
  })

  it("a capacity increase promotes FIFO; a session cancel closes the rest", async () => {
    const { repository, admin, as, sessionId } = await setup()
    await as("staff@demo.test")
    expect((await admin.bookForStudent({ userId: DEMO_USER_ID, sessionId, requestKey: key(1) })).ok).toBe(true)
    await as("nueva@demo.test")
    await repository.updateMyDisplayName("Nora")
    await joinWaitlist({ repository }, { sessionId, requestKey: key(2) })
    await as("staff@demo.test")
    await joinWaitlist({ repository }, { sessionId, requestKey: key(3) })

    expect(await admin.updateSessionCapacity({ sessionId, capacity: 2 })).toMatchObject({ ok: true, promoted: 1, confirmedCount: 2 })
    expect((await admin.getWaitlist(sessionId)).map((e) => e.status)).toEqual(["promoted", "waiting"])
    expect(await admin.cancelSession({ sessionId })).toMatchObject({ ok: true })
    expect((await admin.getWaitlist(sessionId)).map((e) => e.status)).toEqual(["promoted", "closed"])
  })

  it("refuses everything when the waitlist is off", async () => {
    const { repository, as, sessionId } = await setup({ waitlistEnabled: false })
    await as("alumna@demo.test")
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(1) })).toEqual({ ok: false, code: "waitlist_disabled" })
    expect(await leaveWaitlist({ repository }, sessionId)).toEqual({ ok: false, code: "waitlist_disabled" })
    expect(await repository.listMyWaitlist()).toEqual([])
  })

  it("joining a session with a free spot is refused; leaving is state-idempotent", async () => {
    const { repository, admin, as, sessionId } = await setup()
    await as("alumna@demo.test")
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(1) })).toEqual({ ok: false, code: "session_not_full" })
    expect(await leaveWaitlist({ repository }, sessionId)).toEqual({ ok: false, code: "not_found" })
    await as("staff@demo.test")
    expect((await admin.bookForStudent({ userId: DEMO_USER_ID, sessionId, requestKey: key(2) })).ok).toBe(true)
    await as("nueva@demo.test")
    await repository.updateMyDisplayName("Nora")
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(3) })).toMatchObject({ ok: true, position: 1 })
    expect(await leaveWaitlist({ repository }, sessionId)).toMatchObject({ ok: true, status: "left", replayed: false })
    expect(await leaveWaitlist({ repository }, sessionId)).toMatchObject({ ok: true, status: "left", replayed: true })
  })

  it("applies the self-cancellation limit (ADR-019) to joins and to promotion; skips students without a name", async () => {
    const auth = new MockAuth()
    const currentUserId = () => auth.currentUserId()
    const repository = new MockBookingRepository({
      clock,
      rules: BYLOU_RULES,
      currentUserId,
      waitlistEnabled: true,
      throttle: { maxSelfCancellations24h: 1, maxSessionBookings24h: null },
    })
    const admin = new MockAdminRepository({ clock, store: repository, currentUserId })
    const as = async (email: string) => {
      await auth.requestCode(email)
      await auth.verifyCode(email, DEMO_OTP_CODE)
    }
    const deps = { repository, clock, waitlist: true }
    const entries = (await getAgendaWeek(deps, { weekOffset: 1 })).days.flatMap((d) => d.entries)
    const [first, second] = entries.filter((e) => e.capacity === 1 && e.state === "available").map((e) => e.session.id)

    // The demo student cancels once herself → at the limit.
    await as("alumna@demo.test")
    const own = await reserveSession({ repository }, { sessionId: second, idempotencyKey: key(9) })
    if (!own.ok) throw new Error("setup booking failed")
    await cancelBooking({ repository }, { bookingId: own.bookingId, idempotencyKey: key(10) })

    await as("staff@demo.test")
    const held = await admin.bookForStudent({ userId: DEMO_NEW_STUDENT_ID, sessionId: first, requestKey: key(1) })
    if (!held.ok) throw new Error("setup booking failed")
    await as("alumna@demo.test")
    expect(await joinWaitlist({ repository }, { sessionId: first, requestKey: key(2) })).toEqual({ ok: false, code: "too_many_changes" })

    // She still waits from before (fixture): when the spot opens she is skipped as over the limit.
    const state = repository.sharedState()
    state.waitlist.push(
      { id: "demo-wait-a", sessionId: first, userId: DEMO_USER_ID, status: "waiting", createdAt: "2026-10-13T00:00:00.000Z", requestKey: key(3), skipReason: null, closeReason: null, bookingId: null, resolvedAt: null },
    )
    await as("staff@demo.test")
    expect(await admin.cancelForStudent({ bookingId: held.bookingId, refund: true })).toMatchObject({ ok: true, promoted: 0 })
    expect((await admin.getWaitlist(first)).map((e) => [e.userId, e.skipReason])).toEqual([[DEMO_USER_ID, "too_many_changes"]])
  })

  it("caps a student's open entries at 10 (too_many_waitlists)", async () => {
    const { repository, as, sessionId } = await setup()
    const state = repository.sharedState()
    const future = state.sessions.filter((s) => Date.parse(s.startsAt) > Date.parse(NOW) && s.id !== sessionId).slice(0, 10)
    future.forEach((s, i) =>
      state.waitlist.push({ id: `demo-wait-x${i}`, sessionId: s.id, userId: DEMO_USER_ID, status: "waiting", createdAt: NOW, requestKey: key(100 + i), skipReason: null, closeReason: null, bookingId: null, resolvedAt: null }),
    )
    await as("nueva@demo.test")
    await repository.updateMyDisplayName("Nora")
    expect((await reserveSession({ repository }, { sessionId, idempotencyKey: key(1) })).ok).toBe(true)
    await as("alumna@demo.test")
    expect(await joinWaitlist({ repository }, { sessionId, requestKey: key(2) })).toEqual({ ok: false, code: "too_many_waitlists" })
  })
})

