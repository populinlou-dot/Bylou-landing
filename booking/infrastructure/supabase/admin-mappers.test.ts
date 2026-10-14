import { describe, expect, it } from "vitest"
import { mapAttendanceRpc, toAdminSessionView, toRosterEntry, toStaffRole, type AdminSessionRow, type RosterRow } from "./admin-mappers"

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
