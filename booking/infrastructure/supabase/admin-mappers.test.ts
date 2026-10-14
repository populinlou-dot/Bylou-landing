import { describe, expect, it } from "vitest"
import {
  mapAttendanceRpc,
  mapCancelSessionRpc,
  mapCreateSessionsRpc,
  mapSaveClassTypeRpc,
  mapUpdateSessionRpc,
  toAdminClassTypeView,
  toAdminSessionView,
  toRosterEntry,
  toStaffRole,
  type AdminSessionRow,
  type RosterRow,
} from "./admin-mappers"

const BOOKING = "0b5e0000-0000-4000-8000-000000000001"

describe("toStaffRole", () => {
  it("is staff only for an exact staff role", () => {
    expect(toStaffRole({ role: "staff" })).toBe("staff")
    expect(toStaffRole({ role: "student" })).toBe("student")
    expect(toStaffRole({ role: "STAFF" })).toBe("student")
    expect(toStaffRole(null)).toBe("student")
  })
})

describe("toAdminSessionView", () => {
  const row: AdminSessionRow = {
    id: "5e550000-0000-4000-8000-000000000001",
    class_type_id: "c1a55000-0000-4000-8000-000000000001",
    starts_at: "2026-10-14T22:00:00+00:00",
    ends_at: "2026-10-14T23:00:00+00:00",
    capacity: 8,
    confirmed_count: 5,
    modality: "in_person",
    status: "scheduled",
    is_published: false,
    instructor_name: "Lou",
    class_type: { name: "Hatha" },
  }

  it("maps columns and normalises instants", () => {
    expect(toAdminSessionView(row)).toEqual({
      session: {
        id: row.id,
        classTypeId: row.class_type_id,
        startsAt: "2026-10-14T22:00:00.000Z",
        endsAt: "2026-10-14T23:00:00.000Z",
        capacity: 8,
        modality: "in_person",
        status: "scheduled",
      },
      classTypeName: "Hatha",
      instructorName: "Lou",
      isPublished: false,
      confirmedCount: 5,
    })
  })

  it("survives a missing class type embed", () => {
    expect(toAdminSessionView({ ...row, class_type: null }).classTypeName).toBe("—")
  })
})

describe("toRosterEntry", () => {
  const row: RosterRow = {
    id: BOOKING,
    user_id: "u1",
    status: "confirmed",
    attendance: "attended",
    created_at: "2026-10-10T12:00:00+00:00",
    profile: { display_name: "<script>alert(1)</script>", email: "a@example.test" },
  }

  it("keeps names as raw text (escaping happens at render)", () => {
    expect(toRosterEntry(row)).toEqual({
      bookingId: BOOKING,
      userId: "u1",
      displayName: "<script>alert(1)</script>",
      email: "a@example.test",
      status: "confirmed",
      attendance: "attended",
      bookedAt: "2026-10-10T12:00:00.000Z",
    })
  })

  it("maps a hidden/missing profile to nulls", () => {
    expect(toRosterEntry({ ...row, profile: null })).toMatchObject({ displayName: null, email: null })
  })
})

describe("mapAttendanceRpc (mark_attendance jsonb)", () => {
  it("maps success", () => {
    expect(mapAttendanceRpc({ ok: true, code: null, booking_id: BOOKING, attendance: "no_show" })).toEqual({
      ok: true,
      bookingId: BOOKING,
      attendance: "no_show",
    })
  })

  it.each(["attendance_window_closed", "not_found"])("maps the %s refusal", (code) => {
    expect(mapAttendanceRpc({ ok: false, code })).toEqual({ ok: false, code })
  })

  it.each([null, "x", [], { ok: true }, { ok: true, booking_id: BOOKING, attendance: "late" }, { ok: false, code: "nope" }])(
    "maps malformed %j to unknown",
    (data) => {
      expect(mapAttendanceRpc(data)).toEqual({ ok: false, code: "unknown" })
    },
  )
})

describe("Phase 4.2 admin mappers", () => {
  const SESSION = "5e550000-0000-4000-8000-000000000002"

  it("toAdminClassTypeView keeps admin-only columns", () => {
    expect(
      toAdminClassTypeView({
        id: "c1",
        name: "Hatha <b>",
        description: null,
        default_duration_minutes: 60,
        default_capacity: 8,
        default_modality: "online",
        is_published: false,
        sort_order: 3,
      }),
    ).toEqual({
      id: "c1",
      name: "Hatha <b>",
      description: null,
      durationMinutes: 60,
      defaultCapacity: 8,
      defaultModality: "online",
      isPublished: false,
      sortOrder: 3,
    })
  })

  it("mapSaveClassTypeRpc", () => {
    expect(mapSaveClassTypeRpc({ ok: true, class_type_id: "c1", created: true, is_published: false, upcoming_sessions: 2 })).toEqual({
      ok: true,
      classTypeId: "c1",
      created: true,
      isPublished: false,
      upcomingSessions: 2,
    })
    expect(mapSaveClassTypeRpc({ ok: true, class_type_id: "c1" })).toEqual({ ok: false, code: "unknown" })
    expect(mapSaveClassTypeRpc(null)).toEqual({ ok: false, code: "unknown" })
  })

  it("mapCreateSessionsRpc", () => {
    expect(mapCreateSessionsRpc({ ok: true, code: null, session_ids: ["a", "b"], replayed: true })).toEqual({
      ok: true,
      sessionIds: ["a", "b"],
      replayed: true,
    })
    expect(mapCreateSessionsRpc({ ok: false, code: "not_found" })).toEqual({ ok: false, code: "not_found" })
    expect(mapCreateSessionsRpc({ ok: true, session_ids: [] })).toEqual({ ok: false, code: "unknown" })
    expect(mapCreateSessionsRpc({ ok: false, code: "surprise" })).toEqual({ ok: false, code: "unknown" })
  })

  it("mapUpdateSessionRpc maps every business code and keeps the confirmed count", () => {
    expect(mapUpdateSessionRpc({ ok: true, session_id: SESSION, capacity: 5, confirmed_count: 2, changed: true })).toEqual({
      ok: true,
      sessionId: SESSION,
      capacity: 5,
      confirmedCount: 2,
      changed: true,
      promoted: 0,
    })
    // Phase 4.4: new spots that went to the waitlist.
    expect(
      mapUpdateSessionRpc({ ok: true, session_id: SESSION, capacity: 5, confirmed_count: 4, changed: true, promoted: 2 }),
    ).toMatchObject({ confirmedCount: 4, promoted: 2 })
    expect(mapUpdateSessionRpc({ ok: false, code: "capacity_below_bookings", confirmed_count: 4 })).toEqual({
      ok: false,
      code: "capacity_below_bookings",
      confirmedCount: 4,
    })
    for (const code of ["session_cancelled", "session_started", "not_found"]) {
      expect(mapUpdateSessionRpc({ ok: false, code })).toEqual({ ok: false, code })
    }
    expect(mapUpdateSessionRpc({ ok: false, code: "session_full" })).toEqual({ ok: false, code: "unknown" })
    expect(mapUpdateSessionRpc({ ok: true, session_id: SESSION, capacity: -1, confirmed_count: 0 })).toEqual({ ok: false, code: "unknown" })
  })

  it("mapCancelSessionRpc", () => {
    expect(
      mapCancelSessionRpc({
        ok: true,
        code: null,
        session_id: SESSION,
        replayed: false,
        cancelled_bookings: 3,
        refunded: 2,
        refunds_skipped: [BOOKING],
      }),
    ).toEqual({ ok: true, sessionId: SESSION, cancelledBookings: 3, refunded: 2, refundsSkipped: [BOOKING], replayed: false })
    expect(mapCancelSessionRpc({ ok: false, code: "not_found" })).toEqual({ ok: false, code: "not_found" })
    expect(mapCancelSessionRpc({ ok: true, session_id: SESSION })).toEqual({ ok: false, code: "unknown" })
  })
})
