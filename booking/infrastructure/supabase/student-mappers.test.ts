import { describe, expect, it } from "vitest"
import {
  mapAdjustCreditsRpc,
  mapAnonymizeStudentRpc,
  mapBookForStudentRpc,
  mapCancelForStudentRpc,
  mapGrantCreditsRpc,
  mapSearchStudentsRpc,
  mapStudentSummaryRpc,
  toAdminGrantView,
  toAdminLedgerEntry,
  toStudentBookingView,
  toStudentSummary,
} from "./student-mappers"

const summary = {
  user_id: "u1",
  display_name: "<b>Ana</b>",
  email: "ana@example.test",
  balance: 3,
  next_expiry: "2026-11-12T03:00:00+00:00",
  next_booking: { booking_id: "b1", session_id: "s1", starts_at: "2026-10-15T21:00:00+00:00", class_type_name: "Hatha" },
}

describe("student summaries", () => {
  it("maps the server summary; names stay raw text", () => {
    expect(toStudentSummary(summary)).toEqual({
      userId: "u1",
      displayName: "<b>Ana</b>",
      email: "ana@example.test",
      balance: 3,
      nextExpiry: "2026-11-12T03:00:00.000Z",
      nextBooking: { bookingId: "b1", sessionId: "s1", startsAt: "2026-10-15T21:00:00.000Z", classTypeName: "Hatha" },
      anonymizedAt: null,
    })
    expect(toStudentSummary({ ...summary, anonymized_at: "2026-10-14T15:00:00+00:00", display_name: null, email: null })).toMatchObject({
      displayName: null,
      email: null,
      anonymizedAt: "2026-10-14T15:00:00.000Z",
    })
    expect(toStudentSummary({ ...summary, next_booking: null, next_expiry: null, display_name: null })).toMatchObject({
      displayName: null,
      nextExpiry: null,
      nextBooking: null,
    })
    expect(toStudentSummary({ ...summary, balance: -1 })).toBeNull()
  })

  it("search envelope: list, or null when anything is off", () => {
    expect(mapSearchStudentsRpc({ ok: true, code: null, students: [summary] })).toHaveLength(1)
    expect(mapSearchStudentsRpc({ ok: true, students: [{ nope: 1 }] })).toBeNull()
    expect(mapSearchStudentsRpc({ ok: false, code: "x" })).toBeNull()
  })

  it("summary envelope: student, null for not_found, undefined for junk", () => {
    expect(mapStudentSummaryRpc({ ok: true, student: summary })?.userId).toBe("u1")
    expect(mapStudentSummaryRpc({ ok: false, code: "not_found" })).toBeNull()
    expect(mapStudentSummaryRpc({ ok: false, code: "other" })).toBeUndefined()
    expect(mapStudentSummaryRpc("x")).toBeUndefined()
  })
})

describe("table rows", () => {
  it("grant row → pack view", () => {
    expect(
      toAdminGrantView({
        id: "g1",
        credits_total: 4,
        credits_remaining: 3,
        valid_from: "2026-10-01T03:00:00+00:00",
        expires_at: "2026-11-01T03:00:00+00:00",
        note: "Pack 4",
        created_at: "2026-10-01T12:00:00+00:00",
      }),
    ).toEqual({
      id: "g1",
      total: 4,
      remaining: 3,
      validFrom: "2026-10-01T03:00:00.000Z",
      expiresAt: "2026-11-01T03:00:00.000Z",
      note: "Pack 4",
      createdAt: "2026-10-01T12:00:00.000Z",
    })
  })

  it("booking row → view; a missing session embed is skipped", () => {
    const row = {
      id: "b1",
      session_id: "s1",
      status: "confirmed" as const,
      attendance: "unknown" as const,
      refunded: false,
      source: "staff" as const,
      created_at: "2026-10-10T12:00:00+00:00",
      session: { starts_at: "2026-10-15T21:00:00+00:00", ends_at: "2026-10-15T22:00:00+00:00", status: "scheduled" as const, class_type: { name: "Hatha" } },
    }
    expect(toStudentBookingView(row)).toMatchObject({ bookingId: "b1", source: "staff", classTypeName: "Hatha", startsAt: "2026-10-15T21:00:00.000Z" })
    expect(toStudentBookingView({ ...row, session: null })).toBeNull()
  })

  it("ledger row → entry with the actor resolved (system / student / staff)", () => {
    const row = {
      id: 42,
      user_id: "u1",
      grant_id: "g1",
      booking_id: null,
      reason: "admin_adjust" as const,
      delta: -1,
      note: "Motivo",
      actor_id: "staff-1",
      created_at: "2026-10-10T12:00:00+00:00",
    }
    expect(toAdminLedgerEntry(row)).toEqual({
      id: "42",
      grantId: "g1",
      bookingId: null,
      reason: "admin_adjust",
      delta: -1,
      note: "Motivo",
      actor: "staff",
      createdAt: "2026-10-10T12:00:00.000Z",
    })
    expect(toAdminLedgerEntry({ ...row, actor_id: "u1" }).actor).toBe("student")
    expect(toAdminLedgerEntry({ ...row, actor_id: null }).actor).toBe("system")
  })
})

describe("write envelopes", () => {
  it("grant_credits", () => {
    expect(mapGrantCreditsRpc({ ok: true, grant_id: "g", credits: 4, expires_at: "2026-11-13T03:00:00+00:00", replayed: true })).toEqual({
      ok: true,
      grantId: "g",
      credits: 4,
      expiresAt: "2026-11-13T03:00:00.000Z",
      replayed: true,
    })
    expect(mapGrantCreditsRpc({ ok: false, code: "not_found" })).toEqual({ ok: false, code: "not_found" })
    expect(mapGrantCreditsRpc({ ok: false, code: "weird" })).toEqual({ ok: false, code: "unknown" })
  })

  it("admin_adjust_credits: success, every business code, unknown", () => {
    expect(mapAdjustCreditsRpc({ ok: true, grant_id: "g", delta: -2, credits_remaining: 1, balance: 5, replayed: false })).toEqual({
      ok: true,
      grantId: "g",
      delta: -2,
      creditsRemaining: 1,
      balance: 5,
      replayed: false,
    })
    expect(mapAdjustCreditsRpc({ ok: false, code: "insufficient_balance", credits_remaining: 1 })).toEqual({
      ok: false,
      code: "insufficient_balance",
      creditsRemaining: 1,
    })
    for (const code of ["adjust_exceeds_pack", "grant_expired", "not_found"]) {
      expect(mapAdjustCreditsRpc({ ok: false, code })).toEqual({ ok: false, code })
    }
    expect(mapAdjustCreditsRpc({ ok: false, code: "session_full" })).toEqual({ ok: false, code: "unknown" })
  })

  it("admin_book_for: success and every business code", () => {
    expect(mapBookForStudentRpc({ ok: true, booking_id: "b", replayed: false, remaining_credits: 2 })).toEqual({
      ok: true,
      bookingId: "b",
      replayed: false,
      remainingCredits: 2,
    })
    for (const code of ["session_cancelled", "session_started", "already_booked", "session_full", "no_valid_credit", "not_found"]) {
      expect(mapBookForStudentRpc({ ok: false, code })).toEqual({ ok: false, code })
    }
    expect(mapBookForStudentRpc({ ok: false, code: "booking_closed" })).toEqual({ ok: false, code: "unknown" })
  })

  it("admin_cancel_for", () => {
    expect(mapCancelForStudentRpc({ ok: true, booking_id: "b", refunded: false, refund_skipped: true, replayed: false })).toEqual({
      ok: true,
      bookingId: "b",
      refunded: false,
      refundSkipped: true,
      replayed: false,
    })
    expect(mapCancelForStudentRpc({ ok: false, code: "cancellation_not_allowed" })).toEqual({ ok: false, code: "cancellation_not_allowed" })
    expect(mapCancelForStudentRpc(null)).toEqual({ ok: false, code: "unknown" })
  })

  it("admin_anonymize_student envelope (ADR-020)", () => {
    expect(mapAnonymizeStudentRpc({ ok: true, code: null, user_id: "u1", anonymized_at: "2026-10-14T15:00:00+00:00", replayed: false })).toEqual({
      ok: true,
      userId: "u1",
      anonymizedAt: "2026-10-14T15:00:00.000Z",
      replayed: false,
    })
    expect(mapAnonymizeStudentRpc({ ok: true, user_id: "u1", anonymized_at: "2026-10-14T15:00:00Z", replayed: true })).toMatchObject({ replayed: true })
    expect(mapAnonymizeStudentRpc({ ok: false, code: "has_upcoming_bookings", upcoming: 2 })).toEqual({
      ok: false,
      code: "has_upcoming_bookings",
      upcoming: 2,
    })
    expect(mapAnonymizeStudentRpc({ ok: false, code: "email_mismatch" })).toEqual({ ok: false, code: "email_mismatch" })
    expect(mapAnonymizeStudentRpc({ ok: false, code: "not_found" })).toEqual({ ok: false, code: "not_found" })
    expect(mapAnonymizeStudentRpc({ ok: false, code: "brand_new" })).toEqual({ ok: false, code: "unknown" })
    expect(mapAnonymizeStudentRpc({ ok: true, user_id: "u1" })).toEqual({ ok: false, code: "unknown" })
    expect(mapAnonymizeStudentRpc(null)).toEqual({ ok: false, code: "unknown" })
  })
})
