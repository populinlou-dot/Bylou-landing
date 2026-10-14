import { describe, expect, it } from "vitest"
import { attendanceWindow } from "./attendance"

const session = { startsAt: "2026-10-14T22:00:00.000Z", endsAt: "2026-10-14T23:00:00.000Z" }
const at = (iso: string) => new Date(iso)

describe("attendanceWindow (mirrors mark_attendance)", () => {
  it("is not open yet more than 15 minutes before the start", () => {
    expect(attendanceWindow(session, at("2026-10-14T21:44:59.999Z"))).toBe("not_yet")
  })

  it("opens exactly 15 minutes before the start", () => {
    expect(attendanceWindow(session, at("2026-10-14T21:45:00.000Z"))).toBe("open")
  })

  it("stays open during and after the session", () => {
    expect(attendanceWindow(session, at("2026-10-14T22:30:00.000Z"))).toBe("open")
    expect(attendanceWindow(session, at("2026-10-20T12:00:00.000Z"))).toBe("open")
  })

  it("is still open exactly 7 days after the end (inclusive)", () => {
    expect(attendanceWindow(session, at("2026-10-21T23:00:00.000Z"))).toBe("open")
  })

  it("closes right after 7 days from the end", () => {
    expect(attendanceWindow(session, at("2026-10-21T23:00:00.001Z"))).toBe("closed")
  })
})
