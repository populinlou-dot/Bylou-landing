import { describe, expect, it } from "vitest"
import {
  getAgenda,
  getAgendaEntry,
  getAgendaWeek,
  getSessionDetail,
  myOutcome,
  replaceAgendaEntry,
  studentAction,
} from "./get-agenda"
import { BA_RULES, availabilityAt, fakeRepository, fixedClock } from "./test-support"

// Wednesday 2026-10-14 12:00 in Buenos Aires (UTC-3).
const NOW = "2026-10-14T15:00:00.000Z"
const WEEK = { from: "2026-10-12T03:00:00.000Z", to: "2026-10-19T03:00:00.000Z" }

describe("getAgenda — grouping by studio local day", () => {
  it("groups sessions near midnight UTC by the Buenos Aires calendar day", async () => {
    const repository = fakeRepository([
      availabilityAt("2026-10-15T02:30:00.000Z", { id: "wed-2330" }), // Wed 23:30 local, Thu in UTC
      availabilityAt("2026-10-15T03:00:00.000Z", { id: "thu-0000" }), // Thu 00:00 local
      availabilityAt("2026-10-14T23:59:00.000Z", { id: "wed-2059" }), // Wed 20:59 local
      availabilityAt("2026-10-12T03:00:00.000Z", { id: "mon-0000" }), // Mon 00:00 local = week start
    ])
    const agenda = await getAgenda({ repository, clock: fixedClock(NOW) }, WEEK)

    expect(agenda.timezone).toBe("America/Argentina/Buenos_Aires")
    expect(agenda.days.map((d) => [d.date, d.entries.map((e) => e.session.id)])).toEqual([
      ["2026-10-12", ["mon-0000"]],
      ["2026-10-14", ["wed-2059", "wed-2330"]],
      ["2026-10-15", ["thu-0000"]],
    ])
    expect(agenda.total).toBe(4)
  })

  it("treats the range as half-open even if the adapter leaks sessions", async () => {
    const repository = fakeRepository(
      [
        availabilityAt("2026-10-12T02:59:00.000Z", { id: "before" }), // Sun 23:59 local, previous week
        availabilityAt(WEEK.from, { id: "at-from" }),
        availabilityAt(WEEK.to, { id: "at-to" }),
      ],
      { leakRange: true },
    )
    const agenda = await getAgenda({ repository, clock: fixedClock(NOW) }, WEEK)
    expect(agenda.days.flatMap((d) => d.entries.map((e) => e.session.id))).toEqual(["at-from"])
  })

  it("filters by class type but still returns every class type for the chips", async () => {
    const repository = fakeRepository([
      availabilityAt("2026-10-16T22:00:00.000Z", { id: "g1", classTypeId: "ct-grupal" }),
      availabilityAt("2026-10-16T13:00:00.000Z", { id: "i1", classTypeId: "ct-individual", capacity: 1 }),
    ])
    const deps = { repository, clock: fixedClock(NOW) }

    const all = await getAgenda(deps, { ...WEEK, classTypeId: null })
    expect(all.total).toBe(2)

    const individual = await getAgenda(deps, { ...WEEK, classTypeId: "ct-individual" })
    expect(individual.days.flatMap((d) => d.entries.map((e) => e.session.id))).toEqual(["i1"])
    expect(individual.classTypes.map((ct) => ct.id)).toEqual(["ct-individual", "ct-grupal"])
  })

  it("derives availability and state from the domain rules", async () => {
    const repository = fakeRepository([
      availabilityAt("2026-10-16T22:00:00.000Z", { id: "available", capacity: 8, confirmed: 3 }),
      availabilityAt("2026-10-16T23:00:00.000Z", { id: "full", capacity: 8, confirmed: 8 }),
      availabilityAt("2026-10-17T13:00:00.000Z", { id: "cancelled", status: "cancelled", confirmed: 8 }),
      availabilityAt("2026-10-13T22:00:00.000Z", { id: "past" }),
      availabilityAt("2026-10-14T14:30:00.000Z", { id: "in-progress" }), // started 30 min ago
    ])
    const agenda = await getAgenda({ repository, clock: fixedClock(NOW) }, WEEK)
    const byId = Object.fromEntries(agenda.days.flatMap((d) => d.entries).map((e) => [e.session.id, e]))

    expect(byId.available).toMatchObject({ state: "available", spotsLeft: 5, capacity: 8, durationMinutes: 60 })
    expect(byId.full).toMatchObject({ state: "full", spotsLeft: 0 })
    expect(byId.cancelled.state).toBe("cancelled")
    expect(byId.past.state).toBe("past")
    expect(byId["in-progress"].state).toBe("in_progress")
  })

  it("marks sessions beyond the booking horizon as not open yet", async () => {
    const far = "2026-11-20T22:00:00.000Z" // 37 days ahead, window opens 30 days before
    const repository = fakeRepository([availabilityAt(far, { id: "far" })])
    const agenda = await getAgenda(
      { repository, clock: fixedClock(NOW) },
      { from: "2026-11-16T03:00:00.000Z", to: "2026-11-23T03:00:00.000Z" },
    )
    expect(agenda.days[0].entries[0].state).toBe("not_open")
  })

  it("rejects an empty or inverted range", async () => {
    const deps = { repository: fakeRepository([]), clock: fixedClock(NOW) }
    await expect(getAgenda(deps, { from: WEEK.to, to: WEEK.from })).rejects.toThrow(RangeError)
  })
})

describe("getAgendaWeek", () => {
  it("uses the studio week (Mon 00:00 → Mon 00:00 local), not the UTC week", async () => {
    // Sunday 2026-10-18 23:30 local is already Monday 02:30 in UTC.
    const repository = fakeRepository([])
    const week = await getAgendaWeek({ repository, clock: fixedClock("2026-10-19T02:30:00.000Z") })
    expect(week).toMatchObject({
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      today: "2026-10-18",
      from: "2026-10-12T03:00:00.000Z",
      to: "2026-10-19T03:00:00.000Z",
      total: 0,
      days: [],
    })
  })

  it("shifts by whole weeks", async () => {
    const deps = { repository: fakeRepository([]), clock: fixedClock(NOW) }
    expect((await getAgendaWeek(deps, { weekOffset: 1 })).weekStart).toBe("2026-10-19")
    expect((await getAgendaWeek(deps, { weekOffset: -1 })).weekStart).toBe("2026-10-05")
    await expect(getAgendaWeek(deps, { weekOffset: 0.5 })).rejects.toThrow(RangeError)
  })
})

describe("getSessionDetail", () => {
  const session = availabilityAt("2026-10-16T22:00:00.000Z", { id: "s-1", confirmed: 7 })

  it("returns the entry for a known id", async () => {
    const detail = await getSessionDetail({ repository: fakeRepository([session]), clock: fixedClock(NOW) }, { id: "s-1" })
    expect(detail?.timezone).toBe(BA_RULES.timezone)
    expect(detail?.entry).toMatchObject({ localDate: "2026-10-16", state: "available", spotsLeft: 1 })
  })

  it("returns null for unknown ids", async () => {
    const detail = await getSessionDetail({ repository: fakeRepository([session]), clock: fixedClock(NOW) }, { id: "nope" })
    expect(detail).toBeNull()
  })

  it("never queries the repository with a missing or malformed id", async () => {
    const repository = fakeRepository([session])
    const deps = { repository, clock: fixedClock(NOW) }
    for (const id of [null, "", "../etc", "a b", "x".repeat(101)]) {
      expect(await getSessionDetail(deps, { id })).toBeNull()
    }
    expect(repository.calls).toEqual([])
  })
})

describe("student action and outcome — explicit evaluation order", () => {
  const deps = (sessions: Parameters<typeof fakeRepository>[0]) => ({ repository: fakeRepository(sessions), clock: fixedClock(NOW) })
  const entryOf = async (sessions: Parameters<typeof fakeRepository>[0], id: string) =>
    (await getAgenda(deps(sessions), WEEK)).days.flatMap((d) => d.entries).find((e) => e.session.id === id)!

  it("a past session the student attended reads as past + attended, never as 'already booked'", async () => {
    // Domain order: session_started is checked before already_booked.
    const entry = await entryOf(
      [availabilityAt("2026-10-13T13:00:00.000Z", { id: "past", myBookingId: "b1", myAttendance: "attended" })],
      "past",
    )
    expect(entry).toMatchObject({ state: "past", myBookingId: "b1", action: "none", myOutcome: "attended" })
  })

  it.each([
    ["no_show", "absent"],
    ["unknown", "booked"],
  ] as const)("past + attendance %s → outcome %s", async (attendance, outcome) => {
    const entry = await entryOf(
      [availabilityAt("2026-10-13T13:00:00.000Z", { id: "past", myBookingId: "b1", myAttendance: attendance })],
      "past",
    )
    expect(entry).toMatchObject({ state: "past", action: "none", myOutcome: outcome })
  })

  it("a past session without a booking has no outcome and no action", async () => {
    const entry = await entryOf([availabilityAt("2026-10-13T13:00:00.000Z", { id: "past" })], "past")
    expect(entry).toMatchObject({ state: "past", action: "none", myOutcome: null })
  })

  it("a started session the student booked shows 'booked' as outcome, not the booking CTA", async () => {
    const entry = await entryOf(
      [availabilityAt("2026-10-14T14:30:00.000Z", { id: "now", myBookingId: "b1" })],
      "now",
    )
    expect(entry).toMatchObject({ state: "in_progress", action: "none", myOutcome: "booked" })
  })

  it("an upcoming booked session is 'booked' (even when full); a free one is 'book'; full/cancelled are 'none'", async () => {
    const sessions = [
      availabilityAt("2026-10-16T22:00:00.000Z", { id: "mine-full", capacity: 1, confirmed: 1, myBookingId: "b1" }),
      availabilityAt("2026-10-16T23:00:00.000Z", { id: "free" }),
      availabilityAt("2026-10-17T13:00:00.000Z", { id: "full", capacity: 1, confirmed: 1 }),
      availabilityAt("2026-10-17T14:00:00.000Z", { id: "cancelled", status: "cancelled" }),
    ]
    const agenda = await getAgenda(deps(sessions), WEEK)
    const byId = Object.fromEntries(agenda.days.flatMap((d) => d.entries).map((e) => [e.session.id, [e.action, e.myOutcome]]))
    expect(byId).toEqual({
      "mine-full": ["booked", null],
      free: ["book", null],
      full: ["none", null],
      cancelled: ["none", null],
    })
  })

  it("studentAction follows cancelled → started → booked → window/full", () => {
    expect(studentAction("cancelled", "b1")).toBe("none")
    expect(studentAction("past", "b1")).toBe("none")
    expect(studentAction("in_progress", "b1")).toBe("none")
    expect(studentAction("closed", "b1")).toBe("booked")
    expect(studentAction("available", null)).toBe("book")
    expect(studentAction("not_open", null)).toBe("none")
    expect(myOutcome("available", "b1", "attended")).toBeNull()
    expect(myOutcome("past", null, null)).toBeNull()
  })
})

describe("getAgenda — modality filter (ST-01 AC4)", () => {
  it("filters by modality and combines with the practice filter", async () => {
    const repository = fakeRepository([
      availabilityAt("2026-10-16T13:00:00.000Z", { id: "g-online", classTypeId: "ct-grupal", modality: "online" }),
      availabilityAt("2026-10-16T22:00:00.000Z", { id: "g-studio", classTypeId: "ct-grupal", modality: "in_person" }),
      availabilityAt("2026-10-17T13:00:00.000Z", { id: "i-studio", classTypeId: "ct-individual", modality: "in_person" }),
    ])
    const deps = { repository, clock: fixedClock(NOW) }
    const ids = (a: Awaited<ReturnType<typeof getAgenda>>) => a.days.flatMap((d) => d.entries.map((e) => e.session.id))

    expect(ids(await getAgenda(deps, { ...WEEK, modality: "in_person" }))).toEqual(["g-studio", "i-studio"])
    expect(ids(await getAgenda(deps, { ...WEEK, modality: "online" }))).toEqual(["g-online"])
    expect(ids(await getAgenda(deps, { ...WEEK, modality: "in_person", classTypeId: "ct-grupal" }))).toEqual(["g-studio"])
    expect(ids(await getAgendaWeek(deps, { modality: null }))).toHaveLength(3)
  })
})

describe("getAgendaEntry / replaceAgendaEntry — refresh one session from the repository", () => {
  it("swaps the re-read session into the loaded agenda without touching the others", async () => {
    const before = [
      availabilityAt("2026-10-16T22:00:00.000Z", { id: "a", confirmed: 3 }),
      availabilityAt("2026-10-17T13:00:00.000Z", { id: "b", confirmed: 1 }),
    ]
    const agenda = await getAgenda({ repository: fakeRepository(before), clock: fixedClock(NOW) }, WEEK)
    const after = fakeRepository([availabilityAt("2026-10-16T22:00:00.000Z", { id: "a", confirmed: 4, myBookingId: "b-a" }), before[1]])

    const fresh = await getAgendaEntry({ repository: after, clock: fixedClock(NOW) }, "a")
    expect(after.calls).toContain("getSession a")
    const next = replaceAgendaEntry(agenda, "a", fresh)
    const a = next.days.flatMap((d) => d.entries).find((e) => e.session.id === "a")!
    expect(a).toMatchObject({ spotsLeft: 4, action: "booked" })
    expect(next.days.flatMap((d) => d.entries).find((e) => e.session.id === "b")).toBe(
      agenda.days.flatMap((d) => d.entries).find((e) => e.session.id === "b"),
    )
    expect(next.total).toBe(2)
  })

  it("drops a session that is no longer visible and leaves other weeks untouched", async () => {
    const agenda = await getAgenda(
      { repository: fakeRepository([availabilityAt("2026-10-16T22:00:00.000Z", { id: "a" })]), clock: fixedClock(NOW) },
      WEEK,
    )
    expect(await getAgendaEntry({ repository: fakeRepository([]), clock: fixedClock(NOW) }, "a")).toBeNull()
    expect(replaceAgendaEntry(agenda, "a", null)).toMatchObject({ days: [], total: 0 })
    expect(replaceAgendaEntry(agenda, "other-week", null)).toBe(agenda)
    expect(await getAgendaEntry({ repository: fakeRepository([]), clock: fixedClock(NOW) }, "../x")).toBeNull()
  })
})
