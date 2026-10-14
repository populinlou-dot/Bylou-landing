/**
 * AdminRepository over Supabase (anon key + the staff user's JWT). Reads use the existing RLS
 * policies, which already let staff read every session, booking, profile and class type through
 * `private.is_staff()` (migration 20261014000500); a student gets only her own rows, never
 * someone else's. Every write goes through a staff RPC that starts with `private.assert_staff()`
 * (ADR-005, ADR-015): mark_attendance, create_session, admin_upsert_class_type,
 * admin_update_session, admin_cancel_session.
 */
import {
  RepositoryError,
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
  type AdminClassTypeRow,
  type AdminSessionRow,
  type RosterRow,
} from "./admin-mappers"
import { mapPostgrestError, type PostgrestErrorLike } from "./mappers"

const ADMIN_SESSION_COLUMNS =
  "id, class_type_id, starts_at, ends_at, capacity, confirmed_count, modality, status, is_published, instructor_name, " +
  "class_type:class_types(name)"
/** bookings has four FKs to profiles; the hint picks the student (`user_id`). Explicit columns only. */
const ROSTER_COLUMNS =
  "id, user_id, status, attendance, created_at, profile:profiles!bookings_user_id_fkey(display_name, email)"
const CLASS_TYPE_COLUMNS =
  "id, name, description, default_duration_minutes, default_capacity, default_modality, is_published, sort_order"
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
