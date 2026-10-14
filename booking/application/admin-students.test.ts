import { describe, expect, it, vi } from "vitest"
import {
  adjustAmountMax,
  adjustCredits,
  anonymizeStudent,
  bookForStudent,
  eraseConfirmationKind,
  eraseConfirmationMatches,
  cancelForStudent,
  defaultPackExpiry,
  getStudentDetail,
  grantPack,
  lastValidDay,
  listBookableSessions,
  normalizeStudentQuery,
  packValidDays,
  searchStudents,
  sortLedger,
  validateAdjustDraft,
  validateEraseConfirmation,
  validateGrantDraft,
} from "./admin-students"
import { RepositoryError } from "./ports"
import {
  adminSessionAt,
  fakeAdminRepository,
  fakeRepository,
  fixedClock,
  grantView,
  ledgerEntry,
  studentBooking,
  studentSummary,
} from "./test-support"

// Wednesday 2026-10-14 12:00 Buenos Aires.
const NOW = "2026-10-14T15:00:00.000Z"
const clock = fixedClock(NOW)
const TZ = "America/Argentina/Buenos_Aires"
const KEY = "0b9d3b8e-4f1a-4c55-9c3e-1d2f3a4b5c6d"

describe("student search (AD-09)", () => {
  it("normalizes the query: trims, collapses spaces, caps length", () => {
    expect(normalizeStudentQuery("  Ana   Pérez ")).toBe("Ana Pérez")
    expect(normalizeStudentQuery(null)).toBe("")
    expect(normalizeStudentQuery("x".repeat(150))).toHaveLength(100)
  })

  it("passes the normalized query to the repository", async () => {
    const admin = fakeAdminRepository({ students: [studentSummary("a", { displayName: "Ana" })] })
    expect(await searchStudents({ admin }, "  ana ")).toHaveLength(1)
    expect(admin.calls).toEqual(["searchStudents ana"])
  })
})

describe("student detail (AD-09, AD-08.3)", () => {
  function setup() {
    const admin = fakeAdminRepository({
      students: [studentSummary("a")],
      grants: {
        a: [
          grantView("g-late", { expiresAt: "2026-12-01T03:00:00.000Z" }),
          grantView("g-expired", { expiresAt: "2026-10-01T03:00:00.000Z", validFrom: "2026-09-01T03:00:00.000Z" }),
          grantView("g-soon", { expiresAt: "2026-10-20T03:00:00.000Z", remaining: 0 }),
          grantView("g-future", { validFrom: "2026-10-20T03:00:00.000Z" }),
        ],
      },
      studentBookings: {
        a: [
          studentBooking("past", "2026-10-10T21:00:00.000Z"),
          studentBooking("later", "2026-10-20T21:00:00.000Z"),
          studentBooking("soon", "2026-10-15T21:00:00.000Z"),
          studentBooking("now", "2026-10-14T14:30:00.000Z"), // in progress until 15:30
          studentBooking("cancelled", "2026-10-16T21:00:00.000Z", { status: "cancelled" }),
          studentBooking("suspended", "2026-10-17T21:00:00.000Z", { sessionStatus: "cancelled" }),
        ],
      },
      ledger: {
        a: [
          ledgerEntry("1", { createdAt: "2026-10-01T12:00:00.000Z" }),
          ledgerEntry("10", { createdAt: "2026-10-05T12:00:00.000Z", reason: "booking_debit", delta: -1 }),
          ledgerEntry("9", { createdAt: "2026-10-05T12:00:00.000Z", reason: "admin_adjust", delta: -1, note: "x" }),
        ],
      },
    })
    return { admin, deps: { admin, repository: fakeRepository([]), clock } }
  }

  it("keeps the server balance, lists packs valid now (earliest expiry first), splits upcoming/history", async () => {
    const { deps } = setup()
    const detail = await getStudentDetail(deps, { id: "a" })
    expect(detail?.student.balance).toBe(3)
    expect(detail?.today).toBe("2026-10-14")
    expect(detail?.activeGrants.map((g) => g.id)).toEqual(["g-soon", "g-late"])
    expect(detail?.upcoming.map((b) => b.bookingId)).toEqual(["now", "soon", "later"])
    expect(detail?.history.map((b) => b.bookingId)).toEqual(["suspended", "cancelled", "past"])
  })

  it("orders the ledger newest first, ties by numeric id", async () => {
    const { deps } = setup()
    const detail = await getStudentDetail(deps, { id: "a" })
    expect(detail?.ledger.map((e) => e.id)).toEqual(["10", "9", "1"])
    expect(sortLedger([ledgerEntry("2"), ledgerEntry("11")]).map((e) => e.id)).toEqual(["11", "2"])
  })

  it("returns null for invalid or unknown ids without loading the rest", async () => {
    const { deps, admin } = setup()
    expect(await getStudentDetail(deps, { id: "../x" })).toBeNull()
    expect(await getStudentDetail(deps, { id: "zzz" })).toBeNull()
    expect(admin.calls).toEqual(["getStudent zzz"])
  })

  it("shows a pack's last valid day in studio time (expiry is exclusive)", () => {
    expect(lastValidDay("2026-11-12T03:00:00.000Z", TZ)).toBe("2026-11-11")
  })
})

describe("grant a pack (AD-08)", () => {
  it("valid through a local day = days until it, plus one (grant_credits semantics)", () => {
    expect(packValidDays("2026-10-14", "2026-10-14")).toBe(1)
    expect(packValidDays("2026-10-14", "2026-11-12")).toBe(30)
    expect(defaultPackExpiry("2026-10-14")).toBe("2026-11-12")
  })

  it("validates credits, expiry and note length", () => {
    const today = "2026-10-14"
    expect(validateGrantDraft({ credits: 4, expiresOn: "2026-11-12", note: "" }, { today })).toEqual({})
    expect(validateGrantDraft({ credits: 0, expiresOn: "", note: "x".repeat(201) }, { today })).toEqual({
      credits: "out_of_range",
      expiresOn: "required",
      note: "too_long",
    })
    expect(validateGrantDraft({ credits: 101, expiresOn: "2026-10-13", note: "" }, { today }).expiresOn).toBe("in_past")
    expect(validateGrantDraft({ credits: 4, expiresOn: "2027-10-14", note: "" }, { today }).expiresOn).toBe("out_of_range")
    expect(validateGrantDraft({ credits: 4, expiresOn: "2027-10-13", note: "" }, { today })).toEqual({})
    expect(validateGrantDraft({ credits: 4, expiresOn: "2026-02-30", note: "" }, { today }).expiresOn).toBe("invalid")
  })

  it("sends days, a trimmed note (blank → null) and the request key", async () => {
    const admin = fakeAdminRepository()
    const grant = vi.spyOn(admin, "grantCredits")
    const result = await grantPack(
      { admin, clock },
      { userId: "a", draft: { credits: 8, expiresOn: "2026-11-12", note: "   " }, requestKey: KEY },
      { timezone: TZ },
    )
    expect(result.ok).toBe(true)
    expect(grant).toHaveBeenCalledWith({ userId: "a", credits: 8, validDays: 30, note: null, requestKey: KEY })
    await grantPack({ admin, clock }, { userId: "a", draft: { credits: 8, expiresOn: "2026-11-12", note: " Pack 8 " }, requestKey: KEY }, { timezone: TZ })
    expect(grant.mock.calls[1][0].note).toBe("Pack 8")
  })

  it("refuses invalid input without a call and maps transport errors", async () => {
    const admin = fakeAdminRepository()
    const grant = vi.spyOn(admin, "grantCredits")
    const bad = await grantPack({ admin, clock }, { userId: "a", draft: { credits: 0, expiresOn: "2026-11-12", note: "" }, requestKey: KEY }, { timezone: TZ })
    expect(bad).toEqual({ ok: false, code: "invalid_input" })
    const noKey = await grantPack({ admin, clock }, { userId: "a", draft: { credits: 1, expiresOn: "2026-11-12", note: "" }, requestKey: "x" }, { timezone: TZ })
    expect(noKey).toEqual({ ok: false, code: "invalid_input" })
    expect(grant).not.toHaveBeenCalled()
    grant.mockRejectedValueOnce(new RepositoryError("network_error"))
    const failed = await grantPack({ admin, clock }, { userId: "a", draft: { credits: 1, expiresOn: "2026-11-12", note: "" }, requestKey: KEY }, { timezone: TZ })
    expect(failed).toEqual({ ok: false, code: "network_error" })
  })
})

describe("adjust credits (AD-08.2)", () => {
  const pack = { remaining: 3, total: 4 }

  it("requires a reason and bounds the amount by the pack", () => {
    expect(validateAdjustDraft({ grantId: "g-1", direction: "remove", amount: 3, reason: " ok " }, pack)).toEqual({})
    expect(validateAdjustDraft({ grantId: "g-1", direction: "remove", amount: 4, reason: "x" }, pack)).toEqual({ amount: "out_of_range" })
    expect(validateAdjustDraft({ grantId: "g-1", direction: "add", amount: 2, reason: "x" }, pack)).toEqual({ amount: "out_of_range" })
    expect(validateAdjustDraft({ grantId: "g-1", direction: "add", amount: 1, reason: "   " }, pack)).toEqual({ reason: "required" })
    expect(validateAdjustDraft({ grantId: "g-1", direction: "add", amount: 1, reason: "x".repeat(201) }, pack)).toEqual({ reason: "too_long" })
    expect(validateAdjustDraft({ grantId: "g-1", direction: "add", amount: 0, reason: "x" }, null)).toEqual({ grantId: "required", amount: "out_of_range" })
    expect(adjustAmountMax("remove", pack)).toBe(3)
    expect(adjustAmountMax("add", pack)).toBe(1)
  })

  it("sends a signed delta and the trimmed reason; never calls with a missing reason", async () => {
    const admin = fakeAdminRepository()
    const adjust = vi.spyOn(admin, "adjustCredits")
    const result = await adjustCredits({ admin }, { draft: { grantId: "g-1", direction: "remove", amount: 2, reason: " Clase tomada " }, grant: pack, requestKey: KEY })
    expect(result).toMatchObject({ ok: true, delta: -2 })
    expect(adjust).toHaveBeenCalledWith({ grantId: "g-1", delta: -2, reason: "Clase tomada", requestKey: KEY })
    expect(await adjustCredits({ admin }, { draft: { grantId: "g-1", direction: "add", amount: 1, reason: "" }, grant: pack, requestKey: KEY })).toEqual({
      ok: false,
      code: "invalid_input",
    })
    expect(adjust).toHaveBeenCalledTimes(1)
  })
})

describe("book / cancel on behalf (AD-10)", () => {
  it("lists upcoming scheduled sessions only, soonest first, flags full ones", async () => {
    const admin = fakeAdminRepository({
      sessions: [
        adminSessionAt("2026-10-20T21:00:00.000Z", { id: "b", capacity: 2, confirmed: 2 }),
        adminSessionAt("2026-10-15T21:00:00.000Z", { id: "a" }),
        adminSessionAt("2026-10-16T21:00:00.000Z", { id: "x", status: "cancelled" }),
        adminSessionAt("2026-10-14T14:30:00.000Z", { id: "started" }),
      ],
    })
    const { sessions, timezone } = await listBookableSessions({ admin, repository: fakeRepository([]), clock })
    expect(timezone).toBe(TZ)
    expect(sessions.map((s) => [s.session.id, s.isFull])).toEqual([
      ["a", false],
      ["b", true],
    ])
    expect(admin.calls[0]).toBe(`listSessions ${NOW} 2026-12-13T15:00:00.000Z`)
  })

  it("validates ids and key before calling, maps transport errors", async () => {
    const admin = fakeAdminRepository()
    expect(await bookForStudent({ admin }, { userId: "a", sessionId: "s", requestKey: "nope" })).toEqual({ ok: false, code: "invalid_input" })
    expect((await bookForStudent({ admin }, { userId: "a", sessionId: "s", requestKey: KEY })).ok).toBe(true)
    vi.spyOn(admin, "cancelForStudent").mockRejectedValueOnce(new RepositoryError("forbidden"))
    expect(await cancelForStudent({ admin }, { bookingId: "b", refund: true })).toEqual({ ok: false, code: "forbidden" })
    expect(await cancelForStudent({ admin }, { bookingId: "b", refund: false })).toMatchObject({ ok: true, refunded: false })
    expect(await cancelForStudent({ admin }, { bookingId: "../b", refund: true })).toEqual({ ok: false, code: "invalid_input" })
  })
})

describe("account erasure (ADR-020)", () => {
  const USER = "0b5e0000-0000-4000-8000-0000000000aa"

  it("with an email: matches it trimmed and case-insensitively, and nothing else", () => {
    const ana = { userId: USER, email: "ana@example.test", displayName: "Ana" }
    expect(eraseConfirmationKind(ana)).toBe("email")
    expect(eraseConfirmationMatches("  Ana@Example.TEST ", ana)).toBe(true)
    expect(eraseConfirmationMatches("ana@example.tes", ana)).toBe(false)
    expect(eraseConfirmationMatches("Ana", ana)).toBe(false)
    expect(eraseConfirmationMatches(USER, ana)).toBe(false)
    expect(validateEraseConfirmation(" ", ana)).toBe("required")
    expect(validateEraseConfirmation("otra@example.test", ana)).toBe("invalid")
    expect(validateEraseConfirmation("ANA@example.test", ana)).toBeNull()
  })

  it("without a confirmed email: her exact name or her user id (any case)", () => {
    const eva = { userId: USER, email: null, displayName: "Eva Sin Mail" }
    expect(eraseConfirmationKind(eva)).toBe("name_or_id")
    expect(eraseConfirmationMatches(" Eva Sin Mail ", eva)).toBe(true)
    expect(eraseConfirmationMatches("eva sin mail", eva)).toBe(false)
    expect(eraseConfirmationMatches(USER.toUpperCase(), eva)).toBe(true)
    const nameless = { userId: USER, email: null, displayName: null }
    expect(eraseConfirmationKind(nameless)).toBe("id")
    expect(eraseConfirmationMatches(USER, nameless)).toBe(true)
    expect(eraseConfirmationMatches("", nameless)).toBe(false)
  })

  it("validates before calling, trims the email, and maps transport failures", async () => {
    const admin = fakeAdminRepository()
    expect(await anonymizeStudent({ admin }, { userId: "not an id", confirmEmail: "a@b.c" })).toEqual({ ok: false, code: "invalid_input" })
    expect(await anonymizeStudent({ admin }, { userId: USER, confirmEmail: "   " })).toEqual({ ok: false, code: "invalid_input" })
    expect(await anonymizeStudent({ admin }, { userId: USER, confirmEmail: `${"a".repeat(320)}@b.c` })).toEqual({ ok: false, code: "invalid_input" })
    expect(admin.calls).toEqual([])
    expect(await anonymizeStudent({ admin }, { userId: USER, confirmEmail: " ana@example.test " })).toMatchObject({ ok: true })
    expect(admin.calls).toEqual([`anonymizeStudent ${USER} ana@example.test`])
    vi.spyOn(admin, "anonymizeStudent").mockRejectedValueOnce(new RepositoryError("network_error"))
    expect(await anonymizeStudent({ admin }, { userId: USER, confirmEmail: "ana@example.test" })).toEqual({ ok: false, code: "network_error" })
  })
})
