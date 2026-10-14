/**
 * Pure mapping for the staff side (Phase 4.1): RLS-scoped table reads (staff see every row
 * through `private.is_staff()` policies) and the `mark_attendance` RPC envelope
 * (migration 20261014000700). Unknown codes become "unknown".
 */
import type { Booking, Modality } from "../../domain"
import type { AdminSessionView, AttendanceCode, AttendanceMark, MarkAttendanceResult, RosterEntry, StaffRole } from "../../application"
import { iso } from "./mappers"

export interface AdminSessionRow {
  id: string
  class_type_id: string
  starts_at: string
  ends_at: string
  capacity: number
  confirmed_count: number
  modality: Modality
  status: "scheduled" | "cancelled"
  is_published: boolean
  instructor_name: string | null
  class_type: { name: string } | null
}

export interface RosterRow {
  id: string
  user_id: string
  status: Booking["status"]
  attendance: Booking["attendance"]
  created_at: string
  profile: { display_name: string | null; email: string | null } | null
}

const ATTENDANCE_CODES: readonly string[] = ["attendance_window_closed", "not_found"]
const MARKS: readonly string[] = ["attended", "no_show", "unknown"]

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** Anything but an exact "staff" is treated as a student (least privilege for the UX guard). */
export function toStaffRole(row: { role?: unknown } | null | undefined): StaffRole {
  return row?.role === "staff" ? "staff" : "student"
}

export function toAdminSessionView(row: AdminSessionRow): AdminSessionView {
  return {
    session: {
      id: row.id,
      classTypeId: row.class_type_id,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      capacity: row.capacity,
      modality: row.modality,
      status: row.status,
    },
    // Staff can read every class type; the fallback only covers a broken embed.
    classTypeName: row.class_type?.name ?? "—",
    instructorName: row.instructor_name,
    isPublished: row.is_published,
    confirmedCount: row.confirmed_count,
  }
}

/** Names stay raw text here: escaping is React's job at render time (never HTML injection). */
export function toRosterEntry(row: RosterRow): RosterEntry {
  return {
    bookingId: row.id,
    userId: row.user_id,
    displayName: row.profile?.display_name ?? null,
    email: row.profile?.email ?? null,
    status: row.status,
    attendance: row.attendance,
    bookedAt: iso(row.created_at),
  }
}

/** `mark_attendance` jsonb → MarkAttendanceResult. */
export function mapAttendanceRpc(data: unknown): MarkAttendanceResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.booking_id === "string" && typeof data.attendance === "string" && MARKS.includes(data.attendance)) {
    return { ok: true, bookingId: data.booking_id, attendance: data.attendance as AttendanceMark }
  }
  if (data.ok === false && typeof data.code === "string" && ATTENDANCE_CODES.includes(data.code)) {
    return { ok: false, code: data.code as AttendanceCode }
  }
  return { ok: false, code: "unknown" }
}
