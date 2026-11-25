/**
 * Pure mapping between Supabase responses and application types (no network, unit-tested).
 * RPC envelopes follow DATA_MODEL §6 / migration 20261014000600: snake_case jsonb,
 * `{ ok: true, booking_id, … }` or `{ ok: false, code, … }`. Unknown codes become "unknown".
 */
import {
  BOOKING_REJECTION_CODES,
  CANCELLATION_CODES,
  type Attendance,
  type Booking,
  type Modality,
  type StudioRules,
  type WaitlistSkipReason,
  type WaitlistStatus,
} from "../../domain"
import { BOOK_RPC_CODES, WAITLIST_CODES } from "../../application"
import type {
  AuthCode,
  BookCode,
  BookResult,
  CancelCode,
  CancelResult,
  BookingSource,
  ClassTypeView,
  CreditBalance,
  JoinWaitlistResult,
  LeaveWaitlistResult,
  MyBooking,
  MyWaitlistEntry,
  WaitlistCode,
  SessionAvailability,
  SessionPrivateDetails,
  TransportCode,
} from "../../application"

const BOOK_CODES: readonly string[] = [...BOOKING_REJECTION_CODES, ...BOOK_RPC_CODES]
const CANCEL_CODES: readonly string[] = [...CANCELLATION_CODES, "not_found", "not_owner"]

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** `book_session` jsonb → BookResult. */
export function mapBookRpc(data: unknown): BookResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.booking_id === "string") {
    return {
      ok: true,
      bookingId: data.booking_id,
      replayed: data.replayed === true,
      remainingCredits: typeof data.remaining_credits === "number" ? data.remaining_credits : null,
    }
  }
  if (data.ok === false && typeof data.code === "string" && BOOK_CODES.includes(data.code)) {
    return { ok: false, code: data.code as BookCode }
  }
  return { ok: false, code: "unknown" }
}

/** `cancel_booking` jsonb → CancelResult. */
export function mapCancelRpc(data: unknown): CancelResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (
    data.ok === true &&
    typeof data.booking_id === "string" &&
    (data.status === "cancelled" || data.status === "late_cancelled")
  ) {
    return {
      ok: true,
      bookingId: data.booking_id,
      status: data.status,
      refunded: data.refunded === true,
      replayed: data.replayed === true,
    }
  }
  if (data.ok === false && typeof data.code === "string" && CANCEL_CODES.includes(data.code)) {
    return { ok: false, code: data.code as CancelCode }
  }
  return { ok: false, code: "unknown" }
}

const WAITLIST_STATUSES: readonly string[] = ["waiting", "promoted", "skipped", "left", "closed"]
const WAITLIST_ERROR_CODES: readonly string[] = WAITLIST_CODES
const isWaitlistStatus = (value: unknown): value is WaitlistStatus =>
  typeof value === "string" && WAITLIST_STATUSES.includes(value)
const positionOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null

function waitlistFailure(data: Json): { ok: false; code: WaitlistCode } {
  if (data.ok === false && typeof data.code === "string" && WAITLIST_ERROR_CODES.includes(data.code)) {
    return { ok: false, code: data.code as WaitlistCode }
  }
  return { ok: false, code: "unknown" }
}

/** `join_waitlist` jsonb → JoinWaitlistResult (migration 20261014001300). */
export function mapJoinWaitlistRpc(data: unknown): JoinWaitlistResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && typeof data.entry_id === "string" && isWaitlistStatus(data.status)) {
    return {
      ok: true,
      entryId: data.entry_id,
      status: data.status,
      position: positionOrNull(data.position),
      replayed: data.replayed === true,
    }
  }
  return waitlistFailure(data)
}

/** `leave_waitlist` jsonb → LeaveWaitlistResult. */
export function mapLeaveWaitlistRpc(data: unknown): LeaveWaitlistResult {
  if (!isObject(data)) return { ok: false, code: "unknown" }
  if (data.ok === true && isWaitlistStatus(data.status)) {
    return {
      ok: true,
      status: data.status,
      bookingId: typeof data.booking_id === "string" ? data.booking_id : null,
      replayed: data.replayed === true,
    }
  }
  return waitlistFailure(data)
}

const SKIP_REASONS: readonly string[] = ["no_valid_credit", "already_booked", "profile_incomplete", "too_many_changes", "promotion_failed"]
const MODALITIES: readonly string[] = ["in_person", "online"]

/** One `my_waitlist_entries` item; malformed items are dropped instead of rendering half a card. */
function toMyWaitlistEntry(item: unknown): MyWaitlistEntry | null {
  if (!isObject(item) || !isObject(item.session)) return null
  const session = item.session
  if (
    typeof item.entry_id !== "string" ||
    !isWaitlistStatus(item.status) ||
    typeof item.created_at !== "string" ||
    typeof session.id !== "string" ||
    typeof session.class_type_id !== "string" ||
    typeof session.class_type_name !== "string" ||
    typeof session.starts_at !== "string" ||
    typeof session.ends_at !== "string" ||
    typeof session.capacity !== "number" ||
    typeof session.modality !== "string" ||
    !MODALITIES.includes(session.modality) ||
    (session.status !== "scheduled" && session.status !== "cancelled")
  ) {
    return null
  }
  return {
    entryId: item.entry_id,
    session: {
      id: session.id,
      classTypeId: session.class_type_id,
      startsAt: iso(session.starts_at),
      endsAt: iso(session.ends_at),
      capacity: session.capacity,
      modality: session.modality as Modality,
      status: session.status,
    },
    classTypeName: session.class_type_name,
    instructorName: typeof session.instructor_name === "string" ? session.instructor_name : null,
    status: item.status,
    skipReason:
      typeof item.skip_reason === "string" && SKIP_REASONS.includes(item.skip_reason)
        ? (item.skip_reason as WaitlistSkipReason)
        : null,
    position: item.status === "waiting" ? positionOrNull(item.position) : null,
    bookingId: typeof item.booking_id === "string" ? item.booking_id : null,
    createdAt: iso(item.created_at),
    resolvedAt: typeof item.resolved_at === "string" ? iso(item.resolved_at) : null,
  }
}

/** `my_waitlist_entries` jsonb → her entries (empty when the studio has the waitlist off). Null = bad shape. */
export function mapMyWaitlistRpc(data: unknown): MyWaitlistEntry[] | null {
  if (!isObject(data) || data.ok !== true || !Array.isArray(data.entries)) return null
  return data.entries.map(toMyWaitlistEntry).filter((e): e is MyWaitlistEntry => e !== null)
}

export interface PostgrestErrorLike {
  code?: string | null
  message?: string | null
}

/**
 * PostgREST / Postgres failures → transport codes (ARCHITECTURE §5).
 * - status 0: fetch failed (supabase-js returns it instead of throwing).
 * - 42501: raised by the RPCs as 'unauthenticated' / 'forbidden'; PostgREST answers 401 for the
 *   anon role (no EXECUTE grant) and 403 for authenticated callers without the privilege.
 * - PGRST30x / HTTP 401: missing, invalid or expired JWT.
 * - SQLSTATE class 22 (e.g. 22023 key reuse, 22P02 malformed uuid): invalid_input.
 */
export function mapPostgrestError(error: PostgrestErrorLike | null | undefined, status: number): TransportCode {
  const code = error?.code ?? ""
  const message = (error?.message ?? "").toLowerCase()
  if (status === 0) return "network_error"
  if (code === "42501") {
    if (message === "unauthenticated") return "unauthenticated"
    if (message === "forbidden") return "forbidden"
    return status === 401 ? "unauthenticated" : "forbidden"
  }
  if (code.startsWith("PGRST30") || status === 401) return "unauthenticated"
  if (status === 403) return "forbidden"
  if (code.startsWith("22")) return "invalid_input"
  if (status === 502 || status === 503 || status === 504) return "network_error"
  return "unknown"
}

export interface AuthErrorLike {
  name?: string
  code?: string | null
  status?: number | null
}

/** Supabase Auth errors → AuthCode. `step` disambiguates generic validation failures. */
export function mapAuthError(error: AuthErrorLike, step: "request" | "verify"): AuthCode {
  const code = error.code ?? ""
  if (error.name === "AuthRetryableFetchError" || error.status === 0) return "network_error"
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return "rate_limited"
  }
  // GoTrue answers otp_expired for both a wrong and an expired code ("Token has expired or is invalid").
  if (code === "otp_expired") return "invalid_code"
  // Missing, expired, already spent or rejected bot-protection token (GoTrue verifyCaptcha, 400; ADR-024).
  if (code === "captcha_failed") return "captcha_failed"
  if (code === "email_address_invalid") return "invalid_email"
  if (code === "validation_failed") return step === "request" ? "invalid_email" : "invalid_code"
  return "unknown"
}

/* ---------- Row shapes (columns selected by the repository) ---------- */

export interface ClassTypeRow {
  id: string
  name: string
  description: string | null
  default_duration_minutes: number
  default_capacity: number
}

export interface SessionViewRow {
  id: string
  class_type_id: string
  class_type_name: string
  starts_at: string
  ends_at: string
  modality: Modality
  instructor_name: string | null
  capacity: number
  confirmed_count: number
  status: "scheduled" | "cancelled"
}

export interface StudioSettingsRow {
  timezone: string
  booking_opens_days: number
  booking_closes_minutes: number
  cancellation_window_hours: number
  late_cancel_policy: "allow_without_refund" | "deny"
  credits_per_booking: number
}

export interface PrivateDetailsRow {
  session_id: string
  meeting_url: string | null
  address: string | null
  instructions: string | null
}

export interface MyBookingRow {
  id: string
  session_id: string
  user_id: string
  status: Booking["status"]
  attendance: Booking["attendance"]
  idempotency_key: string
  credit_grant_id: string | null
  created_at: string
  refunded: boolean
  source: BookingSource
  session: {
    id: string
    class_type_id: string
    starts_at: string
    ends_at: string
    capacity: number
    modality: Modality
    status: "scheduled" | "cancelled"
    instructor_name: string | null
    class_type: ClassTypeRow | null
  } | null
}

export interface CreditGrantRow {
  id: string
  credits_total: number
  credits_remaining: number
  valid_from: string
  expires_at: string
  note: string | null
}

/** Postgres timestamptz text ("…+00:00") → canonical UTC ISO. */
export const iso = (value: string): string => new Date(value).toISOString()

export function toClassTypeView(row: ClassTypeRow): ClassTypeView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.default_duration_minutes,
    defaultCapacity: row.default_capacity,
  }
}

export function toStudioRules(row: StudioSettingsRow): StudioRules {
  return {
    timezone: row.timezone,
    bookingWindow: { opensDaysBefore: row.booking_opens_days, closesMinutesBefore: row.booking_closes_minutes },
    cancellationWindowHours: row.cancellation_window_hours,
    lateCancelPolicy: row.late_cancel_policy,
    creditsPerBooking: row.credits_per_booking,
  }
}

/**
 * View row → SessionAvailability. A class type missing from the published catalog (visible only
 * through the caller's own booking) gets a minimal view built from the row itself.
 */
/** The caller's own confirmed booking of a session (id + attendance), from an RLS-scoped `bookings` read. */
export interface MyConfirmedBooking {
  id: string
  attendance: Attendance
}

export function toSessionAvailability(
  row: SessionViewRow,
  classTypes: ReadonlyMap<string, ClassTypeView>,
  mine: MyConfirmedBooking | null,
): SessionAvailability {
  const startsAt = iso(row.starts_at)
  const endsAt = iso(row.ends_at)
  const classType = classTypes.get(row.class_type_id) ?? {
    id: row.class_type_id,
    name: row.class_type_name,
    description: null,
    durationMinutes: Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000),
    defaultCapacity: row.capacity,
  }
  return {
    session: {
      id: row.id,
      classTypeId: row.class_type_id,
      startsAt,
      endsAt,
      capacity: row.capacity,
      modality: row.modality,
      status: row.status,
    },
    classType,
    confirmedCount: row.confirmed_count,
    instructorName: row.instructor_name,
    myBookingId: mine?.id ?? null,
    myAttendance: mine ? mine.attendance : null,
  }
}

export function toPrivateDetails(row: PrivateDetailsRow | null | undefined): SessionPrivateDetails | null {
  if (!row) return null
  if (!row.meeting_url && !row.address && !row.instructions) return null
  return { meetingUrl: row.meeting_url, address: row.address, instructions: row.instructions }
}

/** Rows whose session/class type RLS hid are dropped instead of rendering half a card. */
export function toMyBooking(row: MyBookingRow, details: ReadonlyMap<string, SessionPrivateDetails>): MyBooking | null {
  const session = row.session
  if (!session || !session.class_type) return null
  return {
    booking: {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      status: row.status,
      attendance: row.attendance,
      idempotencyKey: row.idempotency_key,
      creditGrantId: row.credit_grant_id,
      createdAt: iso(row.created_at),
    },
    session: {
      id: session.id,
      classTypeId: session.class_type_id,
      startsAt: iso(session.starts_at),
      endsAt: iso(session.ends_at),
      capacity: session.capacity,
      modality: session.modality,
      status: session.status,
    },
    classType: toClassTypeView(session.class_type),
    instructorName: session.instructor_name,
    refunded: row.refunded,
    source: row.source === "waitlist" || row.source === "staff" ? row.source : "student",
    privateDetails: row.status === "confirmed" ? (details.get(row.session_id) ?? null) : null,
  }
}

/** Mirrors private.usable_balance: Σ remaining over grants with valid_from ≤ now < expires_at. */
export function toCreditBalance(rows: readonly CreditGrantRow[], now: Date): CreditBalance {
  const nowMs = now.getTime()
  const active = rows
    .filter((g) => Date.parse(g.valid_from) <= nowMs && Date.parse(g.expires_at) > nowMs && g.credits_remaining > 0)
    .map((g) => ({
      id: g.id,
      total: g.credits_total,
      remaining: g.credits_remaining,
      validFrom: iso(g.valid_from),
      expiresAt: iso(g.expires_at),
      note: g.note,
    }))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || (a.id < b.id ? -1 : 1))
  return {
    available: active.reduce((sum, g) => sum + g.remaining, 0),
    nextExpiry: active[0]?.expiresAt ?? null,
    activeGrants: active,
  }
}
