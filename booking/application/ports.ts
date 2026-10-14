/**
 * Ports for the booking application layer (ARCHITECTURE.md §3).
 * Read side (Phase 2) plus the transactional side (Phase 3): book, cancel, my bookings,
 * credit balance and the auth port. All instants are UTC ISO-8601 strings.
 */
import type {
  Attendance,
  Booking,
  WaitlistSkipReason,
  WaitlistStatus,
  BookingRejectionCode,
  CancellationCode,
  ClassType,
  CreditLedgerReason,
  IsoDateTime,
  Modality,
  Session,
  StudioRules,
} from "../domain"

export interface Clock {
  /** Injected so tests and the mock seed control time. */
  now(): Date
}

/** Half-open instant range `[from, to)` on `Session.startsAt`, UTC ISO-8601. */
export interface InstantRange {
  from: IsoDateTime
  to: IsoDateTime
}

/**
 * Read model of a class type. `description` is display-only and lives here (not in the
 * domain `ClassType`) until DATA_MODEL decides where catalog text is stored.
 */
export interface ClassTypeView extends ClassType {
  description: string | null
}

/** One session as the public agenda sees it. Never carries other users' rows. */
export interface SessionAvailability {
  session: Session
  classType: ClassTypeView
  /** Aggregate count of confirmed bookings (SECURITY DEFINER view/RPC in Supabase). */
  confirmedCount: number
  /** Display name of whoever teaches it; null when not assigned. */
  instructorName: string | null
  /** Current user's active (confirmed) booking id; null when signed out or not booked. */
  myBookingId: string | null
  /** Attendance recorded on that booking; null exactly when `myBookingId` is null. */
  myAttendance: Attendance | null
}

/**
 * Attendee-only details (meeting link, address). The backend returns them only to staff and
 * to holders of a confirmed booking (RLS); the UI shows them only when present.
 */
export interface SessionPrivateDetails {
  meetingUrl: string | null
  address: string | null
  instructions: string | null
}

export interface MyBooking {
  booking: Booking
  session: Session
  classType: ClassTypeView
  instructorName: string | null
  /** True when the debited credit went back to the pack on cancellation. */
  refunded: boolean
  /** "waitlist" = she was moved into this class from the waitlist (Phase 4.4). */
  source: BookingSource
  /** Present only for confirmed bookings the backend still shares details for. */
  privateDetails: SessionPrivateDetails | null
}

export interface CreditGrantView {
  id: string
  total: number
  remaining: number
  validFrom: IsoDateTime
  expiresAt: IsoDateTime
  note: string | null
}

export interface CreditBalance {
  /** Credits usable right now (non-expired, already valid, not consumed). */
  available: number
  /** Earliest expiry among grants that still have credits; null when none. */
  nextExpiry: IsoDateTime | null
  /** Grants valid now with credits left, earliest expiry first. */
  activeGrants: CreditGrantView[]
}

/** Transport-level failures shared by every call (ARCHITECTURE §5). */
export const TRANSPORT_CODES = ["unauthenticated", "forbidden", "invalid_input", "network_error", "unknown"] as const
export type TransportCode = (typeof TRANSPORT_CODES)[number]

/**
 * Application/RPC-only codes of `book_session` (not domain rules): `not_found` (unknown or invisible id),
 * `too_many_changes` (churn throttle, ADR-019: too many self-cancellations, or re-bookings of the same
 * session, in the last 24 h) and `profile_incomplete` (no display name yet; owner decision 2026-10-14).
 */
export const BOOK_RPC_CODES = ["not_found", "too_many_changes", "profile_incomplete"] as const
export type BookCode = BookingRejectionCode | (typeof BOOK_RPC_CODES)[number] | TransportCode
export type CancelCode = CancellationCode | "not_found" | "not_owner" | TransportCode

export interface BookCommand {
  sessionId: string
  /** Generated once per confirm sheet and reused on retries (DATA_MODEL §5). */
  idempotencyKey: string
}

export interface CancelCommand {
  bookingId: string
  idempotencyKey: string
  /** Maps to p_accept_late; only meaningful when lateCancelPolicy = "allow_without_refund". */
  acceptLate?: boolean
}

export type BookResult =
  | { ok: true; bookingId: string; replayed: boolean; remainingCredits: number | null }
  | { ok: false; code: BookCode }

export type CancelResult =
  | { ok: true; bookingId: string; status: "cancelled" | "late_cancelled"; refunded: boolean; replayed: boolean }
  | { ok: false; code: CancelCode }

/** Read failures raise this so containers can tell "sign in" apart from "retry". */
export class RepositoryError extends Error {
  constructor(
    readonly code: TransportCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = "RepositoryError"
  }
}

/** The signed-in user's own profile (RLS: a student reads and updates only her own row). */
export interface MyProfile {
  /** `profiles.display_name`; null until the student sets one. User-provided: plain text only. */
  displayName: string | null
}

export type UpdateProfileResult = { ok: true; displayName: string } | { ok: false; code: TransportCode }

/* ---------- Waitlist (Phase 4.4, PRD ST-12, ADR-021) ---------- */

/**
 * Business refusals of `join_waitlist` / `leave_waitlist` (application/RPC codes): the session is not full,
 * the list is closed because the class starts within the cancellation window, the studio has the waitlist off,
 * the queue is full (50) or she already waits for 10 classes, plus the codes shared with `book_session`.
 */
export const WAITLIST_CODES = [
  "session_not_full",
  "waitlist_closed",
  "waitlist_disabled",
  "already_booked",
  "session_cancelled",
  "session_started",
  "booking_not_open",
  "booking_closed",
  "too_many_changes",
  "profile_incomplete",
  "waitlist_full",
  "too_many_waitlists",
  "not_found",
] as const
export type WaitlistCode = (typeof WAITLIST_CODES)[number] | TransportCode

export interface JoinWaitlistCommand {
  sessionId: string
  /** Generated once per tap and reused on retries: the server replays instead of joining twice. */
  requestKey: string
}

export type JoinWaitlistResult =
  | { ok: true; entryId: string; status: WaitlistStatus; position: number | null; replayed: boolean }
  | { ok: false; code: WaitlistCode }

/** State-idempotent: no waiting entry left answers ok with the latest status (she may have been promoted). */
export type LeaveWaitlistResult =
  | { ok: true; status: WaitlistStatus; bookingId: string | null; replayed: boolean }
  | { ok: false; code: WaitlistCode }

/** One of the signed-in student's own waitlist entries, with the class it belongs to. */
export interface MyWaitlistEntry {
  entryId: string
  session: Session
  classTypeName: string
  instructorName: string | null
  status: WaitlistStatus
  skipReason: WaitlistSkipReason | null
  /** 1-based place in the queue while waiting; null once resolved. */
  position: number | null
  /** The booking she got when promoted. */
  bookingId: string | null
  createdAt: IsoDateTime
  resolvedAt: IsoDateTime | null
}

export interface BookingRepository {
  getStudioRules(): Promise<StudioRules>
  listClassTypes(): Promise<ClassTypeView[]>
  listSessions(range: InstantRange): Promise<SessionAvailability[]>
  getSession(id: string): Promise<SessionAvailability | null>
  /** Null when the caller may not see them (signed out, not booked, cancelled booking). */
  getSessionPrivateDetails(sessionId: string): Promise<SessionPrivateDetails | null>
  /** Signed-in user's bookings (any status). Throws RepositoryError("unauthenticated") when signed out. */
  listMyBookings(): Promise<MyBooking[]>
  /** Throws RepositoryError("unauthenticated") when signed out. */
  getMyCreditBalance(): Promise<CreditBalance>
  /** Business refusals come back as data; never throws for expected failures. */
  book(cmd: BookCommand): Promise<BookResult>
  cancel(cmd: CancelCommand): Promise<CancelResult>
  /** Throws RepositoryError("unauthenticated") when signed out. */
  getMyProfile(): Promise<MyProfile>
  /** Expects an already validated name (see `validateDisplayName`); refusals come back as data. */
  updateMyDisplayName(displayName: string): Promise<UpdateProfileResult>
  /** Phase 4.4. Business refusals come back as data. */
  joinWaitlist(cmd: JoinWaitlistCommand): Promise<JoinWaitlistResult>
  leaveWaitlist(sessionId: string): Promise<LeaveWaitlistResult>
  /** Her own entries, newest first. Throws RepositoryError("unauthenticated") when signed out. */
  listMyWaitlist(): Promise<MyWaitlistEntry[]>
}

export interface AuthUser {
  id: string
  email: string
}

export type AuthCode = "invalid_email" | "invalid_code" | "code_expired" | "rate_limited" | "network_error" | "unknown"

export type RequestCodeResult =
  /** `demoCode` is set only by the mock adapter, which shows it on screen (ARCHITECTURE §10). */
  | { ok: true; demoCode?: string }
  | { ok: false; code: AuthCode }

export type VerifyCodeResult = { ok: true; user: AuthUser } | { ok: false; code: AuthCode }

export interface AuthPort {
  /** Current session's user, or null. UX only: RLS/RPC re-check every call. */
  getUser(): Promise<AuthUser | null>
  /** Called with the current user on subscribe and on every change. Returns unsubscribe. */
  onChange(listener: (user: AuthUser | null) => void): () => void
  requestCode(email: string): Promise<RequestCodeResult>
  verifyCode(email: string, code: string): Promise<VerifyCodeResult>
  signOut(): Promise<void>
}

/* ---------- Admin (Phase 4.1, AD-01 / AD-06 / AD-07) ---------- */

/** `profiles.role` of the signed-in user. UX only: every admin call is re-checked server-side. */
export type StaffRole = "staff" | "student"

/** One session as staff see it: every status, published or not. */
export interface AdminSessionView {
  session: Session
  classTypeName: string
  instructorName: string | null
  isPublished: boolean
  confirmedCount: number
}

/** One booking row of a session roster. Names are user-provided text: render as plain text only. */
export interface RosterEntry {
  bookingId: string
  userId: string
  /** `profiles.display_name`; null/blank when the student has not set one. */
  displayName: string | null
  /** Confirmed address only (null until confirmed); staff fallback when there is no name. */
  email: string | null
  status: Booking["status"]
  attendance: Booking["attendance"]
  bookedAt: IsoDateTime
}

export type AttendanceMark = "attended" | "no_show" | "unknown"

export interface MarkAttendanceCommand {
  bookingId: string
  attendance: AttendanceMark
}

/** RPC codes of `mark_attendance` (DATA_MODEL §13) plus transport failures. */
export type AttendanceCode = "attendance_window_closed" | "not_found" | TransportCode

export type MarkAttendanceResult =
  | { ok: true; bookingId: string; attendance: AttendanceMark }
  | { ok: false; code: AttendanceCode }

/* ---------- Admin (Phase 4.2, AD-02 … AD-05) ---------- */

/** A class type as staff see it: drafts and archived ones included. Text is user-provided: plain text only. */
export interface AdminClassTypeView {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  defaultCapacity: number
  defaultModality: Modality
  /** False = archived (or draft): hidden from students and unbookable; its history is kept. */
  isPublished: boolean
  sortOrder: number
}

export interface SaveClassTypeCommand {
  /** Generated once per form (new) or the existing id (edit); a retry updates instead of duplicating. */
  id: string
  name: string
  description: string | null
  durationMinutes: number
  defaultCapacity: number
  defaultModality: Modality
  isPublished: boolean
}

/** `admin_upsert_class_type` has no business refusals: bad input is `invalid_input` (SQLSTATE 22023). */
export type SaveClassTypeResult =
  | { ok: true; classTypeId: string; created: boolean; isPublished: boolean; upcomingSessions: number }
  | { ok: false; code: TransportCode }

/** One `create_session` call: N weekly occurrences built in the studio's wall time, all or nothing. */
export interface CreateSessionsCommand {
  /** Generated once per form and reused on retries: the server replays instead of duplicating. */
  requestKey: string
  classTypeId: string
  /** Studio-local "YYYY-MM-DD" and "HH:mm" of the first occurrence. */
  localDate: string
  localStart: string
  durationMinutes: number
  capacity: number
  modality: Modality
  /** Public label (e.g. a neighborhood). */
  locationLabel: string | null
  /** Attendee-only (private details). */
  address: string | null
  meetingUrl: string | null
  instructorName: string | null
  /** 1 = single session; up to MAX_REPEAT_WEEKS. */
  repeatWeeks: number
}

export type CreateSessionsCode = "not_found" | TransportCode

export type CreateSessionsResult =
  | { ok: true; sessionIds: string[]; replayed: boolean }
  | { ok: false; code: CreateSessionsCode }

export interface UpdateSessionCapacityCommand {
  sessionId: string
  capacity: number
}

/** Business refusals of `admin_update_session` (application/RPC codes, ARCHITECTURE §5). */
export const UPDATE_SESSION_CODES = ["capacity_below_bookings", "session_cancelled", "session_started", "not_found"] as const
export type UpdateSessionCode = (typeof UPDATE_SESSION_CODES)[number] | TransportCode

export type UpdateSessionResult =
  /** `promoted`: students moved from the waitlist into the new spots (Phase 4.4); `confirmedCount` counts them. */
  | { ok: true; sessionId: string; capacity: number; confirmedCount: number; changed: boolean; promoted: number }
  | { ok: false; code: UpdateSessionCode; confirmedCount?: number }

export interface CancelSessionCommand {
  sessionId: string
}

export type CancelSessionCode = "not_found" | TransportCode

export type CancelSessionResult =
  | {
      ok: true
      sessionId: string
      /** Confirmed bookings cancelled by this call (0 on a replay). */
      cancelledBookings: number
      /** Bookings whose credit went back to the pack. */
      refunded: number
      /** Bookings whose pack had already expired: staff grants those credits by hand. */
      refundsSkipped: string[]
      replayed: boolean
    }
  | { ok: false; code: CancelSessionCode }

/* ---------- Admin (Phase 4.3, AD-08 … AD-10) ---------- */

export interface StudentNextBooking {
  bookingId: string
  sessionId: string
  startsAt: IsoDateTime
  classTypeName: string
}

/**
 * One student as the panel lists her. `balance` is computed by the server with the same definition
 * book_session uses (`private.usable_balance`), never summed in the browser. Text is user-provided.
 */
export interface StudentSummary {
  userId: string
  displayName: string | null
  /** Confirmed address only (null until confirmed). */
  email: string | null
  balance: number
  /** Earliest expiry among packs that still have classes; null when none. */
  nextExpiry: IsoDateTime | null
  nextBooking: StudentNextBooking | null
  /** Set once her personal data was erased (ADR-020): name, phone and email are null from then on. */
  anonymizedAt: IsoDateTime | null
}

/** One pack (credit grant) as staff see it. `note` is visible to the student too. */
export interface AdminGrantView {
  id: string
  total: number
  remaining: number
  validFrom: IsoDateTime
  /** Exclusive: the pack is no longer valid at this instant. */
  expiresAt: IsoDateTime
  note: string | null
  createdAt: IsoDateTime
}

/** Who wrote a ledger entry: the studio (staff), the student herself, or a system job. */
export type LedgerActor = "staff" | "student" | "system"

/** Append-only ledger row (newest first in the UI). `note` is user-provided text, visible to the student. */
export interface AdminLedgerEntry {
  id: string
  grantId: string
  bookingId: string | null
  reason: CreditLedgerReason
  delta: number
  note: string | null
  actor: LedgerActor
  createdAt: IsoDateTime
}

export type BookingSource = "student" | "waitlist" | "staff"

/** One booking of a student, with the session it belongs to. */
export interface StudentBookingView {
  bookingId: string
  sessionId: string
  startsAt: IsoDateTime
  endsAt: IsoDateTime
  classTypeName: string
  sessionStatus: Session["status"]
  status: Booking["status"]
  attendance: Booking["attendance"]
  refunded: boolean
  source: BookingSource
  bookedAt: IsoDateTime
}

/** `grant_credits`: the pack is valid from today through local day `today + validDays − 1`. */
export interface GrantCreditsCommand {
  userId: string
  credits: number
  validDays: number
  note: string | null
  /** Generated once per form and reused on retries: the server replays instead of granting twice. */
  requestKey: string
}

export type GrantCreditsCode = "not_found" | TransportCode

export type GrantCreditsResult =
  | { ok: true; grantId: string; credits: number; expiresAt: IsoDateTime; replayed: boolean }
  | { ok: false; code: GrantCreditsCode }

/** `admin_adjust_credits`: ± credits on one pack, with a mandatory reason (stored as the ledger note). */
export interface AdjustCreditsCommand {
  grantId: string
  delta: number
  reason: string
  requestKey: string
}

/** Business refusals of `admin_adjust_credits` (application/RPC codes). */
export const ADJUST_CREDITS_CODES = ["insufficient_balance", "adjust_exceeds_pack", "grant_expired", "not_found"] as const
export type AdjustCreditsCode = (typeof ADJUST_CREDITS_CODES)[number] | TransportCode

export type AdjustCreditsResult =
  | { ok: true; grantId: string; delta: number; creditsRemaining: number; balance: number; replayed: boolean }
  | { ok: false; code: AdjustCreditsCode; creditsRemaining?: number }

/** One waitlist entry of a session as staff see it (plain RLS read, ADR-015). Names are user-provided text. */
export interface WaitlistRosterEntry {
  entryId: string
  userId: string
  displayName: string | null
  email: string | null
  status: WaitlistStatus
  skipReason: WaitlistSkipReason | null
  /** Join order is FIFO order (ties: entry id); the application derives each place from it. */
  joinedAt: IsoDateTime
  resolvedAt: IsoDateTime | null
}

/** `admin_book_for`: staff books a student; bypasses the booking window, never capacity. */
export interface BookForStudentCommand {
  userId: string
  sessionId: string
  requestKey: string
}

export const BOOK_FOR_STUDENT_CODES = [
  "session_cancelled",
  "session_started",
  "already_booked",
  "session_full",
  "no_valid_credit",
  "not_found",
] as const
export type BookForStudentCode = (typeof BOOK_FOR_STUDENT_CODES)[number] | TransportCode

export type BookForStudentResult =
  | { ok: true; bookingId: string; replayed: boolean; remainingCredits: number | null }
  | { ok: false; code: BookForStudentCode }

/** `admin_cancel_for`: staff cancels a student's booking at any time; refunds unless `refund` is false. */
export interface CancelForStudentCommand {
  bookingId: string
  refund: boolean
}

export const CANCEL_FOR_STUDENT_CODES = ["cancellation_not_allowed", "not_found"] as const
export type CancelForStudentCode = (typeof CANCEL_FOR_STUDENT_CODES)[number] | TransportCode

export type CancelForStudentResult =
  | {
      ok: true
      bookingId: string
      refunded: boolean
      /** The pack had already expired: nothing went back (staff grants it by hand). */
      refundSkipped: boolean
      replayed: boolean
      /** Students moved from the waitlist into the freed spot (Phase 4.4). */
      promoted: number
    }
  | { ok: false; code: CancelForStudentCode }

/** `admin_anonymize_student` (ADR-020): erase a student's personal data, keeping her history. */
export interface AnonymizeStudentCommand {
  userId: string
  /** Typo guard: must equal her current email (case-insensitive); the server re-checks. */
  confirmEmail: string
}

/** Business refusals of `admin_anonymize_student` (application/RPC codes). */
export const ANONYMIZE_STUDENT_CODES = ["email_mismatch", "has_upcoming_bookings", "not_found"] as const
export type AnonymizeStudentCode = (typeof ANONYMIZE_STUDENT_CODES)[number] | TransportCode

export type AnonymizeStudentResult =
  | { ok: true; userId: string; anonymizedAt: IsoDateTime; replayed: boolean }
  | { ok: false; code: AnonymizeStudentCode; upcoming?: number }

/**
 * Staff read/write side. Reads throw RepositoryError (`unauthenticated`, `forbidden`, …);
 * writes return business refusals as data. The database is the only authority (ADR-005).
 */
export interface AdminRepository {
  /** Role of the signed-in user; null when signed out. Reads only the caller's own profile. */
  getMyRole(): Promise<StaffRole | null>
  /** Sessions starting in `[from, to)`, any status, ordered by start. */
  listSessions(range: InstantRange): Promise<AdminSessionView[]>
  getSession(id: string): Promise<AdminSessionView | null>
  /** Every booking of the session (any status), oldest first. */
  getRoster(sessionId: string): Promise<RosterEntry[]>
  /** Every waitlist entry of the session (any status), in join order (Phase 4.4). */
  getWaitlist(sessionId: string): Promise<WaitlistRosterEntry[]>
  markAttendance(cmd: MarkAttendanceCommand): Promise<MarkAttendanceResult>
  /** Every class type (published, draft, archived), by sort order then name. */
  listClassTypes(): Promise<AdminClassTypeView[]>
  saveClassType(cmd: SaveClassTypeCommand): Promise<SaveClassTypeResult>
  createSessions(cmd: CreateSessionsCommand): Promise<CreateSessionsResult>
  updateSessionCapacity(cmd: UpdateSessionCapacityCommand): Promise<UpdateSessionResult>
  /** Cancels the session and every confirmed booking with a refund, regardless of the window. */
  cancelSession(cmd: CancelSessionCommand): Promise<CancelSessionResult>
  /** Students whose name or email contains `query` (blank = everyone), alphabetical. */
  searchStudents(query: string): Promise<StudentSummary[]>
  /** Null for unknown ids and non-student profiles. */
  getStudent(userId: string): Promise<StudentSummary | null>
  /** Every pack of the student (any state). */
  listStudentGrants(userId: string): Promise<AdminGrantView[]>
  /** Every booking of the student (any status). */
  listStudentBookings(userId: string): Promise<StudentBookingView[]>
  /** The student's ledger, newest first. */
  listStudentLedger(userId: string): Promise<AdminLedgerEntry[]>
  grantCredits(cmd: GrantCreditsCommand): Promise<GrantCreditsResult>
  adjustCredits(cmd: AdjustCreditsCommand): Promise<AdjustCreditsResult>
  bookForStudent(cmd: BookForStudentCommand): Promise<BookForStudentResult>
  cancelForStudent(cmd: CancelForStudentCommand): Promise<CancelForStudentResult>
  /** Idempotent: an already anonymized student → ok with `replayed: true`. */
  anonymizeStudent(cmd: AnonymizeStudentCommand): Promise<AnonymizeStudentResult>
}
