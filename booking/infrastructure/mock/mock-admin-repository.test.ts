import { describe, expect, it } from "vitest"
import {
  adjustCredits,
  anonymizeStudent,
  bookForStudent,
  cancelForStudent,
  cancelSession,
  createSessions,
  getStudentDetail,
  grantPack,
  searchStudents,
  getAdminDay,
  getAdminSessionDetail,
  markAttendance,
  reserveSession,
  resolveStaffAccess,
  saveClassType,
  updateSessionCapacity,
  type Clock,
} from "../../application"
import { DEFAULT_STUDIO_RULES } from "../../config"
import { MockAdminRepository } from "./mock-admin-repository"
import { DEMO_OTP_CODE, DEMO_STAFF_EMAIL, DEMO_STAFF_ID, DEMO_USER_ID, MockAuth } from "./mock-auth"
import { MockBookingRepository } from "./mock-booking-repository"

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock: Clock = { now: () => new Date(NOW) }
const rules = DEFAULT_STUDIO_RULES

async function setup(email: string | null) {
  const auth = new MockAuth()
  const currentUserId = () => auth.currentUserId()
  const repository = new MockBookingRepository({ clock, rules, currentUserId })
  const admin = new MockAdminRepository({ clock, store: repository, currentUserId })
  if (email) {
    await auth.requestCode(email)
    expect((await auth.verifyCode(email, DEMO_OTP_CODE)).ok).toBe(true)
  }
  return { auth, repository, admin, deps: { admin, repository, clock } }
}

describe("MockAdminRepository (demo staff)", () => {
  it("signs staff@… in as the demo staff member; anyone else is a student", async () => {
    const staff = await setup(DEMO_STAFF_EMAIL)
    expect(staff.auth.currentUserId()).toBe(DEMO_STAFF_ID)
    expect(await resolveStaffAccess(staff)).toBe("staff")
    expect(await resolveStaffAccess(await setup("alumna@example.test"))).toBe("forbidden")
    expect(await resolveStaffAccess(await setup(null))).toBe("signed_out")
  })

  it("refuses admin reads and writes for students and anonymous visitors", async () => {
    const student = await setup("alumna@example.test")
    await expect(student.admin.listSessions({ from: NOW, to: NOW })).rejects.toMatchObject({ code: "forbidden" })
    await expect(student.admin.getRoster("x")).rejects.toMatchObject({ code: "forbidden" })
    expect(await student.admin.markAttendance({ bookingId: "x", attendance: "attended" })).toEqual({ ok: false, code: "forbidden" })
    const anon = await setup(null)
    await expect(anon.admin.getSession("x")).rejects.toMatchObject({ code: "unauthenticated" })
  })

  it("shows today's demo sessions with occupancy and a roster of fictional names", async () => {
    const { deps } = await setup(DEMO_STAFF_EMAIL)
    const day = await getAdminDay(deps)
    expect(day.date).toBe("2026-10-14")
    const withBookings = day.sessions.find((s) => s.confirmedCount > 0)
    expect(withBookings).toBeTruthy()
    const detail = await getAdminSessionDetail(deps, { id: withBookings!.session.id })
    const confirmed = detail!.roster.filter((r) => r.status === "confirmed")
    expect(confirmed).toHaveLength(withBookings!.confirmedCount)
    expect(detail!.roster.some((r) => r.status === "cancelled")).toBe(true)
    expect(confirmed.every((r) => (r.displayName ?? r.email ?? "").includes("demo"))).toBe(true)
  })

  it("records attendance inside the window and refuses outside it (server-like)", async () => {
    const { deps } = await setup(DEMO_STAFF_EMAIL)
    const today = await getAdminDay(deps)
    // Most recent past day with a booked session (the window stays open for 7 days).
    const pastDays = await Promise.all(["2026-10-13", "2026-10-12", "2026-10-10", "2026-10-09"].map((date) => getAdminDay(deps, { date })))
    const started = pastDays.flatMap((d) => d.sessions).find((s) => s.attendanceWindow === "open" && s.confirmedCount > 0)!
    const roster = (await getAdminSessionDetail(deps, { id: started.session.id }))!.roster
    const booking = roster.find((r) => r.status === "confirmed")!
    expect(await markAttendance(deps, { bookingId: booking.bookingId, attendance: "attended" })).toEqual({
      ok: true,
      bookingId: booking.bookingId,
      attendance: "attended",
    })
    const after = (await getAdminSessionDetail(deps, { id: started.session.id }))!.roster
    expect(after.find((r) => r.bookingId === booking.bookingId)?.attendance).toBe("attended")

    const cancelled = roster.find((r) => r.status === "cancelled")!
    expect(await markAttendance(deps, { bookingId: cancelled.bookingId, attendance: "attended" })).toEqual({ ok: false, code: "not_found" })

    const future = today.sessions.find((s) => s.attendanceWindow === "not_yet" && s.confirmedCount > 0)
    if (future) {
      const futureBooking = (await getAdminSessionDetail(deps, { id: future.session.id }))!.roster.find((r) => r.status === "confirmed")!
      expect(await markAttendance(deps, { bookingId: futureBooking.bookingId, attendance: "no_show" })).toEqual({
        ok: false,
        code: "attendance_window_closed",
      })
    }
  })

  it("sees a booking the demo student just made in the same in-memory studio", async () => {
    const auth = new MockAuth()
    const currentUserId = () => auth.currentUserId()
    const repository = new MockBookingRepository({ clock, rules, currentUserId })
    const admin = new MockAdminRepository({ clock, store: repository, currentUserId })
    await auth.requestCode("alumna@example.test")
    await auth.verifyCode("alumna@example.test", DEMO_OTP_CODE)
    const sessions = await repository.listSessions({ from: NOW, to: "2026-10-21T03:00:00.000Z" })
    const target = sessions.find((s) => s.session.status === "scheduled" && s.confirmedCount < s.session.capacity)!
    const booked = await reserveSession({ repository }, { sessionId: target.session.id, idempotencyKey: "00000000-0000-4000-8000-000000000001" })
    expect(booked.ok).toBe(true)

    await auth.signOut()
    await auth.requestCode(DEMO_STAFF_EMAIL)
    await auth.verifyCode(DEMO_STAFF_EMAIL, DEMO_OTP_CODE)
    const roster = await admin.getRoster(target.session.id)
    expect(roster.some((r) => r.displayName === "Alumna demo" && r.status === "confirmed")).toBe(true)
  })

  it("shows the name the student saved in the profile step, as plain data", async () => {
    const auth = new MockAuth()
    const currentUserId = () => auth.currentUserId()
    const repository = new MockBookingRepository({ clock, rules, currentUserId })
    const admin = new MockAdminRepository({ clock, store: repository, currentUserId })
    await auth.requestCode("alumna@example.test")
    await auth.verifyCode("alumna@example.test", DEMO_OTP_CODE)
    expect(await repository.getMyProfile()).toEqual({ displayName: "Alumna demo" })
    expect(await repository.updateMyDisplayName("<b>Ana</b>")).toEqual({ ok: true, displayName: "<b>Ana</b>" })
    expect(await repository.getMyProfile()).toEqual({ displayName: "<b>Ana</b>" })

    await auth.signOut()
    await auth.requestCode(DEMO_STAFF_EMAIL)
    await auth.verifyCode(DEMO_STAFF_EMAIL, DEMO_OTP_CODE)
    const students = await admin.searchStudents("")
    expect(students.find((s) => s.userId === "demo-alumna")?.displayName).toBe("<b>Ana</b>")
  })
})

const KEY_A = "00000000-0000-4000-8000-00000000a001"
const KEY_B = "00000000-0000-4000-8000-00000000b001"
const TZ = rules.timezone

async function signInAs(auth: MockAuth, email: string) {
  await auth.signOut()
  await auth.requestCode(email)
  expect((await auth.verifyCode(email, DEMO_OTP_CODE)).ok).toBe(true)
}

describe("MockAdminRepository Phase 4.2 writes (mirror the RPCs)", () => {
  const draft = {
    classTypeId: "demo-grupal",
    localDate: "2026-10-22",
    localStart: "07:00",
    durationMinutes: 60,
    capacity: 3,
    modality: "in_person" as const,
    locationLabel: "Palermo",
    address: "Calle Falsa 123",
    meetingUrl: null,
    instructorName: "Lou",
    repeatWeeks: 3,
  }

  it("creates a weekly series once (replay on the key), visible to students right away", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const first = await createSessions({ admin, clock }, { ...draft, requestKey: KEY_A }, { timezone: TZ })
    const replay = await createSessions({ admin, clock }, { ...draft, requestKey: KEY_A }, { timezone: TZ })
    expect(first.ok && first.sessionIds).toHaveLength(3)
    expect(replay).toEqual({ ok: true, sessionIds: first.ok ? first.sessionIds : [], replayed: true })
    const created = await repository.getSession(first.ok ? first.sessionIds[2] : "")
    // 07:00 Buenos Aires on the third Thursday = 10:00 UTC.
    expect(created?.session.startsAt).toBe("2026-11-05T10:00:00.000Z")
    expect(created?.instructorName).toBe("Lou")
  })

  it("is all or nothing: a series starting in the past creates nothing", async () => {
    const { admin } = await setup(DEMO_STAFF_EMAIL)
    const before = (await admin.listSessions({ from: "2026-10-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" })).length
    expect(await admin.createSessions({ ...draft, localDate: "2026-10-14", localStart: "06:00", requestKey: KEY_B })).toEqual({
      ok: false,
      code: "invalid_input",
    })
    expect((await admin.listSessions({ from: "2026-10-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" })).length).toBe(before)
  })

  it("archiving a class type hides it from students and makes its sessions unbookable", async () => {
    const { auth, admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const types = await admin.listClassTypes()
    const grupal = types.find((t) => t.id === "demo-grupal")!
    const saved = await saveClassType({ admin }, { ...grupal, isPublished: false })
    expect(saved).toMatchObject({ ok: true, created: false, isPublished: false })
    expect(saved.ok && saved.upcomingSessions).toBeGreaterThan(0)
    expect(await admin.createSessions({ ...draft, requestKey: KEY_B })).toEqual({ ok: false, code: "invalid_input" })

    await signInAs(auth, "alumna@example.test")
    expect((await repository.listClassTypes()).some((t) => t.id === "demo-grupal")).toBe(false)
    const week = await repository.listSessions({ from: NOW, to: "2026-10-21T03:00:00.000Z" })
    expect(week.some((s) => s.session.classTypeId === "demo-grupal")).toBe(false)
    const hidden = (await (await setup(DEMO_STAFF_EMAIL)).admin.listSessions({ from: NOW, to: "2026-10-21T03:00:00.000Z" })).find(
      (s) => s.session.classTypeId === "demo-grupal" && s.session.status === "scheduled",
    )!
    expect(await repository.book({ sessionId: hidden.session.id, idempotencyKey: KEY_A })).toEqual({ ok: false, code: "not_found" })
  })

  it("creates a new class type with a client id; a retry updates it instead of duplicating", async () => {
    const { admin } = await setup(DEMO_STAFF_EMAIL)
    const cmd = { id: KEY_A, name: "Yin", description: null, durationMinutes: 90, defaultCapacity: 6, defaultModality: "online" as const, isPublished: true }
    expect(await admin.saveClassType(cmd)).toMatchObject({ ok: true, created: true })
    expect(await admin.saveClassType(cmd)).toMatchObject({ ok: true, created: false })
    expect((await admin.listClassTypes()).filter((t) => t.name === "Yin")).toHaveLength(1)
  })

  it("capacity: never below confirmed bookings, not on cancelled or started sessions", async () => {
    const { admin } = await setup(DEMO_STAFF_EMAIL)
    const all = await admin.listSessions({ from: "2026-10-05T03:00:00.000Z", to: "2026-11-10T03:00:00.000Z" })
    const booked = all.find((s) => s.session.status === "scheduled" && s.confirmedCount >= 2 && s.session.startsAt > NOW)!
    expect(await updateSessionCapacity({ admin }, { sessionId: booked.session.id, capacity: booked.confirmedCount - 1 })).toEqual({
      ok: false,
      code: "capacity_below_bookings",
      confirmedCount: booked.confirmedCount,
    })
    expect(await admin.updateSessionCapacity({ sessionId: booked.session.id, capacity: booked.confirmedCount })).toMatchObject({
      ok: true,
      capacity: booked.confirmedCount,
    })
    const cancelled = all.find((s) => s.session.status === "cancelled")!
    expect(await admin.updateSessionCapacity({ sessionId: cancelled.session.id, capacity: 5 })).toEqual({ ok: false, code: "session_cancelled" })
    const past = all.find((s) => s.session.status === "scheduled" && s.session.startsAt < NOW)!
    expect(await admin.updateSessionCapacity({ sessionId: past.session.id, capacity: 5 })).toEqual({ ok: false, code: "session_started" })
  })

  it("cancel refunds the demo student's credit exactly once (replay refunds nothing)", async () => {
    const { auth, admin, repository } = await setup("alumna@example.test")
    const week = await repository.listSessions({ from: NOW, to: "2026-10-21T03:00:00.000Z" })
    const target = week.find((s) => s.session.status === "scheduled" && s.confirmedCount < s.session.capacity && s.session.startsAt > NOW)!
    expect((await reserveSession({ repository }, { sessionId: target.session.id, idempotencyKey: KEY_A })).ok).toBe(true)
    const before = (await repository.getMyCreditBalance()).available

    await signInAs(auth, DEMO_STAFF_EMAIL)
    const first = await cancelSession({ admin }, { sessionId: target.session.id })
    expect(first).toMatchObject({ ok: true, cancelledBookings: target.confirmedCount + 1, refunded: 1, refundsSkipped: [], replayed: false })
    expect(await cancelSession({ admin }, { sessionId: target.session.id })).toMatchObject({ ok: true, refunded: 0, replayed: true })

    await signInAs(auth, "alumna@example.test")
    expect((await repository.getMyCreditBalance()).available).toBe(before + 1)
    const mine = await repository.listMyBookings()
    expect(mine.find((b) => b.session.id === target.session.id)).toMatchObject({ refunded: true, booking: { status: "cancelled" } })
  })

  it("students and visitors cannot write", async () => {
    const student = await setup("alumna@example.test")
    expect(await student.admin.cancelSession({ sessionId: "x" })).toEqual({ ok: false, code: "forbidden" })
    expect(await student.admin.updateSessionCapacity({ sessionId: "x", capacity: 2 })).toEqual({ ok: false, code: "forbidden" })
    await expect(student.admin.listClassTypes()).rejects.toMatchObject({ code: "forbidden" })
    const anon = await setup(null)
    expect(await anon.admin.createSessions({ ...draft, requestKey: KEY_A })).toEqual({ ok: false, code: "unauthenticated" })
  })
})

describe("MockAdminRepository Phase 4.3 students + credits (mirror the RPCs)", () => {
  const KEY_G = "00000000-0000-4000-8000-0000000000c1"
  const KEY_ADJ = "00000000-0000-4000-8000-0000000000c2"
  const KEY_BOOK = "00000000-0000-4000-8000-0000000000c3"

  /** I6 in the demo: every pack's remaining = Σ its ledger deltas. */
  function ledgerMismatches(repository: MockBookingRepository): string[] {
    const { grants, ledger } = repository.sharedState()
    return grants
      .filter((g) => g.remaining !== ledger.filter((e) => e.grantId === g.id).reduce((sum, e) => sum + e.delta, 0))
      .map((g) => g.id)
  }

  it("lists demo students (accent-insensitive search), never staff; students and anon are refused", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const all = await searchStudents({ admin }, "")
    expect(all.some((s) => s.userId === DEMO_USER_ID && s.balance === 7)).toBe(true)
    expect(all.some((s) => s.userId === DEMO_STAFF_ID)).toBe(false)
    expect((await searchStudents({ admin }, "BELEN")).map((s) => s.displayName)).toEqual(["Belén (demo)"])
    expect(ledgerMismatches(repository)).toEqual([])
    const student = await setup("alumna@example.test")
    await expect(searchStudents({ admin: student.admin }, "")).rejects.toMatchObject({ code: "forbidden" })
    expect(await student.admin.grantCredits({ userId: DEMO_USER_ID, credits: 1, validDays: 1, note: null, requestKey: KEY_G })).toEqual({
      ok: false,
      code: "forbidden",
    })
  })

  it("grants a pack once per request key, valid through the chosen local day, with its ledger row", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const cmd = { userId: "demo-user-1", draft: { credits: 4, expiresOn: "2026-11-12", note: " Pack 4 " }, requestKey: KEY_G }
    const first = await grantPack({ admin, clock }, cmd, { timezone: TZ })
    const again = await grantPack({ admin, clock }, cmd, { timezone: TZ })
    expect(first).toMatchObject({ ok: true, credits: 4, expiresAt: "2026-11-13T03:00:00.000Z", replayed: false })
    expect(again).toMatchObject({ ok: true, replayed: true })
    const detail = await getStudentDetail({ admin, repository, clock }, { id: "demo-user-1" })
    expect(detail?.student.balance).toBe(4)
    expect(detail?.activeGrants).toHaveLength(1)
    expect(detail?.ledger.map((e) => [e.reason, e.delta, e.note, e.actor])).toEqual([["grant", 4, "Pack 4", "staff"]])
    expect(ledgerMismatches(repository)).toEqual([])
  })

  it("adjusts one pack within 0..size, with the reason in the ledger; replays on the key", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const grant = { remaining: 7, total: 8 }
    const tooMany = await admin.adjustCredits({ grantId: "demo-grant-1", delta: -8, reason: "x", requestKey: KEY_B })
    expect(tooMany).toEqual({ ok: false, code: "insufficient_balance", creditsRemaining: 7 })
    // 7 left of 8, but the attended history booking still holds 1 (it could be refunded): +1 does not fit.
    expect(await admin.adjustCredits({ grantId: "demo-grant-1", delta: 1, reason: "x", requestKey: KEY_B })).toMatchObject({
      code: "adjust_exceeds_pack",
    })
    const draft = { grantId: "demo-grant-1", direction: "remove" as const, amount: 2, reason: "Clase tomada fuera de la app" }
    const ok = await adjustCredits({ admin }, { draft, grant, requestKey: KEY_ADJ })
    expect(ok).toMatchObject({ ok: true, delta: -2, creditsRemaining: 5, balance: 5, replayed: false })
    expect(await adjustCredits({ admin }, { draft, grant, requestKey: KEY_ADJ })).toMatchObject({ ok: true, replayed: true, creditsRemaining: 5 })
    const detail = await getStudentDetail({ admin, repository, clock }, { id: DEMO_USER_ID })
    expect(detail?.ledger[0]).toMatchObject({ reason: "admin_adjust", delta: -2, note: "Clase tomada fuera de la app", actor: "staff" })
    expect(detail?.ledger.filter((e) => e.reason === "admin_adjust")).toHaveLength(1)
    expect(ledgerMismatches(repository)).toEqual([])
  })

  it("books on behalf outside the booking window, respects capacity, then cancels with a refund", async () => {
    const { auth, admin, repository } = await setup(DEMO_STAFF_EMAIL)
    // 42 days ahead: not open for students (30 days), and a 60-day pack covers it.
    const created = await createSessions({ admin, clock }, { ...draftSession("2026-11-25"), requestKey: KEY_A }, { timezone: TZ })
    expect(created.ok).toBe(true)
    const sessionId = created.ok ? created.sessionIds[0] : ""
    await grantPack({ admin, clock }, { userId: DEMO_USER_ID, draft: { credits: 2, expiresOn: "2026-12-12", note: "" }, requestKey: KEY_G }, { timezone: TZ })

    await signInAs(auth, "alumna@example.test")
    expect(await reserveSession({ repository }, { sessionId, idempotencyKey: KEY_B })).toEqual({ ok: false, code: "booking_not_open" })
    await signInAs(auth, DEMO_STAFF_EMAIL)

    const booked = await bookForStudent({ admin }, { userId: DEMO_USER_ID, sessionId, requestKey: KEY_BOOK })
    expect(booked).toMatchObject({ ok: true, replayed: false })
    expect(await bookForStudent({ admin }, { userId: DEMO_USER_ID, sessionId, requestKey: KEY_BOOK })).toMatchObject({ ok: true, replayed: true })
    // Capacity 1: the staff booking filled it, so nobody else gets in (capacity is never bypassed).
    expect(await bookForStudent({ admin }, { userId: "demo-user-1", sessionId, requestKey: KEY_B })).toEqual({ ok: false, code: "session_full" })
    expect(await bookForStudent({ admin }, { userId: DEMO_STAFF_ID, sessionId, requestKey: KEY_B })).toEqual({ ok: false, code: "not_found" })

    const detail = await getStudentDetail({ admin, repository, clock }, { id: DEMO_USER_ID })
    const upcoming = detail!.upcoming.find((b) => b.sessionId === sessionId)!
    expect(upcoming.source).toBe("staff")
    expect(detail!.ledger[0]).toMatchObject({ reason: "booking_debit", actor: "staff" })

    expect(await bookForStudent({ admin }, { userId: DEMO_USER_ID, sessionId, requestKey: KEY_A })).toEqual({ ok: false, code: "already_booked" })

    const bookingId = booked.ok ? booked.bookingId : ""
    expect(await cancelForStudent({ admin }, { bookingId, refund: true })).toEqual({
      ok: true,
      bookingId,
      refunded: true,
      refundSkipped: false,
      replayed: false,
    })
    expect(await cancelForStudent({ admin }, { bookingId, refund: true })).toMatchObject({ ok: true, replayed: true, refunded: true })
    const after = await getStudentDetail({ admin, repository, clock }, { id: DEMO_USER_ID })
    expect(after!.ledger.filter((e) => e.reason === "cancel_refund" && e.bookingId === bookingId)).toHaveLength(1)
    expect(ledgerMismatches(repository)).toEqual([])
  })

  it("erases a student's personal data (ADR-020): email guard, upcoming bookings first, history kept, idempotent", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const id = "demo-user-4" // the one demo student without a name: her email is shown, so it can be confirmed
    const before = await getStudentDetail({ admin, repository, clock }, { id })
    const email = before!.student.email!
    expect(before!.upcoming.length).toBeGreaterThan(0)
    expect(await anonymizeStudent({ admin }, { userId: id, confirmEmail: "otra@demo.test" })).toEqual({ ok: false, code: "email_mismatch" })
    expect(await anonymizeStudent({ admin }, { userId: id, confirmEmail: "   " })).toEqual({ ok: false, code: "invalid_input" })
    expect(await anonymizeStudent({ admin }, { userId: DEMO_STAFF_ID, confirmEmail: email })).toEqual({ ok: false, code: "not_found" })

    for (const booking of before!.upcoming) {
      expect(await anonymizeStudent({ admin }, { userId: id, confirmEmail: email })).toMatchObject({ ok: false, code: "has_upcoming_bookings" })
      await cancelForStudent({ admin }, { bookingId: booking.bookingId, refund: true })
    }
    const erased = await anonymizeStudent({ admin }, { userId: id, confirmEmail: `  ${email.toUpperCase()} ` })
    expect(erased).toEqual({ ok: true, userId: id, anonymizedAt: NOW, replayed: false })
    expect(await anonymizeStudent({ admin }, { userId: id, confirmEmail: email })).toEqual({ ok: true, userId: id, anonymizedAt: NOW, replayed: true })

    const after = await getStudentDetail({ admin, repository, clock }, { id })
    expect(after!.student).toMatchObject({ displayName: null, email: null, anonymizedAt: NOW })
    expect(after!.history.length + after!.upcoming.length).toBe(before!.history.length + before!.upcoming.length)
    expect(after!.ledger.every((e) => e.note === null)).toBe(true)
    expect((await searchStudents({ admin }, "")).some((s) => s.userId === id)).toBe(false)
    expect(await bookForStudent({ admin }, { userId: id, sessionId: before!.history[0]?.sessionId ?? "x", requestKey: KEY_B })).toEqual({
      ok: false,
      code: "not_found",
    })
    expect(ledgerMismatches(repository)).toEqual([])
  })

  it("without a confirmed email the student's exact name confirms the erasure; no packs or adjustments afterwards", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const id = "demo-user-1" // "Ana (demo)": a name, no email
    expect(await anonymizeStudent({ admin }, { userId: id, confirmEmail: "ana (demo)" })).toEqual({ ok: false, code: "email_mismatch" })
    await grantPack({ admin, clock }, { userId: id, draft: { credits: 2, expiresOn: "2026-11-12", note: "Pack de Ana" }, requestKey: KEY_G }, { timezone: TZ })
    const grantId = (await admin.listStudentGrants(id))[0].id
    for (const booking of (await getStudentDetail({ admin, repository, clock }, { id }))!.upcoming) {
      await cancelForStudent({ admin }, { bookingId: booking.bookingId, refund: true })
    }
    expect(await anonymizeStudent({ admin }, { userId: id, confirmEmail: " Ana (demo) " })).toMatchObject({ ok: true, replayed: false })
    expect((await admin.listStudentGrants(id)).every((g) => g.note === null)).toBe(true)
    expect(await admin.grantCredits({ userId: id, credits: 1, validDays: 1, note: "x", requestKey: KEY_B })).toEqual({ ok: false, code: "not_found" })
    expect(await admin.adjustCredits({ grantId, delta: -1, reason: "x", requestKey: KEY_ADJ })).toEqual({ ok: false, code: "not_found" })
  })

  it("mirrors the credit-expiry job: the expired demo pack has one expiry row and Σ ledger = balance", async () => {
    const { admin, repository } = await setup(DEMO_STAFF_EMAIL)
    const detail = await getStudentDetail({ admin, repository, clock }, { id: DEMO_USER_ID })
    expect(detail!.ledger.filter((e) => e.reason === "expiry")).toEqual([
      expect.objectContaining({ grantId: "demo-grant-0", delta: -2, actor: "system", note: null }),
    ])
    expect(detail!.ledger.reduce((sum, e) => sum + e.delta, 0)).toBe(detail!.student.balance)
    expect(detail!.activeGrants.map((g) => g.id)).toEqual(["demo-grant-1"])
    const again = await getStudentDetail({ admin, repository, clock }, { id: DEMO_USER_ID })
    expect(again!.ledger.filter((e) => e.reason === "expiry")).toHaveLength(1)
    expect(ledgerMismatches(repository)).toEqual([])
  })

  it("never overbooks: a full demo session refuses a staff booking; a pack-less student gets no_valid_credit", async () => {
    const { admin } = await setup(DEMO_STAFF_EMAIL)
    const views = await admin.listSessions({ from: NOW, to: "2026-10-28T03:00:00.000Z" })
    const upcoming = views.filter((v) => v.session.status === "scheduled" && v.session.startsAt > NOW)
    const full = upcoming.find((v) => v.confirmedCount >= v.session.capacity && v.session.capacity > 1)!
    const free = upcoming.find((v) => v.confirmedCount < v.session.capacity)!
    expect(full && free).toBeTruthy()
    expect(await bookForStudent({ admin }, { userId: DEMO_USER_ID, sessionId: full.session.id, requestKey: KEY_BOOK })).toEqual({
      ok: false,
      code: "session_full",
    })
    expect(await bookForStudent({ admin }, { userId: "demo-user-99", sessionId: free.session.id, requestKey: KEY_BOOK })).toEqual({
      ok: false,
      code: "not_found",
    })
    const created = await createSessions({ admin, clock }, { ...draftSession("2026-10-23"), requestKey: KEY_A }, { timezone: TZ })
    const sessionId = created.ok ? created.sessionIds[0] : ""
    expect(await bookForStudent({ admin }, { userId: "demo-user-1", sessionId, requestKey: KEY_B })).toEqual({
      ok: false,
      code: "no_valid_credit",
    })
  })
})

function draftSession(localDate: string) {
  return {
    classTypeId: "demo-individual",
    localDate,
    localStart: "10:00",
    durationMinutes: 60,
    capacity: 1,
    modality: "in_person" as const,
    locationLabel: null,
    address: "Calle Falsa 123",
    meetingUrl: null,
    instructorName: null,
    repeatWeeks: 1,
  }
}
