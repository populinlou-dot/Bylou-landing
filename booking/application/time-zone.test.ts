import { describe, expect, it } from "vitest"
import { addDays, isoWeekday, localDateOf, startOfWeek, zonedTimeToInstant } from "./time-zone"

const BA = "America/Argentina/Buenos_Aires"

describe("time-zone helpers", () => {
  it("reads the local calendar day in the studio timezone", () => {
    expect(localDateOf("2026-10-15T02:59:59.000Z", BA)).toBe("2026-10-14")
    expect(localDateOf("2026-10-15T03:00:00.000Z", BA)).toBe("2026-10-15")
    expect(() => localDateOf("not a date", BA)).toThrow(RangeError)
  })

  it("converts local wall-clock time to UTC", () => {
    expect(zonedTimeToInstant("2026-10-14", "21:30", BA).toISOString()).toBe("2026-10-15T00:30:00.000Z")
    expect(zonedTimeToInstant("2026-10-12", "00:00", BA).toISOString()).toBe("2026-10-12T03:00:00.000Z")
  })

  it("follows DST in zones that have it", () => {
    const ny = "America/New_York"
    expect(zonedTimeToInstant("2026-07-01", "09:00", ny).toISOString()).toBe("2026-07-01T13:00:00.000Z")
    expect(zonedTimeToInstant("2026-12-01", "09:00", ny).toISOString()).toBe("2026-12-01T14:00:00.000Z")
  })

  it("does calendar arithmetic across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31")
    expect(isoWeekday("2026-10-18")).toBe(7)
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12")
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12")
  })
})
