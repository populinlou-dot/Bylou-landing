/**
 * Pure mapping for the Phase 4.3 staff side (AD-08 … AD-10): the student read RPCs
 * (`admin_search_students`, `admin_student_summary`), RLS-scoped reads of a student's packs, bookings
 * and ledger, and the write RPC envelopes (`grant_credits`, `admin_adjust_credits`, `admin_book_for`,
 * `admin_cancel_for`; migrations 20261014000700 and 20261014001000). Unknown shapes or codes become
 * "unknown"; user-provided text stays raw (React escapes it at render time).
 */
import type { CreditLedgerReason } from "../../domain"
import {
  ADJUST_CREDITS_CODES,
  BOOK_FOR_STUDENT_CODES,
  CANCEL_FOR_STUDENT_CODES,
  type AdjustCreditsCode,
  type AdjustCreditsResult,
  type AdminGrantView,
  type AdminLedgerEntry,
  type BookForStudentCode,
  type BookForStudentResult,
  type BookingSource,
  type CancelForStudentCode,
  type CancelForStudentResult,
  type GrantCreditsResult,
  type StudentBookingView,
  type StudentSummary,
} from "../../application"
import { iso } from "./mappers"

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value)
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null)
const isoOrNull = (value: unknown): string | null => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? iso(value) : null)

/* ---------- Student summaries (RPC jsonb) ---------- */

/** One `private.student_summary` object; null when the shape is not recognised. */
export function toStudentSummary(data: unknown): StudentSummary | null {
  if (!isObject(data) || typeof data.user_id !== "string" || !isCount(data.balance)) return null
  const next = data.next_booking
  const nextBooking =
    isObject(next) &&
    typeof next.booking_id === "string" &&
    typeof next.session_id === "string" &&
    typeof next.starts_at === "string" &&
    typeof next.class_type_name === "string"
      ? { bookingId: next.booking_id, sessionId: next.session_id, startsAt: iso(next.starts_at), classTypeName: next.class_type_name }
      : null
  return {
    userId: data.user_id,
    displayName: textOrNull(data.display_name),
    email: textOrNull(data.email),
    balance: data.balance,
    nextExpiry: isoOrNull(data.next_expiry),
    nextBooking,
  }
}

/** `admin_search_students` jsonb → summaries; null for an unrecognised envelope (adapter throws "unknown"). */
export function mapSearchStudentsRpc(data: unknown): StudentSummary[] | null {
  if (!isObject(data) || data.ok !== true || !Array.isArray(data.students)) return null
  const students = data.students.map(toStudentSummary)
  return students.every((s): s is StudentSummary => s !== null) ? students : null
}

/** `admin_student_summary` jsonb → summary, `null` for not_found, `undefined` for an unrecognised envelope. */
export function mapStudentSummaryRpc(data: unknown): StudentSummary | null | undefined {
  if (!isObject(data)) return undefined
  if (data.ok === false && data.code === "not_found") return null
  if (data.ok !== true) return undefined
  return toStudentSummary(data.student) ?? undefined
}

/* ---------- RLS table reads ---------- */

export interface StudentGrantRow {
  id: string
  credits_total: number
  credits_remaining: number
  valid_from: string
  expires_at: string
  note: string | null
  created_at: string
}

export function toAdminGrantView(row: StudentGrantRow): AdminGrantView {
  return {
    id: row.id,
    total: row.credits_total,
    remaining: row.credits_remaining,
    validFrom: iso(row.valid_from),
    expiresAt: iso(row.expires_at),
    note: row.note,
    createdAt: iso(row.created_at),
  }
}

export interface StudentBookingRow {
  id: string
  session_id: string
  status: StudentBookingView["status"]
  attendance: StudentBookingView["attendance"]
  refunded: boolean
  source: BookingSource
  created_at: string
  session: {
    starts_at: string
    ends_at: string
    status: StudentBookingView["sessionStatus"]
    class_type: { name: string } | null
  } | null
}

/** Null when the session embed is missing (should not happen for staff; skipped defensively). */
export function toStudentBookingView(row: StudentBookingRow): StudentBookingView | null {
  if (!row.session) return null
  return {
    bookingId: row.id,
    sessionId: row.session_id,
    startsAt: iso(row.session.starts_at),
    endsAt: iso(row.session.ends_at),
    classTypeName: row.session.class_type?.name ?? "—",
    sessionStatus: row.session.status,
    status: row.status,
    attendance: row.attendance,
    refunded: row.refunded,
    source: row.source,
    bookedAt: iso(row.created_at),
  }
}

export interface LedgerRow {
  /** bigint identity: PostgREST returns a number. */
  id: number | string
  user_id: string
  grant_id: string
  booking_id: string | null
  reason: CreditLedgerReason
  delta: number
  note: string | null
  actor_id: string | null
  created_at: string
}

/** Actor: null = system job; the student herself; anyone else = studio staff. */
export function toAdminLedgerEntry(row: LedgerRow): AdminLedgerEntry {
  return {
    id: String(row.id),
    grantId: row.grant_id,
    bookingId: row.booking_id,
    reason: row.reason,
    delta: row.delta,
    note: row.note,
    actor: row.actor_id === null ? "system" : row.actor_id === row.user_id ? "student" : "staff",
    createdAt: iso(row.created_at),
  }
}

/* ---------- Write RPC envelopes ---------- */

/** `grant_credits` jsonb → GrantCreditsResult. */
export function mapGrantCreditsRpc(data: unknown): GrantCreditsResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.grant_id === "string" && isCount(data.credits) && typeof data.expires_at === "string") {
    return { ok: true, grantId: data.grant_id, credits: data.credits, expiresAt: iso(data.expires_at), replayed: data.replayed === true }
  }
  if (data.ok === false && data.code === "not_found") return { ok: false, code: "not_found" }
  return { ok: false, code: "unknown" }
}

const ADJUST_CODES: readonly string[] = ADJUST_CREDITS_CODES

/** `admin_adjust_credits` jsonb → AdjustCreditsResult. */
export function mapAdjustCreditsRpc(data: unknown): AdjustCreditsResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (
    data.ok === true &&
    typeof data.grant_id === "string" &&
    isInt(data.delta) &&
    isCount(data.credits_remaining) &&
    isCount(data.balance)
  ) {
    return {
      ok: true,
      grantId: data.grant_id,
      delta: data.delta,
      creditsRemaining: data.credits_remaining,
      balance: data.balance,
      replayed: data.replayed === true,
    }
  }
  if (data.ok === false && typeof data.code === "string" && ADJUST_CODES.includes(data.code)) {
    const code = data.code as AdjustCreditsCode
    return isCount(data.credits_remaining) ? { ok: false, code, creditsRemaining: data.credits_remaining } : { ok: false, code }
  }
  return { ok: false, code: "unknown" }
}

const BOOK_FOR_CODES: readonly string[] = BOOK_FOR_STUDENT_CODES

/** `admin_book_for` jsonb → BookForStudentResult. */
export function mapBookForStudentRpc(data: unknown): BookForStudentResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.booking_id === "string") {
    return {
      ok: true,
      bookingId: data.booking_id,
      replayed: data.replayed === true,
      remainingCredits: isCount(data.remaining_credits) ? data.remaining_credits : null,
    }
  }
  if (data.ok === false && typeof data.code === "string" && BOOK_FOR_CODES.includes(data.code)) {
    return { ok: false, code: data.code as BookForStudentCode }
  }
  return { ok: false, code: "unknown" }
}

const CANCEL_FOR_CODES: readonly string[] = CANCEL_FOR_STUDENT_CODES

/** `admin_cancel_for` jsonb → CancelForStudentResult. */
export function mapCancelForStudentRpc(data: unknown): CancelForStudentResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.booking_id === "string" && typeof data.refunded === "boolean") {
    return {
      ok: true,
      bookingId: data.booking_id,
      refunded: data.refunded,
      refundSkipped: data.refund_skipped === true,
      replayed: data.replayed === true,
    }
  }
  if (data.ok === false && typeof data.code === "string" && CANCEL_FOR_CODES.includes(data.code)) {
    return { ok: false, code: data.code as CancelForStudentCode }
  }
  return { ok: false, code: "unknown" }
}
