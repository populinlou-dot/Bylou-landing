import { describe, expect, it } from "vitest"
import {
  mapAuthError,
  mapBookRpc,
  mapCancelRpc,
  mapPostgrestError,
  toCreditBalance,
  toMyBooking,
  toSessionAvailability,
  toStudioRules,
  type MyBookingRow,
} from "./mappers"
import { toAuthUser } from "./supabase-auth"

const BOOKING = "0b5e0000-0000-4000-8000-000000000001"

describe("mapBookRpc (book_session jsonb → BookResult)", () => {
  it("maps a fresh booking", () => {
    expect(
      mapBookRpc({ ok: true, code: null, booking_id: BOOKING, replayed: false, remaining_credits: 6, spots_left: 3 }),
    ).toEqual({ ok: true, bookingId: BOOKING, replayed: false, remainingCredits: 6 })
  })

  it("maps an idempotent replay", () => {
    expect(mapBookRpc({ ok: true, booking_id: BOOKING, replayed: true, remaining_credits: 6 })).toEqual({
      ok: true,
      bookingId: BOOKING,
      replayed: true,
      remainingCredits: 6,
    })
  })

  it.each([
    "session_cancelled",
    "session_started",
    "booking_not_open",
    "booking_closed",
    "already_booked",
    "session_full",
    "no_valid_credit",
    "not_found",
    "too_many_changes",
  ])("passes through the business code %s", (code) => {
    expect(mapBookRpc({ ok: false, code, opens_at: "2026-10-20T00:00:00Z" })).toEqual({ ok: false, code })
  })

  it.each([null, "x", [], { ok: true }, { ok: false, code: "brand_new_code" }, { ok: false, code: "not_owner" }])(
    "maps unexpected payload %j to unknown",
    (data) => {
      expect(mapBookRpc(data)).toEqual({ ok: false, code: "unknown" })
    },
  )
})

describe("mapCancelRpc (cancel_booking jsonb → CancelResult)", () => {
  it("maps a refunded cancellation", () => {
    expect(mapCancelRpc({ ok: true, code: null, booking_id: BOOKING, status: "cancelled", refunded: true, replayed: false })).toEqual(
      { ok: true, bookingId: BOOKING, status: "cancelled", refunded: true, replayed: false },
    )
  })

  it("maps a state-based replay of a late cancellation", () => {
    expect(mapCancelRpc({ ok: true, booking_id: BOOKING, status: "late_cancelled", refunded: false, replayed: true })).toEqual({
      ok: true,
      bookingId: BOOKING,
      status: "late_cancelled",
      refunded: false,
      replayed: true,
    })
  })

  it("maps the Bylou deny refusal (no writes)", () => {
    expect(mapCancelRpc({ ok: false, code: "cancellation_too_late", refund: false, confirm_required: false })).toEqual({
      ok: false,
      code: "cancellation_too_late",
    })
  })

  it.each(["cancellation_not_allowed", "not_found", "not_owner"])("passes through %s", (code) => {
    expect(mapCancelRpc({ ok: false, code })).toEqual({ ok: false, code })
  })

  it.each([{ ok: true, booking_id: BOOKING, status: "confirmed" }, { ok: false, code: "session_full" }, undefined])(
    "maps unexpected payload %j to unknown",
    (data) => {
      expect(mapCancelRpc(data)).toEqual({ ok: false, code: "unknown" })
    },
  )
})

describe("mapPostgrestError (transport codes)", () => {
  it.each([
    [{ code: "", message: "TypeError: fetch failed" }, 0, "network_error"],
    [{ code: "42501", message: "unauthenticated" }, 400, "unauthenticated"],
    [{ code: "42501", message: "forbidden" }, 403, "forbidden"],
    [{ code: "42501", message: "permission denied for function book_session" }, 401, "unauthenticated"],
    [{ code: "42501", message: "permission denied for function admin_x" }, 403, "forbidden"],
    [{ code: "PGRST301", message: "JWT expired" }, 401, "unauthenticated"],
    [{ code: "PGRST303", message: "JWT expired" }, 401, "unauthenticated"],
    [{ code: "22023", message: "idempotency key reused for a different session" }, 400, "invalid_input"],
    [{ code: "22P02", message: "invalid input syntax for type uuid" }, 400, "invalid_input"],
    [{ code: "", message: "Service Unavailable" }, 503, "network_error"],
    [{ code: "PGRST202", message: "Could not find the function" }, 404, "unknown"],
    [null, 500, "unknown"],
  ] as const)("%j (HTTP %i) → %s", (error, status, expected) => {
    expect(mapPostgrestError(error, status)).toBe(expected)
  })
})

describe("mapAuthError (Supabase Auth → AuthCode)", () => {
  it.each([
    [{ name: "AuthRetryableFetchError", status: 0 }, "request", "network_error"],
    [{ name: "AuthApiError", code: "over_email_send_rate_limit", status: 429 }, "request", "rate_limited"],
    [{ name: "AuthApiError", code: "over_request_rate_limit", status: 429 }, "verify", "rate_limited"],
    [{ name: "AuthApiError", code: "otp_expired", status: 403 }, "verify", "invalid_code"],
    [{ name: "AuthApiError", code: "email_address_invalid", status: 400 }, "request", "invalid_email"],
    [{ name: "AuthApiError", code: "validation_failed", status: 400 }, "request", "invalid_email"],
    [{ name: "AuthApiError", code: "validation_failed", status: 400 }, "verify", "invalid_code"],
    [{ name: "AuthApiError", code: "signup_disabled", status: 422 }, "request", "unknown"],
  ] as const)("%j during %s → %s", (error, step, expected) => {
    expect(mapAuthError(error, step)).toBe(expected)
  })

  it("maps a session to the AuthUser shape and null to signed out", () => {
    expect(toAuthUser({ user: { id: "u1", email: "alumna1@example.test" } })).toEqual({ id: "u1", email: "alumna1@example.test" })
    expect(toAuthUser(null)).toBeNull()
  })
})

describe("row mappers", () => {
  it("maps studio_settings to StudioRules (Bylou 24 h + deny)", () => {
    expect(
      toStudioRules({
        timezone: "America/Argentina/Buenos_Aires",
        booking_opens_days: 30,
        booking_closes_minutes: 0,
        cancellation_window_hours: 24,
        late_cancel_policy: "deny",
        credits_per_booking: 1,
      }),
    ).toEqual({
      timezone: "America/Argentina/Buenos_Aires",
      bookingWindow: { opensDaysBefore: 30, closesMinutesBefore: 0 },
      cancellationWindowHours: 24,
      lateCancelPolicy: "deny",
      creditsPerBooking: 1,
    })
  })

  it("normalises timestamptz text and falls back when the class type is not in the catalog", () => {
    const viewRow = {
      id: "s1",
      class_type_id: "ct-hidden",
      class_type_name: "Privada",
      starts_at: "2026-10-15T21:00:00+00:00",
      ends_at: "2026-10-15T22:15:00+00:00",
      modality: "in_person" as const,
      instructor_name: "Lou",
      capacity: 6,
      confirmed_count: 2,
      status: "scheduled" as const,
    }
    const item = toSessionAvailability(viewRow, new Map(), { id: "b1", attendance: "attended" })
    expect(item.session.startsAt).toBe("2026-10-15T21:00:00.000Z")
    expect(item.classType).toEqual({ id: "ct-hidden", name: "Privada", description: null, durationMinutes: 75, defaultCapacity: 6 })
    expect(item.confirmedCount).toBe(2)
    expect(item.myBookingId).toBe("b1")
    expect(item.myAttendance).toBe("attended")
    expect(toSessionAvailability(viewRow, new Map(), null)).toMatchObject({ myBookingId: null, myAttendance: null })
  })

  const row = (status: MyBookingRow["status"]): MyBookingRow => ({
    id: BOOKING,
    session_id: "s1",
    user_id: "u1",
    status,
    attendance: "unknown",
    idempotency_key: "k",
    credit_grant_id: "g1",
    created_at: "2026-10-10T12:00:00+00:00",
    refunded: false,
    source: "student",
    session: {
      id: "s1",
      class_type_id: "ct1",
      starts_at: "2026-10-15T21:00:00+00:00",
      ends_at: "2026-10-15T22:00:00+00:00",
      capacity: 8,
      modality: "online",
      status: "scheduled",
      instructor_name: "Lou",
      class_type: { id: "ct1", name: "Hatha", description: null, default_duration_minutes: 60, default_capacity: 8 },
    },
  })
  const details = new Map([["s1", { meetingUrl: "https://meet.example.test/x", address: null, instructions: null }]])

  it("attaches private details only to confirmed bookings", () => {
    expect(toMyBooking(row("confirmed"), details)?.privateDetails?.meetingUrl).toBe("https://meet.example.test/x")
    expect(toMyBooking(row("cancelled"), details)?.privateDetails).toBeNull()
  })

  it("drops rows whose session RLS hid", () => {
    expect(toMyBooking({ ...row("confirmed"), session: null }, details)).toBeNull()
  })

  it("computes the usable balance like private.usable_balance", () => {
    const now = new Date("2026-10-14T15:00:00.000Z")
    const balance = toCreditBalance(
      [
        { id: "a", credits_total: 8, credits_remaining: 5, valid_from: "2026-10-01T00:00:00+00:00", expires_at: "2026-11-10T00:00:00+00:00", note: null },
        { id: "b", credits_total: 1, credits_remaining: 1, valid_from: "2026-10-01T00:00:00+00:00", expires_at: "2026-10-15T00:00:00+00:00", note: "suelta" },
        { id: "c", credits_total: 4, credits_remaining: 4, valid_from: "2026-10-20T00:00:00+00:00", expires_at: "2026-12-01T00:00:00+00:00", note: "future" },
        { id: "d", credits_total: 4, credits_remaining: 0, valid_from: "2026-10-01T00:00:00+00:00", expires_at: "2026-11-01T00:00:00+00:00", note: "used" },
      ],
      now,
    )
    expect(balance.available).toBe(6)
    expect(balance.nextExpiry).toBe("2026-10-15T00:00:00.000Z")
    expect(balance.activeGrants.map((g) => g.id)).toEqual(["b", "a"])
  })
})
