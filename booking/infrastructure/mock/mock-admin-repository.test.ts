import { describe, expect, it } from "vitest"
import {
  cancelSession,
  createSessions,
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
import { DEMO_OTP_CODE, DEMO_STAFF_EMAIL, DEMO_STAFF_ID, MockAuth } from "./mock-auth"
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
