/**
 * Pure mapping for the staff side (Phase 4.1/4.2): RLS-scoped table reads (staff see every row
 * through `private.is_staff()` policies) and the admin RPC envelopes (`mark_attendance`,
 * `create_session`, `admin_upsert_class_type`, `admin_update_session`, `admin_cancel_session`;
 * migrations 20261014000700 and 20261014000900). Unknown shapes or codes become "unknown".
 */
import type { Booking, Modality } from "../../domain"
import {
  UPDATE_SESSION_CODES,
  type AdminClassTypeView,
  type AdminSessionView,
  type AttendanceCode,
  type AttendanceMark,
  type CancelSessionResult,
  type CreateSessionsResult,
  type MarkAttendanceResult,
  type RosterEntry,
  type SaveClassTypeResult,
  type StaffRole,
  type UpdateSessionCode,
  type UpdateSessionResult,
} from "../../application"
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

export interface AdminClassTypeRow {
  id: string
  name: string
  description: string | null
  default_duration_minutes: number
  default_capacity: number
  default_modality: Modality
  is_published: boolean
  sort_order: number
}

export function toAdminClassTypeView(row: AdminClassTypeRow): AdminClassTypeView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.default_duration_minutes,
    defaultCapacity: row.default_capacity,
    defaultModality: row.default_modality,
    isPublished: row.is_published,
    sortOrder: row.sort_order,
  }
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string")

/** `admin_upsert_class_type` jsonb → SaveClassTypeResult (it has no business refusals). */
export function mapSaveClassTypeRpc(data: unknown): SaveClassTypeResult {
  if (isObject(data) && data.ok === true && typeof data.class_type_id === "string" && typeof data.is_published === "boolean") {
    return {
      ok: true,
      classTypeId: data.class_type_id,
      created: data.created === true,
      isPublished: data.is_published,
      upcomingSessions: isCount(data.upcoming_sessions) ? data.upcoming_sessions : 0,
    }
  }
  return { ok: false, code: "unknown" }
}

/** `create_session` jsonb → CreateSessionsResult. */
export function mapCreateSessionsRpc(data: unknown): CreateSessionsResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && isStringArray(data.session_ids) && data.session_ids.length > 0) {
    return { ok: true, sessionIds: data.session_ids, replayed: data.replayed === true }
  }
  if (data.ok === false && data.code === "not_found") return { ok: false, code: "not_found" }
  return { ok: false, code: "unknown" }
}

const UPDATE_CODES: readonly string[] = UPDATE_SESSION_CODES

/** `admin_update_session` jsonb → UpdateSessionResult. */
export function mapUpdateSessionRpc(data: unknown): UpdateSessionResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.session_id === "string" && isCount(data.capacity) && isCount(data.confirmed_count)) {
    return {
      ok: true,
      sessionId: data.session_id,
      capacity: data.capacity,
      confirmedCount: data.confirmed_count,
      changed: data.changed === true,
    }
  }
  if (data.ok === false && typeof data.code === "string" && UPDATE_CODES.includes(data.code)) {
    const code = data.code as UpdateSessionCode
    return isCount(data.confirmed_count) ? { ok: false, code, confirmedCount: data.confirmed_count } : { ok: false, code }
  }
  return { ok: false, code: "unknown" }
}

/** `admin_cancel_session` jsonb → CancelSessionResult. */
export function mapCancelSessionRpc(data: unknown): CancelSessionResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (
    data.ok === true &&
    typeof data.session_id === "string" &&
    isCount(data.cancelled_bookings) &&
    isCount(data.refunded) &&
    isStringArray(data.refunds_skipped)
  ) {
    return {
      ok: true,
      sessionId: data.session_id,
      cancelledBookings: data.cancelled_bookings,
      refunded: data.refunded,
      refundsSkipped: data.refunds_skipped,
      replayed: data.replayed === true,
    }
  }
  if (data.ok === false && data.code === "not_found") return { ok: false, code: "not_found" }
  return { ok: false, code: "unknown" }
}
