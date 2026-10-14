import { describe, expect, it, vi } from "vitest"
import {
  getAdminDay,
  getAdminSessionDetail,
  isValidLocalDate,
  markAttendance,
  resolveStaffAccess,
  rosterLabel,
} from "./admin"
import { RepositoryError } from "./ports"
import { adminSessionAt, fakeAdminRepository, fakeRepository, fixedClock, rosterEntry } from "./test-support"

// Wednesday 2026-10-14 12:00 in Buenos Aires (UTC-3).
const clock = fixedClock("2026-10-14T15:00:00.000Z")
const repository = fakeRepository([])

describe("resolveStaffAccess", () => {
  it.each([
    [null, "signed_out"],
    ["student", "forbidden"],
    ["staff", "staff"],
  ] as const)("role %s → %s", async (role, expected) => {
    expect(await resolveStaffAccess({ admin: fakeAdminRepository({ role }) })).toBe(expected)
  })

  it("maps transport refusals and rethrows other failures", async () => {
    const admin = fakeAdminRepository()
    vi.spyOn(admin, "getMyRole").mockRejectedValueOnce(new RepositoryError("unauthenticated"))
    expect(await resolveStaffAccess({ admin })).toBe("signed_out")
    vi.spyOn(admin, "getMyRole").mockRejectedValueOnce(new RepositoryError("network_error"))
    await expect(resolveStaffAccess({ admin })).rejects.toThrow("network_error")
  })
})

describe("isValidLocalDate", () => {
  it.each(["2026-10-14", "2028-02-29"])("accepts %s", (value) => expect(isValidLocalDate(value)).toBe(true))
  it.each(["2026-02-30", "2026-13-01", "14-10-2026", "2026-10-14T00:00", "", null, 20261014, "1999-12-31"])(
    "rejects %j",
    (value) => expect(isValidLocalDate(value)).toBe(false),
  )
})

describe("getAdminDay", () => {
  const sessions = [
    adminSessionAt("2026-10-14T22:00:00.000Z", { id: "evening", confirmed: 8 }), // 19:00 local
    adminSessionAt("2026-10-14T11:00:00.000Z", { id: "morning", confirmed: 1, capacity: 1 }), // 08:00, finished
    adminSessionAt("2026-10-14T14:30:00.000Z", { id: "now" }), // 11:30–12:30, in progress
    adminSessionAt("2026-10-14T16:00:00.000Z", { id: "cx", status: "cancelled", published: false }),
    adminSessionAt("2026-10-15T00:30:00.000Z", { id: "late" }), // 21:30 local, same studio day
    adminSessionAt("2026-10-15T03:00:00.000Z", { id: "tomorrow" }), // 00:00 local on the 15th
  ]

  it("queries one studio-local day in UTC and sorts by start", async () => {
    const admin = fakeAdminRepository({ sessions })
    const day = await getAdminDay({ admin, repository, clock })
    expect(admin.calls).toEqual(["listSessions 2026-10-14T03:00:00.000Z 2026-10-15T03:00:00.000Z"])
    expect(day).toMatchObject({ date: "2026-10-14", today: "2026-10-14", previous: "2026-10-13", next: "2026-10-15", isToday: true })
    expect(day.sessions.map((s) => [s.session.id, s.state])).toEqual([
      ["morning", "finished"],
      ["now", "in_progress"],
      ["cx", "cancelled"],
      ["evening", "upcoming"],
      ["late", "upcoming"],
    ])
    expect(day.sessions[0]).toMatchObject({ confirmedCount: 1, durationMinutes: 60, attendanceWindow: "open" })
    expect(day.sessions[3].attendanceWindow).toBe("not_yet")
  })

  it("navigates to another day and drops rows an adapter leaked from other days", async () => {
    const admin = fakeAdminRepository({ sessions })
    vi.spyOn(admin, "listSessions").mockResolvedValue(sessions)
    const day = await getAdminDay({ admin, repository, clock }, { date: "2026-10-15" })
    expect(day).toMatchObject({ date: "2026-10-15", isToday: false, previous: "2026-10-14" })
    expect(day.sessions.map((s) => s.session.id)).toEqual(["tomorrow"])
  })

  it("falls back to today for an invalid date", async () => {
    const day = await getAdminDay({ admin: fakeAdminRepository(), repository, clock }, { date: "2026-02-30" })
    expect(day.date).toBe("2026-10-14")
  })

  it("marks attendance closed more than 7 days after a session", async () => {
    const old = adminSessionAt("2026-10-06T22:00:00.000Z", { id: "old" })
    const day = await getAdminDay({ admin: fakeAdminRepository({ sessions: [old] }), repository, clock }, { date: "2026-10-06" })
    expect(day.sessions[0]).toMatchObject({ state: "finished", attendanceWindow: "closed" })
  })
})

describe("getAdminSessionDetail", () => {
  const session = adminSessionAt("2026-10-14T11:00:00.000Z", { id: "s1", confirmed: 3 })

  it("returns null without touching the repository for an invalid id", async () => {
    const admin = fakeAdminRepository({ sessions: [session] })
    expect(await getAdminSessionDetail({ admin, repository, clock }, { id: "../x" })).toBeNull()
    expect(await getAdminSessionDetail({ admin, repository, clock }, { id: null })).toBeNull()
    expect(admin.calls).toEqual([])
  })

  it("returns null for an unknown session and skips the roster", async () => {
    const admin = fakeAdminRepository({ sessions: [session] })
    expect(await getAdminSessionDetail({ admin, repository, clock }, { id: "nope" })).toBeNull()
    expect(admin.calls).toEqual(["getSession nope"])
  })

  it("orders the roster: confirmed by name (unnamed last), then cancelled", async () => {
    const roster = [
      rosterEntry("b1", { displayName: "Zoe", bookedAt: "2026-10-01T00:00:00.000Z" }),
      rosterEntry("b2", { status: "cancelled", displayName: "Ana" }),
      rosterEntry("b3", { displayName: null, email: null }),
      rosterEntry("b4", { displayName: "  ", email: "maria@example.test" }),
      rosterEntry("b5", { displayName: "Ángela" }),
    ]
    const admin = fakeAdminRepository({ sessions: [session], roster: { s1: roster } })
    const detail = await getAdminSessionDetail({ admin, repository, clock }, { id: "s1" })
    expect(detail?.roster.map((r) => r.bookingId)).toEqual(["b5", "b4", "b1", "b3", "b2"])
    expect(detail?.entry).toMatchObject({ state: "finished", attendanceWindow: "open", localDate: "2026-10-14" })
  })
})

describe("rosterLabel", () => {
  it("prefers the name, then the email, else null", () => {
    expect(rosterLabel({ displayName: " Ana ", email: "a@x.test" })).toBe("Ana")
    expect(rosterLabel({ displayName: "", email: "a@x.test" })).toBe("a@x.test")
    expect(rosterLabel({ displayName: null, email: null })).toBeNull()
  })
})

describe("markAttendance", () => {
  it("validates input before calling the repository", async () => {
    const admin = fakeAdminRepository()
    expect(await markAttendance({ admin }, { bookingId: "../b", attendance: "attended" })).toEqual({ ok: false, code: "invalid_input" })
    expect(await markAttendance({ admin }, { bookingId: "b1", attendance: "late" as never })).toEqual({
      ok: false,
      code: "invalid_input",
    })
    expect(admin.calls).toEqual([])
  })

  it("passes the server result through", async () => {
    const admin = fakeAdminRepository()
    expect(await markAttendance({ admin }, { bookingId: "b1", attendance: "no_show" })).toEqual({
      ok: true,
      bookingId: "b1",
      attendance: "no_show",
    })
    vi.spyOn(admin, "markAttendance").mockResolvedValueOnce({ ok: false, code: "attendance_window_closed" })
    expect(await markAttendance({ admin }, { bookingId: "b1", attendance: "attended" })).toEqual({
      ok: false,
      code: "attendance_window_closed",
    })
  })

  it("turns thrown failures into codes", async () => {
    const admin = fakeAdminRepository()
    vi.spyOn(admin, "markAttendance").mockRejectedValueOnce(new RepositoryError("forbidden"))
    expect(await markAttendance({ admin }, { bookingId: "b1", attendance: "attended" })).toEqual({ ok: false, code: "forbidden" })
    vi.spyOn(admin, "markAttendance").mockRejectedValueOnce(new Error("boom"))
    expect(await markAttendance({ admin }, { bookingId: "b1", attendance: "attended" })).toEqual({ ok: false, code: "unknown" })
  })
})
