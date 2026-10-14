import { describe, expect, it } from "vitest"
import { getAgenda, getAgendaWeek, getSessionDetail } from "./get-agenda"
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
