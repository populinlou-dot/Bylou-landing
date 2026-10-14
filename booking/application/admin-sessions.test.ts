import { describe, expect, it, vi } from "vitest"
import {
  canEditCapacity,
  cancelSession,
  createSessions,
  getNewSessionForm,
  listAdminClassTypes,
  minimumCapacity,
  normalizeSessionDraft,
  saveClassType,
  sessionOccurrences,
  updateSessionCapacity,
  validateClassType,
  validateSessionDraft,
  type SessionDraft,
} from "./admin-sessions"
import { RepositoryError } from "./ports"
import { ADMIN_CLASS_TYPES, fakeAdminRepository, fakeRepository, fixedClock } from "./test-support"

const TZ = "America/Argentina/Buenos_Aires"
// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const KEY = "00000000-0000-4000-8000-0000000000aa"

const DRAFT: SessionDraft = {
  classTypeId: "ct-grupal",
  localDate: "2026-10-15",
  localStart: "18:00",
  durationMinutes: 75,
  capacity: 8,
  modality: "in_person",
  locationLabel: "  Palermo ",
  address: " Calle Falsa 123 ",
  meetingUrl: "https://stale.example.test",
  instructorName: "  ",
  repeatWeeks: 1,
}

const validate = (patch: Partial<SessionDraft>, now = NOW) =>
  validateSessionDraft({ ...DRAFT, ...patch }, { now: new Date(now), timezone: TZ })

describe("class types (AD-02)", () => {
  const base = { name: "Hatha", description: null, durationMinutes: 60, defaultCapacity: 8, defaultModality: "online" as const }

  it("validates name, description, ranges and modality", () => {
    expect(validateClassType(base)).toEqual({})
    expect(validateClassType({ ...base, name: "   " })).toEqual({ name: "required" })
    expect(validateClassType({ ...base, name: "x".repeat(81) })).toEqual({ name: "too_long" })
    expect(validateClassType({ ...base, description: "x".repeat(2001) })).toEqual({ description: "too_long" })
    expect(validateClassType({ ...base, durationMinutes: 9, defaultCapacity: 101 })).toEqual({
      durationMinutes: "out_of_range",
      defaultCapacity: "out_of_range",
    })
    expect(validateClassType({ ...base, durationMinutes: Number.NaN })).toEqual({ durationMinutes: "out_of_range" })
    expect(validateClassType({ ...base, defaultModality: "hybrid" as never })).toEqual({ defaultModality: "invalid" })
  })

  it("lists published first, then archived, each by sort order", async () => {
    const admin = fakeAdminRepository({ classTypes: [...ADMIN_CLASS_TYPES].reverse() })
    expect((await listAdminClassTypes({ admin })).map((t) => t.id)).toEqual(["ct-individual", "ct-grupal", "ct-archivada"])
  })

  it("saves trimmed text and never calls the server with invalid input", async () => {
    const admin = fakeAdminRepository()
    const spy = vi.spyOn(admin, "saveClassType")
    expect(await saveClassType({ admin }, { ...base, id: "../x", isPublished: true })).toEqual({ ok: false, code: "invalid_input" })
    expect(await saveClassType({ admin }, { ...base, id: KEY, name: "", isPublished: true })).toEqual({ ok: false, code: "invalid_input" })
    expect(spy).not.toHaveBeenCalled()
    const result = await saveClassType({ admin }, { ...base, id: KEY, name: "  Hatha  ", description: "  ", isPublished: false })
    expect(result.ok).toBe(true)
    expect(spy).toHaveBeenCalledWith({ ...base, id: KEY, name: "Hatha", description: null, isPublished: false })
  })

  it("turns thrown transport errors into result codes", async () => {
    const admin = fakeAdminRepository()
    vi.spyOn(admin, "saveClassType").mockRejectedValue(new RepositoryError("network_error"))
    expect(await saveClassType({ admin }, { ...base, id: KEY, isPublished: true })).toEqual({ ok: false, code: "network_error" })
    vi.spyOn(admin, "saveClassType").mockRejectedValue(new Error("boom"))
    expect(await saveClassType({ admin }, { ...base, id: KEY, isPublished: true })).toEqual({ ok: false, code: "unknown" })
  })
})

describe("new session form (AD-03)", () => {
  const deps = () => ({ admin: fakeAdminRepository(), repository: fakeRepository([]), clock: fixedClock(NOW) })

  it("offers only published class types and defaults to today", async () => {
    const form = await getNewSessionForm(deps())
    expect(form.classTypes.map((t) => t.id)).toEqual(["ct-individual", "ct-grupal"])
    expect(form).toMatchObject({ timezone: TZ, today: "2026-10-14", defaultDate: "2026-10-14" })
  })

  it("uses ?dia= when it is a valid future day; past or junk falls back to today", async () => {
    expect((await getNewSessionForm(deps(), { date: "2026-10-20" })).defaultDate).toBe("2026-10-20")
    expect((await getNewSessionForm(deps(), { date: "2026-10-13" })).defaultDate).toBe("2026-10-14")
    expect((await getNewSessionForm(deps(), { date: "2026-02-30" })).defaultDate).toBe("2026-10-14")
  })
})

describe("sessionOccurrences (AD-04, studio timezone)", () => {
  it("converts studio wall time to UTC: 18:00 Buenos Aires = 21:00 UTC", () => {
    expect(sessionOccurrences("2026-10-15", "18:00", 1, TZ)).toEqual([
      { localDate: "2026-10-15", startsAt: "2026-10-15T21:00:00.000Z" },
    ])
  })

  it("keeps the local date and time every week, crossing month and year boundaries", () => {
    const weeks = sessionOccurrences("2026-12-17", "21:30", 4, TZ)
    expect(weeks.map((o) => o.localDate)).toEqual(["2026-12-17", "2026-12-24", "2026-12-31", "2027-01-07"])
    // 21:30 in Buenos Aires is 00:30 UTC on the NEXT day: grouping must use the local date.
    expect(weeks.map((o) => o.startsAt)).toEqual([
      "2026-12-18T00:30:00.000Z",
      "2026-12-25T00:30:00.000Z",
      "2027-01-01T00:30:00.000Z",
      "2027-01-08T00:30:00.000Z",
    ])
  })

  it("follows wall time across a DST change (studios in DST zones), unlike + 7 × 24 h", () => {
    // New York leaves DST on 2026-11-01: 18:00 local is 22:00 UTC before, 23:00 UTC after.
    const weeks = sessionOccurrences("2026-10-25", "18:00", 2, "America/New_York")
    expect(weeks.map((o) => o.startsAt)).toEqual(["2026-10-25T22:00:00.000Z", "2026-11-01T23:00:00.000Z"])
  })

  it("is empty for incomplete or out-of-range input", () => {
    expect(sessionOccurrences("", "18:00", 1, TZ)).toEqual([])
    expect(sessionOccurrences("2026-10-15", "", 1, TZ)).toEqual([])
    expect(sessionOccurrences("2026-10-15", "18:00", 13, TZ)).toEqual([])
    expect(sessionOccurrences("2026-10-15", "18:00", Number.NaN, TZ)).toEqual([])
    expect(sessionOccurrences("2026-10-15", "18:00", 12, TZ)).toHaveLength(12)
  })
})

describe("validateSessionDraft", () => {
  it("accepts a complete in-person draft", () => {
    expect(validate({})).toEqual({})
  })

  it("requires the address in person and an https link online", () => {
    expect(validate({ address: "  " })).toEqual({ address: "required" })
    expect(validate({ modality: "online", meetingUrl: "" })).toEqual({ meetingUrl: "required" })
    expect(validate({ modality: "online", meetingUrl: "http://meet.example.test/x" })).toEqual({ meetingUrl: "invalid_url" })
    expect(validate({ modality: "online", meetingUrl: "javascript:alert(1)" })).toEqual({ meetingUrl: "invalid_url" })
    expect(validate({ modality: "online", meetingUrl: `https://x.test/${"a".repeat(500)}` })).toEqual({ meetingUrl: "too_long" })
    // Online drafts ignore a leftover (empty) address.
    expect(validate({ modality: "online", address: "", meetingUrl: "https://meet.example.test/x" })).toEqual({})
  })

  it("checks ranges, lengths and required fields", () => {
    expect(validate({ capacity: 0, durationMinutes: 481, repeatWeeks: 13 })).toEqual({
      capacity: "out_of_range",
      durationMinutes: "out_of_range",
      repeatWeeks: "out_of_range",
    })
    expect(validate({ capacity: 2.5 })).toEqual({ capacity: "out_of_range" })
    expect(validate({ classTypeId: "" })).toEqual({ classTypeId: "required" })
    expect(validate({ localDate: "" })).toEqual({ localDate: "required" })
    expect(validate({ localDate: "2026-02-30" })).toEqual({ localDate: "invalid" })
    expect(validate({ localStart: "25:00" })).toEqual({ localStart: "invalid" })
    expect(validate({ instructorName: "x".repeat(81), locationLabel: "x".repeat(81) })).toEqual({
      instructorName: "too_long",
      locationLabel: "too_long",
    })
  })

  it("rejects a first occurrence that is not in the future (studio time)", () => {
    expect(validate({ localDate: "2026-10-14", localStart: "12:00" })).toEqual({ localStart: "in_past" })
    expect(validate({ localDate: "2026-10-14", localStart: "11:59" })).toEqual({ localStart: "in_past" })
    expect(validate({ localDate: "2026-10-14", localStart: "12:01" })).toEqual({})
  })
})

describe("createSessions (AD-03 / AD-04)", () => {
  it("sends a normalized command once, with the request key", async () => {
    const admin = fakeAdminRepository()
    const spy = vi.spyOn(admin, "createSessions")
    const result = await createSessions({ admin, clock: fixedClock(NOW) }, { ...DRAFT, repeatWeeks: 4, requestKey: KEY }, { timezone: TZ })
    expect(result).toEqual({ ok: true, sessionIds: ["new-1", "new-2", "new-3", "new-4"], replayed: false })
    expect(spy).toHaveBeenCalledWith({
      ...DRAFT,
      repeatWeeks: 4,
      requestKey: KEY,
      locationLabel: "Palermo",
      address: "Calle Falsa 123",
      meetingUrl: null,
      instructorName: null,
    })
  })

  it("refuses a bad key or invalid draft without a server call", async () => {
    const admin = fakeAdminRepository()
    const spy = vi.spyOn(admin, "createSessions")
    const deps = { admin, clock: fixedClock(NOW) }
    expect(await createSessions(deps, { ...DRAFT, requestKey: "nope" }, { timezone: TZ })).toEqual({ ok: false, code: "invalid_input" })
    expect(await createSessions(deps, { ...DRAFT, capacity: 0, requestKey: KEY }, { timezone: TZ })).toEqual({
      ok: false,
      code: "invalid_input",
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it("maps thrown transport errors", async () => {
    const admin = fakeAdminRepository()
    vi.spyOn(admin, "createSessions").mockRejectedValue(new RepositoryError("forbidden"))
    expect(await createSessions({ admin, clock: fixedClock(NOW) }, { ...DRAFT, requestKey: KEY }, { timezone: TZ })).toEqual({
      ok: false,
      code: "forbidden",
    })
  })

  it("normalizes per modality", () => {
    expect(normalizeSessionDraft({ ...DRAFT, modality: "online", meetingUrl: " https://m.test/x " })).toMatchObject({
      address: null,
      locationLabel: null,
      meetingUrl: "https://m.test/x",
    })
  })
})

describe("capacity and cancel (AD-05)", () => {
  it("validates capacity before calling the server", async () => {
    const admin = fakeAdminRepository()
    const spy = vi.spyOn(admin, "updateSessionCapacity")
    expect(await updateSessionCapacity({ admin }, { sessionId: "s1", capacity: 0 })).toEqual({ ok: false, code: "invalid_input" })
    expect(await updateSessionCapacity({ admin }, { sessionId: "s1", capacity: 101 })).toEqual({ ok: false, code: "invalid_input" })
    expect(await updateSessionCapacity({ admin }, { sessionId: "../s1", capacity: 5 })).toEqual({ ok: false, code: "invalid_input" })
    expect(spy).not.toHaveBeenCalled()
    vi.spyOn(admin, "updateSessionCapacity").mockResolvedValue({ ok: false, code: "capacity_below_bookings", confirmedCount: 4 })
    expect(await updateSessionCapacity({ admin }, { sessionId: "s1", capacity: 3 })).toEqual({
      ok: false,
      code: "capacity_below_bookings",
      confirmedCount: 4,
    })
  })

  it("cancels through the port and maps thrown errors", async () => {
    const admin = fakeAdminRepository()
    expect(await cancelSession({ admin }, { sessionId: "../x" })).toEqual({ ok: false, code: "invalid_input" })
    expect((await cancelSession({ admin }, { sessionId: "s1" })).ok).toBe(true)
    vi.spyOn(admin, "cancelSession").mockRejectedValue(new RepositoryError("network_error"))
    expect(await cancelSession({ admin }, { sessionId: "s1" })).toEqual({ ok: false, code: "network_error" })
  })

  it("capacity is editable only before start and never below the confirmed count", () => {
    const now = new Date(NOW)
    expect(canEditCapacity({ status: "scheduled", startsAt: "2026-10-14T15:00:01.000Z" }, now)).toBe(true)
    expect(canEditCapacity({ status: "scheduled", startsAt: NOW }, now)).toBe(false)
    expect(canEditCapacity({ status: "cancelled", startsAt: "2026-10-20T15:00:00.000Z" }, now)).toBe(false)
    expect(minimumCapacity(0)).toBe(1)
    expect(minimumCapacity(5)).toBe(5)
  })
})
