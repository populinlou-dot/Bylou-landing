import { describe, expect, it } from "vitest"
import { getAdminDay, getAdminSessionDetail, markAttendance, reserveSession, resolveStaffAccess, type Clock } from "../../application"
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
    expect(day.sessions.length).toBeGreaterThan(0)
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
