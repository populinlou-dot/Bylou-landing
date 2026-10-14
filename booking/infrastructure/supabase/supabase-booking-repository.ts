/**
 * BookingRepository over Supabase (anon key + the user's JWT). Reads go through RLS-protected
 * tables / the security_invoker `session_availability` view; writes only through the
 * `book_session` / `cancel_booking` RPCs (ADR-005). No service-role key anywhere.
 */
import type { StudioRules } from "../../domain"
import {
  RepositoryError,
  type BookCommand,
  type BookResult,
  type BookingRepository,
  type CancelCommand,
  type CancelResult,
  type ClassTypeView,
  type Clock,
  type CreditBalance,
  type InstantRange,
  type MyBooking,
  type MyProfile,
  type SessionAvailability,
  type SessionPrivateDetails,
  type UpdateProfileResult,
} from "../../application"
import type { SupabaseClientProvider } from "./client"
import {
  mapBookRpc,
  mapCancelRpc,
  mapPostgrestError,
  toClassTypeView,
  toCreditBalance,
  toMyBooking,
  toPrivateDetails,
  toSessionAvailability,
  toStudioRules,
  type ClassTypeRow,
  type CreditGrantRow,
  type MyBookingRow,
  type MyConfirmedBooking,
  type PostgrestErrorLike,
  type PrivateDetailsRow,
  type SessionViewRow,
  type StudioSettingsRow,
} from "./mappers"

const SESSION_VIEW_COLUMNS =
  "id, class_type_id, class_type_name, starts_at, ends_at, modality, instructor_name, capacity, confirmed_count, status"
const CLASS_TYPE_COLUMNS = "id, name, description, default_duration_minutes, default_capacity"
const MY_BOOKING_COLUMNS =
  "id, session_id, user_id, status, attendance, idempotency_key, credit_grant_id, created_at, refunded, " +
  "session:sessions(id, class_type_id, starts_at, ends_at, capacity, modality, status, instructor_name, " +
  `class_type:class_types(${CLASS_TYPE_COLUMNS}))`
const MY_BOOKINGS_LIMIT = 200
/** Max ids per `in()` filter (36-char uuids → well under the 8 kB URL guideline). */
const IN_CHUNK = 50

interface MyConfirmedBookingRow {
  id: string
  session_id: string
  attendance: MyConfirmedBooking["attendance"]
}

interface Response<T> {
  data: T | null
  error: PostgrestErrorLike | null
  status: number
}

/** Unwraps a read; failures become RepositoryError with a transport code. */
function unwrap<T>(response: Response<T>, what: string): T {
  if (response.error) {
    throw new RepositoryError(mapPostgrestError(response.error, response.status), `${what}: ${response.error.message ?? ""}`)
  }
  if (response.data === null) throw new RepositoryError("unknown", `${what}: empty response`)
  return response.data
}

export class SupabaseBookingRepository implements BookingRepository {
  constructor(
    private readonly client: SupabaseClientProvider,
    private readonly clock: Clock,
  ) {}

  async getMyProfile(): Promise<MyProfile> {
    const userId = await this.requireUserId()
    const response = await this.client().from("profiles").select("display_name").eq("id", userId).maybeSingle()
    const row = unwrap(response as Response<{ display_name: string | null }>, "profiles")
    return { displayName: row.display_name }
  }

  /**
   * Column-level grant + `profiles_update_own` RLS: a student may update only her own
   * `display_name` (and `phone`); `role` and `email` are not updatable (pgTAP E5).
   */
  async updateMyDisplayName(displayName: string): Promise<UpdateProfileResult> {
    const userId = await this.currentUserId()
    if (!userId) return { ok: false, code: "unauthenticated" }
    const response = (await this.client()
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", userId)
      .select("display_name")
      .maybeSingle()) as Response<{ display_name: string | null }>
    if (response.error) {
      // 23514 = the display_name CHECK (1–80 chars): the UI validates first, so this is bad input.
      if (response.error.code === "23514") return { ok: false, code: "invalid_input" }
      return { ok: false, code: mapPostgrestError(response.error, response.status) }
    }
    // No row back = RLS filtered the update (not the caller's row).
    if (!response.data || typeof response.data.display_name !== "string") return { ok: false, code: "forbidden" }
    return { ok: true, displayName: response.data.display_name }
  }

  async getStudioRules(): Promise<StudioRules> {
    const response = await this.client()
      .from("studio_settings")
      .select("timezone, booking_opens_days, booking_closes_minutes, cancellation_window_hours, late_cancel_policy, credits_per_booking")
      .eq("id", 1)
      .single()
    return toStudioRules(unwrap(response as Response<StudioSettingsRow>, "studio_settings"))
  }

  async listClassTypes(): Promise<ClassTypeView[]> {
    const response = await this.client()
      .from("class_types")
      .select(CLASS_TYPE_COLUMNS)
      .eq("is_published", true)
      .order("sort_order")
      .order("name")
    return unwrap(response as Response<ClassTypeRow[]>, "class_types").map(toClassTypeView)
  }

  async listSessions(range: InstantRange): Promise<SessionAvailability[]> {
    const [rowsResponse, classTypes] = await Promise.all([
      this.client()
        .from("session_availability")
        .select(SESSION_VIEW_COLUMNS)
        .gte("starts_at", range.from)
        .lt("starts_at", range.to)
        .order("starts_at")
        .order("id"),
      this.listClassTypes(),
    ])
    const rows = unwrap(rowsResponse as Response<SessionViewRow[]>, "session_availability")
    const mine = rows.length > 0 ? await this.myConfirmedBookingsInRange(range) : new Map<string, MyConfirmedBooking>()
    const byId = new Map(classTypes.map((ct) => [ct.id, ct]))
    return rows.map((row) => toSessionAvailability(row, byId, mine.get(row.id) ?? null))
  }

  async getSession(id: string): Promise<SessionAvailability | null> {
    const [rowResponse, classTypes] = await Promise.all([
      this.client().from("session_availability").select(SESSION_VIEW_COLUMNS).eq("id", id).maybeSingle(),
      this.listClassTypes(),
    ])
    const response = rowResponse as Response<SessionViewRow>
    if (response.error) {
      // A malformed (non-uuid) id is just "not found" for a deep link.
      if (mapPostgrestError(response.error, response.status) === "invalid_input") return null
      unwrap(response, "session_availability")
    }
    if (!response.data) return null
    const mine = await this.myConfirmedBookings([id])
    return toSessionAvailability(response.data, new Map(classTypes.map((ct) => [ct.id, ct])), mine.get(id) ?? null)
  }

  async getSessionPrivateDetails(sessionId: string): Promise<SessionPrivateDetails | null> {
    if (!(await this.currentUserId())) return null
    const response = await this.client()
      .from("session_private_details")
      .select("session_id, meeting_url, address, instructions")
      .eq("session_id", sessionId)
      .maybeSingle()
    const typed = response as Response<PrivateDetailsRow>
    if (typed.error) unwrap(typed, "session_private_details")
    return toPrivateDetails(typed.data)
  }

  async listMyBookings(): Promise<MyBooking[]> {
    const userId = await this.requireUserId()
    const response = await this.client()
      .from("bookings")
      .select(MY_BOOKING_COLUMNS)
      .eq("user_id", userId) // staff can read every booking through RLS: always scope to self
      .order("created_at", { ascending: false })
      .limit(MY_BOOKINGS_LIMIT)
    const rows = unwrap(response as unknown as Response<MyBookingRow[]>, "bookings")
    // Details only matter for sessions that have not ended (upcoming list).
    const nowMs = this.clock.now().getTime()
    const activeSessionIds = rows
      .filter((r) => r.status === "confirmed" && r.session && Date.parse(r.session.ends_at) > nowMs)
      .map((r) => r.session_id)
    const details = new Map<string, SessionPrivateDetails>()
    // Chunked so the query string never approaches PostgREST/proxy URL limits.
    for (let i = 0; i < activeSessionIds.length; i += IN_CHUNK) {
      const detailsResponse = await this.client()
        .from("session_private_details")
        .select("session_id, meeting_url, address, instructions")
        .in("session_id", activeSessionIds.slice(i, i + IN_CHUNK))
      for (const row of unwrap(detailsResponse as Response<PrivateDetailsRow[]>, "session_private_details")) {
        const mapped = toPrivateDetails(row)
        if (mapped) details.set(row.session_id, mapped)
      }
    }
    return rows.map((row) => toMyBooking(row, details)).filter((b): b is MyBooking => b !== null)
  }

  async getMyCreditBalance(): Promise<CreditBalance> {
    const userId = await this.requireUserId()
    const now = this.clock.now()
    const response = await this.client()
      .from("credit_grants")
      .select("id, credits_total, credits_remaining, valid_from, expires_at, note")
      .eq("user_id", userId)
      .gt("expires_at", now.toISOString())
      .order("expires_at")
    return toCreditBalance(unwrap(response as Response<CreditGrantRow[]>, "credit_grants"), now)
  }

  async book(cmd: BookCommand): Promise<BookResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("book_session", {
      p_session_id: cmd.sessionId,
      p_idempotency_key: cmd.idempotencyKey,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapBookRpc(response.data)
  }

  async cancel(cmd: CancelCommand): Promise<CancelResult> {
    if (!(await this.currentUserId())) return { ok: false, code: "unauthenticated" }
    const response = (await this.client().rpc("cancel_booking", {
      p_booking_id: cmd.bookingId,
      p_idempotency_key: cmd.idempotencyKey,
      p_accept_late: cmd.acceptLate === true,
    })) as Response<unknown>
    if (response.error) return { ok: false, code: mapPostgrestError(response.error, response.status) }
    return mapCancelRpc(response.data)
  }

  /** Local session only (UX); the database re-checks auth.uid() on every call. */
  private async currentUserId(): Promise<string | null> {
    const { data } = await this.client().auth.getSession()
    return data.session?.user.id ?? null
  }

  private async requireUserId(): Promise<string> {
    const userId = await this.currentUserId()
    if (!userId) throw new RepositoryError("unauthenticated")
    return userId
  }

  /**
   * session id → the caller's confirmed booking id for sessions starting in `range`. Filters on
   * the embedded session instead of sending every session id (a busy week would overflow the URL).
   */
  private async myConfirmedBookingsInRange(range: InstantRange): Promise<Map<string, MyConfirmedBooking>> {
    const result = new Map<string, MyConfirmedBooking>()
    const userId = await this.currentUserId()
    if (!userId) return result
    const response = await this.client()
      .from("bookings")
      .select("id, session_id, attendance, session:sessions!inner(starts_at)")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .gte("session.starts_at", range.from)
      .lt("session.starts_at", range.to)
    for (const row of unwrap(response as unknown as Response<MyConfirmedBookingRow[]>, "bookings")) {
      result.set(row.session_id, { id: row.id, attendance: row.attendance })
    }
    return result
  }

  /** session id → the caller's confirmed booking (id + attendance), for a few sessions. Empty when signed out. */
  private async myConfirmedBookings(sessionIds: string[]): Promise<Map<string, MyConfirmedBooking>> {
    const result = new Map<string, MyConfirmedBooking>()
    if (sessionIds.length === 0) return result
    const userId = await this.currentUserId()
    if (!userId) return result
    const response = await this.client()
      .from("bookings")
      .select("id, session_id, attendance")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .in("session_id", sessionIds)
    for (const row of unwrap(response as Response<MyConfirmedBookingRow[]>, "bookings")) {
      result.set(row.session_id, { id: row.id, attendance: row.attendance })
    }
    return result
  }
}
