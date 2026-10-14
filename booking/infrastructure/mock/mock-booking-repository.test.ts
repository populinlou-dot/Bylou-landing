import { describe, expect, it } from "vitest"
import { getAgendaWeek, type Clock } from "../../application"
import { DEFAULT_STUDIO_RULES } from "../../config"
import { MockBookingRepository } from "./mock-booking-repository"

const clockAt = (iso: string): Clock => ({ now: () => new Date(iso) })
const WIDE = { from: "2020-01-01T00:00:00.000Z", to: "2030-01-01T00:00:00.000Z" }
// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"

const repoAt = (iso: string) => new MockBookingRepository({ clock: clockAt(iso), rules: DEFAULT_STUDIO_RULES })

describe("MockBookingRepository", () => {
  it("is deterministic for the same clock", async () => {
    const a = await repoAt(NOW).listSessions(WIDE)
    const b = await repoAt(NOW).listSessions(WIDE)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it("anchors the seed to the studio week, so any instant in the same week yields the same data", async () => {
    const monday = await repoAt("2026-10-12T03:00:00.000Z").listSessions(WIDE) // Mon 00:00 local
    const sunday = await repoAt("2026-10-19T02:59:00.000Z").listSessions(WIDE) // Sun 23:59 local
    expect(sunday).toEqual(monday)
    const nextWeek = await repoAt("2026-10-19T03:00:00.000Z").listSessions(WIDE)
    expect(nextWeek[0].session.id).not.toBe(monday[0].session.id)
  })

  it("keeps the current week non-empty with a realistic mix of states", async () => {
    const repository = repoAt(NOW)
    const week = await getAgendaWeek({ repository, clock: clockAt(NOW) })
    const entries = week.days.flatMap((d) => d.entries)
    const states = new Set(entries.map((e) => e.state))

    expect(entries.length).toBeGreaterThan(5)
    expect(states).toContain("available")
    expect(states).toContain("full")
    expect(states).toContain("past")
    expect(entries.filter((e) => e.state === "cancelled")).toHaveLength(1)
    expect(new Set(entries.map((e) => e.session.modality))).toEqual(new Set(["online", "in_person"]))
  })

  it("leaves the previous week fully in the past", async () => {
    const week = await getAgendaWeek({ repository: repoAt(NOW), clock: clockAt(NOW) }, { weekOffset: -1 })
    const entries = week.days.flatMap((d) => d.entries)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.state === "past" || e.state === "cancelled")).toBe(true)
  })

  it("groups the late Wednesday session on Wednesday although it is Thursday in UTC", async () => {
    const week = await getAgendaWeek({ repository: repoAt(NOW), clock: clockAt(NOW) })
    const late = week.days.flatMap((d) => d.entries).find((e) => e.session.id === "demo-2026-10-14-2130-individual")
    expect(late?.session.startsAt).toBe("2026-10-15T00:30:00.000Z")
    expect(late?.localDate).toBe("2026-10-14")
  })

  it("marks every record as demo data and counts only confirmed bookings", async () => {
    const sessions = await repoAt(NOW).listSessions(WIDE)
    for (const item of sessions) {
      expect(item.session.id.startsWith("demo-")).toBe(true)
      expect(item.classType.id.startsWith("demo-")).toBe(true)
      expect(item.confirmedCount).toBeLessThanOrEqual(item.session.capacity)
    }
    const classTypes = await repoAt(NOW).listClassTypes()
    expect(classTypes.every((ct) => ct.description?.includes("(Demo)"))).toBe(true)
  })

  it("finds sessions by id and returns null for unknown ids", async () => {
    const repository = repoAt(NOW)
    const [first] = await repository.listSessions(WIDE)
    expect(await repository.getSession(first.session.id)).toEqual(first)
    expect(await repository.getSession("demo-unknown")).toBeNull()
  })

  it("returns copies, so callers cannot mutate the store", async () => {
    const repository = repoAt(NOW)
    const [first] = await repository.listSessions(WIDE)
    first.session.capacity = 999
    first.classType.name = "mutated"
    const again = await repository.getSession(first.session.id)
    expect(again?.session.capacity).not.toBe(999)
    expect(again?.classType.name).not.toBe("mutated")
  })

  it("serves the brand rules it was given (ADR-014)", async () => {
    const rules = { ...DEFAULT_STUDIO_RULES, cancellationWindowHours: 12 }
    const repository = new MockBookingRepository({ clock: clockAt(NOW), rules })
    expect(await repository.getStudioRules()).toEqual(rules)
  })

  it("reports the demo student's attendance on her past booking (agenda reads it as past + attended)", async () => {
    const repository = new MockBookingRepository({ clock: clockAt(NOW), rules: DEFAULT_STUDIO_RULES, currentUserId: () => "demo-alumna" })
    const mine = (await repository.listSessions(WIDE)).filter((s) => s.myBookingId)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ myBookingId: "demo-booking-history", myAttendance: "attended" })
    const anonymous = await repoAt(NOW).listSessions(WIDE)
    expect(anonymous.every((s) => s.myBookingId === null && s.myAttendance === null)).toBe(true)
  })

  it("profile: signed out throws/refuses; signed in reads and updates only her own name", async () => {
    let user: string | null = null
    const repository = new MockBookingRepository({ clock: clockAt(NOW), rules: DEFAULT_STUDIO_RULES, currentUserId: () => user })
    await expect(repository.getMyProfile()).rejects.toMatchObject({ code: "unauthenticated" })
    expect(await repository.updateMyDisplayName("Ana")).toEqual({ ok: false, code: "unauthenticated" })

    user = "demo-user-99"
    expect(await repository.getMyProfile()).toEqual({ displayName: null })
    expect(await repository.updateMyDisplayName("a".repeat(81))).toEqual({ ok: false, code: "invalid_input" })
    expect(await repository.updateMyDisplayName("Ana")).toEqual({ ok: true, displayName: "Ana" })
    expect(await repository.getMyProfile()).toEqual({ displayName: "Ana" })
    user = "demo-alumna"
    expect(await repository.getMyProfile()).toEqual({ displayName: "Alumna demo" })
  })
})
