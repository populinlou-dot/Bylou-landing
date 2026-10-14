import { describe, expect, it, vi } from "vitest"
import { getAdminSessionDetail, orderWaitlist } from "./admin"
import { getMyAccount, joinWaitlist, leaveWaitlist } from "./booking-actions"
import { getAgendaEntry, getSessionDetail, studentAction, toAgendaEntry } from "./get-agenda"
import { RepositoryError } from "./ports"
import {
  BA_RULES,
  adminSessionAt,
  availabilityAt,
  fakeAdminRepository,
  fakeRepository,
  fixedClock,
  myWaitlistEntry,
  waitlistRosterEntry,
} from "./test-support"

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock = fixedClock(NOW)
const now = new Date(NOW)
const KEY = "00000000-0000-4000-8000-000000000001"

/** Full, 3 days ahead (promotion open). */
const fullFar = availabilityAt("2026-10-17T13:00:00.000Z", { id: "full-far", capacity: 2, confirmed: 2 })
/** Full, 10 h ahead (inside the 24 h window). */
const fullSoon = availabilityAt("2026-10-15T01:00:00.000Z", { id: "full-soon", capacity: 2, confirmed: 2 })
const open = availabilityAt("2026-10-17T13:00:00.000Z", { id: "open", capacity: 8, confirmed: 2 })

describe("studentAction with the waitlist (Phase 4.4)", () => {
  const on = { enabled: true, position: null, open: true }

  it("offers 'join_waitlist' only on a full session while a freed spot would still be promoted", () => {
    expect(studentAction("full", null, on)).toBe("join_waitlist")
    expect(studentAction("full", null, { ...on, open: false })).toBe("none")
    expect(studentAction("full", null)).toBe("none") // waitlist off (default)
    expect(studentAction("not_open", null, on)).toBe("none")
  })

  it("shows her place while she waits, even inside the window", () => {
    expect(studentAction("full", null, { ...on, position: 2 })).toBe("waiting")
    expect(studentAction("closed", null, { ...on, position: 1, open: false })).toBe("waiting")
  })

  it("keeps the domain order: cancelled / started / booked / free spot win over the waitlist", () => {
    expect(studentAction("cancelled", null, { ...on, position: 1 })).toBe("none")
    expect(studentAction("past", null, { ...on, position: 1 })).toBe("none")
    expect(studentAction("full", "b-1", { ...on, position: 1 })).toBe("booked")
    expect(studentAction("available", null, { ...on, position: 1 })).toBe("book")
  })

  it("toAgendaEntry exposes the place and whether promotion is still open", () => {
    const entry = toAgendaEntry(fullFar, BA_RULES, now, { enabled: true, position: 3, open: true })
    expect(entry).toMatchObject({ action: "waiting", myWaitlistPosition: 3, waitlistOpen: true })
    expect(toAgendaEntry(fullFar, BA_RULES, now)).toMatchObject({ action: "none", myWaitlistPosition: null, waitlistOpen: false })
  })
})

describe("agenda reads with the waitlist", () => {
  it("merges her waiting places into the session detail and applies the owner window", async () => {
    const repository = fakeRepository([fullFar, fullSoon], {
      waitlist: [myWaitlistEntry(fullFar.session, { position: 2 }), myWaitlistEntry(fullSoon.session, { status: "promoted", position: null })],
    })
    const far = await getSessionDetail({ repository, clock, waitlist: true }, { id: "full-far" })
    expect(far?.entry).toMatchObject({ action: "waiting", myWaitlistPosition: 2, waitlistOpen: true })
    expect(far?.cancellationWindowHours).toBe(24)
    const soon = await getAgendaEntry({ repository, clock, waitlist: true }, "full-soon")
    expect(soon).toMatchObject({ action: "none", myWaitlistPosition: null, waitlistOpen: false })
  })

  it("never reads the waitlist when the brand has it off", async () => {
    const repository = fakeRepository([fullFar])
    const detail = await getSessionDetail({ repository, clock }, { id: "full-far" })
    expect(detail?.entry.action).toBe("none")
    expect(repository.calls).not.toContain("listMyWaitlist")
  })

  it("a failed or signed-out waitlist read degrades to 'join' instead of breaking the page", async () => {
    const repository = fakeRepository([fullFar])
    vi.spyOn(repository, "listMyWaitlist").mockRejectedValue(new RepositoryError("unauthenticated"))
    expect((await getAgendaEntry({ repository, clock, waitlist: true }, "full-far"))?.action).toBe("join_waitlist")
  })
})

describe("join / leave use cases", () => {
  it("validate ids before calling the repository", async () => {
    const repository = fakeRepository([])
    expect(await joinWaitlist({ repository }, { sessionId: "bad id!", requestKey: KEY })).toEqual({ ok: false, code: "invalid_input" })
    expect(await joinWaitlist({ repository }, { sessionId: "s-1", requestKey: "nope" })).toEqual({ ok: false, code: "invalid_input" })
    expect(await leaveWaitlist({ repository }, "bad id!")).toEqual({ ok: false, code: "invalid_input" })
    expect(repository.calls).toEqual([])
  })

  it("pass through results and map thrown transport errors", async () => {
    const repository = fakeRepository([])
    expect(await joinWaitlist({ repository }, { sessionId: "s-1", requestKey: KEY })).toMatchObject({ ok: true, position: 1 })
    vi.spyOn(repository, "leaveWaitlist").mockRejectedValue(new RepositoryError("network_error"))
    expect(await leaveWaitlist({ repository }, "s-1")).toEqual({ ok: false, code: "network_error" })
  })
})

describe("Mis reservas waitlist section", () => {
  it("lists waiting and passed-over entries of upcoming classes, soonest first", async () => {
    const past = availabilityAt("2026-10-13T13:00:00.000Z", { id: "past" }).session
    const cancelled = availabilityAt("2026-10-18T13:00:00.000Z", { id: "cxl", status: "cancelled" }).session
    const repository = fakeRepository([], {
      waitlist: [
        myWaitlistEntry(fullFar.session, { entryId: "w-far", position: 2 }),
        myWaitlistEntry(fullSoon.session, { entryId: "w-soon", position: 1 }),
        myWaitlistEntry(open.session, { entryId: "w-skipped", status: "skipped", skipReason: "no_valid_credit", position: null }),
        myWaitlistEntry(open.session, { entryId: "w-left", status: "left", position: null }),
        myWaitlistEntry(open.session, { entryId: "w-promoted", status: "promoted", position: null, bookingId: "b-9" }),
        myWaitlistEntry(past, { entryId: "w-past" }),
        myWaitlistEntry(cancelled, { entryId: "w-cxl", status: "closed", position: null }),
      ],
    })
    const account = await getMyAccount({ repository, clock, waitlist: true })
    expect(account.waitlist.map((w) => [w.entryId, w.promotionOpen])).toEqual([
      ["w-soon", false],
      ["w-far", true],
      ["w-skipped", true],
    ])
    expect(account.waitlist[0].localDate).toBe("2026-10-14")
  })

  it("is empty (and not read) when the waitlist is off", async () => {
    const repository = fakeRepository([], { waitlist: [myWaitlistEntry(fullFar.session)] })
    expect((await getMyAccount({ repository, clock })).waitlist).toEqual([])
    expect(repository.calls).not.toContain("listMyWaitlist")
  })
})

describe("staff waitlist (roster)", () => {
  it("orders waiting entries FIFO (ties by id) with places, then resolved ones, latest first", () => {
    const ordered = orderWaitlist([
      waitlistRosterEntry("w3", { joinedAt: "2026-10-12T00:00:00.000Z" }),
      waitlistRosterEntry("w-old", { status: "promoted", joinedAt: "2026-10-01T00:00:00.000Z", resolvedAt: "2026-10-05T00:00:00.000Z" }),
      waitlistRosterEntry("w2", { joinedAt: "2026-10-11T00:00:00.000Z" }),
      waitlistRosterEntry("w1", { joinedAt: "2026-10-11T00:00:00.000Z" }),
      waitlistRosterEntry("w-left", { status: "left", joinedAt: "2026-10-02T00:00:00.000Z", resolvedAt: "2026-10-09T00:00:00.000Z" }),
    ])
    expect(ordered.map((e) => [e.entryId, e.position])).toEqual([
      ["w1", 1],
      ["w2", 2],
      ["w3", 3],
      ["w-left", null],
      ["w-old", null],
    ])
  })

  it("getAdminSessionDetail adds the list and the waiting count only with the waitlist on", async () => {
    const view = adminSessionAt("2026-10-17T13:00:00.000Z", { id: "s-1", confirmed: 8 })
    const admin = fakeAdminRepository({
      sessions: [view],
      waitlist: { "s-1": [waitlistRosterEntry("w1"), waitlistRosterEntry("w2", { status: "skipped", skipReason: "no_valid_credit" })] },
    })
    const repository = fakeRepository([])
    const on = await getAdminSessionDetail({ admin, repository, clock, waitlist: true }, { id: "s-1" })
    expect(on?.waitingCount).toBe(1)
    expect(on?.waitlist.map((e) => e.entryId)).toEqual(["w1", "w2"])
    const off = await getAdminSessionDetail({ admin, repository, clock }, { id: "s-1" })
    expect(off).toMatchObject({ waitlist: [], waitingCount: 0 })
    expect(admin.calls.filter((c) => c.startsWith("getWaitlist"))).toHaveLength(1)
  })
})
