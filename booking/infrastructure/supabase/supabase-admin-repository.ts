/**
 * AdminRepository over Supabase (anon key + the staff user's JWT). Reads use the existing RLS
 * policies, which already let staff read every session, booking, profile and class type through
 * `private.is_staff()` (migration 20261014000500); a student gets only her own rows, never
 * someone else's. Every write goes through a staff RPC that starts with `private.assert_staff()`
 * (ADR-005, ADR-015): mark_attendance, create_session, admin_upsert_class_type,
 * admin_update_session, admin_cancel_session, grant_credits, admin_adjust_credits, admin_book_for,
 * admin_cancel_for, admin_anonymize_student. Student balances come from the staff read RPCs admin_search_students /
 * admin_student_summary, so they always match the server's definition (Phase 4.3).
 */
import {
  RepositoryError,
  type AdjustCreditsCommand,
  type AdjustCreditsResult,
  type AdminGrantView,
  type AdminLedgerEntry,
  type AnonymizeStudentCommand,
  type AnonymizeStudentResult,
  type BookForStudentCommand,
  type BookForStudentResult,
  type CancelForStudentCommand,
  type CancelForStudentResult,
  type GrantCreditsCommand,
  type GrantCreditsResult,
  type StudentBookingView,
  type StudentSummary,
  type AdminClassTypeView,
  type AdminRepository,
  type AdminSessionView,
  type CancelSessionCommand,
  type CancelSessionResult,
  type CreateSessionsCommand,
  type CreateSessionsResult,
  type InstantRange,
  type MarkAttendanceCommand,
  type MarkAttendanceResult,
  type RosterEntry,
  type SaveClassTypeCommand,
  type SaveClassTypeResult,
  type StaffRole,
  type UpdateSessionCapacityCommand,
  type UpdateSessionResult,
  type WaitlistRosterEntry,
} from "../../application"
import type { SupabaseClientProvider } from "./client"
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
  toWaitlistRosterEntry,
  type AdminClassTypeRow,
  type AdminSessionRow,
  type RosterRow,
  type WaitlistRow,
} from "./admin-mappers"
import { mapPostgrestError, type PostgrestErrorLike } from "./mappers"
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
  type LedgerRow,
  type StudentBookingRow,
  type StudentGrantRow,
} from "./student-mappers"

const ADMIN_SESSION_COLUMNS =
  "id, class_type_id, starts_at, ends_at, capacity, confirmed_count, modality, status, is_published, instructor_name, " +
  "class_type:class_types(name)"
/** bookings has four FKs to profiles; the hint picks the student (`user_id`). Explicit columns only. */
const ROSTER_COLUMNS =
  "id, user_id, status, attendance, created_at, profile:profiles!bookings_user_id_fkey(display_name, email)"
/** waitlist_entries has one FK to profiles; the hint keeps the embed explicit (pgTAP 11 pins the name). */
const WAITLIST_COLUMNS =
  "id, user_id, status, skip_reason, created_at, resolved_at, profile:profiles!waitlist_entries_user_id_fkey(display_name, email)"
const CLASS_TYPE_COLUMNS =
  "id, name, description, default_duration_minutes, default_capacity, default_modality, is_published, sort_order"
const GRANT_COLUMNS = "id, credits_total, credits_remaining, valid_from, expires_at, note, created_at"
/** bookings → sessions has a single FK; class type name through the session. Explicit columns only. */
const STUDENT_BOOKING_COLUMNS =
  "id, session_id, status, attendance, refunded, source, created_at, " +
  "session:sessions(starts_at, ends_at, status, class_type:class_types(name))"
const LEDGER_COLUMNS = "id, user_id, grant_id, booking_id, reason, delta, note, actor_id, created_at"
/** Upper bound for one day's sessions / one roster (capacity ≤ 100 plus cancellations). */
const ROW_LIMIT = 500

interface Response<T> {
  data: T | null
  error: PostgrestErrorLike | null
  status: number
}

function unwrap<T>(response: Response<T>, what: string): T {
  if (response.error) {
    throw new RepositoryError(mapPostgrestError(response.error, response.status), `${what}: ${response.error.message ?? ""}`)
  }
  if (response.data === null) throw new RepositoryError("unknown", `${what}: empty response`)
  return response.data
}

export class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly client: SupabaseClientProvider) {}

  async getMyRole(): Promise<StaffRole | null> {
    const userId = await this.currentUserId()
    if (!userId) return null
    // Staff can read every profile: always scope to self. Only the role column is requested.
    const response = (await this.client().from("profiles").select("role").eq("id", userId).maybeSingle()) as Response<{
      role: string
    }>
    if (response.error) unwrap(response, "profiles")
    return toStaffRole(response.data)
  }

  async listSessions(range: InstantRange): Promise<AdminSessionView[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("sessions")
      .select(ADMIN_SESSION_COLUMNS)
      .gte("starts_at", range.from)
      .lt("starts_at", range.to)
      .order("starts_at")
      .order("id")
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<AdminSessionRow[]>, "sessions").map(toAdminSessionView)
  }

  async getSession(id: string): Promise<AdminSessionView | null> {
    await this.requireUserId()
    const response = (await this.client()
      .from("sessions")
      .select(ADMIN_SESSION_COLUMNS)
      .eq("id", id)
      .maybeSingle()) as unknown as Response<AdminSessionRow>
    if (response.error) {
      // A malformed (non-uuid) id from the URL is just "not found".
      if (mapPostgrestError(response.error, response.status) === "invalid_input") return null
      unwrap(response, "sessions")
    }
    return response.data ? toAdminSessionView(response.data) : null
  }

  async getRoster(sessionId: string): Promise<RosterEntry[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("bookings")
      .select(ROSTER_COLUMNS)
      .eq("session_id", sessionId)
      .order("created_at")
      .order("id")
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<RosterRow[]>, "bookings").map(toRosterEntry)
  }

  /** Plain RLS read (staff see every entry, ADR-015); join order = FIFO order. */
  async getWaitlist(sessionId: string): Promise<WaitlistRosterEntry[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("waitlist_entries")
      .select(WAITLIST_COLUMNS)
      .eq("session_id", sessionId)
      .order("created_at")
      .order("id")
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<WaitlistRow[]>, "waitlist_entries").map(toWaitlistRosterEntry)
  }

  async markAttendance(cmd: MarkAttendanceCommand): Promise<MarkAttendanceResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("mark_attendance", {
      p_booking_id: cmd.bookingId,
      p_attendance: cmd.attendance,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapAttendanceRpc(response.data)
  }

  async listClassTypes(): Promise<AdminClassTypeView[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("class_types")
      .select(CLASS_TYPE_COLUMNS)
      .order("sort_order")
      .order("name")
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<AdminClassTypeRow[]>, "class_types").map(toAdminClassTypeView)
  }

  async saveClassType(cmd: SaveClassTypeCommand): Promise<SaveClassTypeResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("admin_upsert_class_type", {
      p_id: cmd.id,
      p_name: cmd.name,
      p_description: cmd.description,
      p_default_duration_minutes: cmd.durationMinutes,
      p_default_capacity: cmd.defaultCapacity,
      p_default_modality: cmd.defaultModality,
      p_is_published: cmd.isPublished,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapSaveClassTypeRpc(response.data)
  }

  async createSessions(cmd: CreateSessionsCommand): Promise<CreateSessionsResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("create_session", {
      p_request_key: cmd.requestKey,
      p_class_type_id: cmd.classTypeId,
      p_local_date: cmd.localDate,
      p_local_start: cmd.localStart,
      p_duration_minutes: cmd.durationMinutes,
      p_capacity: cmd.capacity,
      p_modality: cmd.modality,
      p_instructor_name: cmd.instructorName,
      p_location_label: cmd.locationLabel,
      p_meeting_url: cmd.meetingUrl,
      p_address: cmd.address,
      p_repeat_weeks: cmd.repeatWeeks,
      p_is_published: true,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapCreateSessionsRpc(response.data)
  }

  async updateSessionCapacity(cmd: UpdateSessionCapacityCommand): Promise<UpdateSessionResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("admin_update_session", {
      p_session_id: cmd.sessionId,
      p_capacity: cmd.capacity,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapUpdateSessionRpc(response.data)
  }

  async cancelSession(cmd: CancelSessionCommand): Promise<CancelSessionResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    // No reason is sent: it would land in the refund ledger note, which students can read.
    const response = (await this.client().rpc("admin_cancel_session", { p_session_id: cmd.sessionId })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapCancelSessionRpc(response.data)
  }

  async searchStudents(query: string): Promise<StudentSummary[]> {
    await this.requireUserId()
    const response = (await this.client().rpc("admin_search_students", {
      p_query: query === "" ? null : query,
      p_limit: 50,
    })) as Response<unknown>
    const students = mapSearchStudentsRpc(unwrap(response, "admin_search_students"))
    if (!students) throw new RepositoryError("unknown", "admin_search_students: unrecognised response")
    return students
  }

  async getStudent(userId: string): Promise<StudentSummary | null> {
    await this.requireUserId()
    const response = (await this.client().rpc("admin_student_summary", { p_user_id: userId })) as Response<unknown>
    if (response.error && mapPostgrestError(response.error, response.status) === "invalid_input") return null
    const student = mapStudentSummaryRpc(unwrap(response, "admin_student_summary"))
    if (student === undefined) throw new RepositoryError("unknown", "admin_student_summary: unrecognised response")
    return student
  }

  async listStudentGrants(userId: string): Promise<AdminGrantView[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("credit_grants")
      .select(GRANT_COLUMNS)
      .eq("user_id", userId)
      .order("expires_at")
      .order("id")
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<StudentGrantRow[]>, "credit_grants").map(toAdminGrantView)
  }

  async listStudentBookings(userId: string): Promise<StudentBookingView[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("bookings")
      .select(STUDENT_BOOKING_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<StudentBookingRow[]>, "bookings")
      .map(toStudentBookingView)
      .filter((b): b is StudentBookingView => b !== null)
  }

  async listStudentLedger(userId: string): Promise<AdminLedgerEntry[]> {
    await this.requireUserId()
    const response = await this.client()
      .from("credit_ledger")
      .select(LEDGER_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ROW_LIMIT)
    return unwrap(response as unknown as Response<LedgerRow[]>, "credit_ledger").map(toAdminLedgerEntry)
  }

  async grantCredits(cmd: GrantCreditsCommand): Promise<GrantCreditsResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("grant_credits", {
      p_user_id: cmd.userId,
      p_credits: cmd.credits,
      p_valid_days: cmd.validDays,
      p_note: cmd.note,
      p_idempotency_key: cmd.requestKey,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapGrantCreditsRpc(response.data)
  }

  async adjustCredits(cmd: AdjustCreditsCommand): Promise<AdjustCreditsResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("admin_adjust_credits", {
      p_grant_id: cmd.grantId,
      p_delta: cmd.delta,
      p_reason: cmd.reason,
      p_request_key: cmd.requestKey,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapAdjustCreditsRpc(response.data)
  }

  async bookForStudent(cmd: BookForStudentCommand): Promise<BookForStudentResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("admin_book_for", {
      p_user_id: cmd.userId,
      p_session_id: cmd.sessionId,
      p_request_key: cmd.requestKey,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapBookForStudentRpc(response.data)
  }

  async cancelForStudent(cmd: CancelForStudentCommand): Promise<CancelForStudentResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("admin_cancel_for", {
      p_booking_id: cmd.bookingId,
      p_refund: cmd.refund,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapCancelForStudentRpc(response.data)
  }

  async anonymizeStudent(cmd: AnonymizeStudentCommand): Promise<AnonymizeStudentResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("admin_anonymize_student", {
      p_user_id: cmd.userId,
      p_confirm_email: cmd.confirmEmail,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapAnonymizeStudentRpc(response.data)
  }

  /** Local session only (UX); the database re-checks auth.uid() and the role on every call. */
  private async currentUserId(): Promise<string | null> {
    const { data } = await this.client().auth.getSession()
    return data.session?.user.id ?? null
  }

  private async requireUserId(): Promise<string> {
    const userId = await this.currentUserId()
    if (!userId) throw new RepositoryError("unauthenticated")
    return userId
  }
}
