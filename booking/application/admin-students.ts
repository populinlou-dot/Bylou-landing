/**
 * Admin use cases for Phase 4.3 (AD-08 … AD-10): find a student, see her balance, packs, bookings and
 * ledger; grant a pack, adjust credits, book or cancel on her behalf. Validation here is UX (inline
 * field errors before a round trip); the RPCs re-check everything and are the only authority (ADR-005).
 * Writes are never optimistic and carry a request key that the caller keeps across retries.
 */
import { toEpochMs, type IsoDateTime } from "../domain"
import { isValidLocalDate, toAdminDayEntry, type AdminDayEntry, type AdminDeps } from "./admin"
import type { FieldErrors } from "./admin-sessions"
import { isValidIdempotencyKey } from "./booking-actions"
import { isValidSessionId } from "./get-agenda"
import {
  RepositoryError,
  type AdjustCreditsResult,
  type AdminGrantView,
  type AdminLedgerEntry,
  type BookForStudentCommand,
  type BookForStudentResult,
  type CancelForStudentCommand,
  type CancelForStudentResult,
  type GrantCreditsResult,
  type StudentBookingView,
  type StudentSummary,
  type TransportCode,
} from "./ports"
import { addDays, localDateOf, type LocalDate } from "./time-zone"

/* ---------- Limits (mirror the CHECK constraints and RPC guards) ---------- */

export const STUDENT_QUERY_MAX = 100
export const PACK_CREDITS_RANGE = { min: 1, max: 100 } as const
export const PACK_VALID_DAYS_MAX = 365
/** Suggested pack length in the grant form (a "30-day pack"). */
export const DEFAULT_PACK_DAYS = 30
export const NOTE_MAX = 200
export const ADJUST_AMOUNT_RANGE = { min: 1, max: 100 } as const
/** How far ahead "book on behalf" lists sessions (staff bypass the 30-day booking window). */
export const BOOK_FOR_DAYS_AHEAD = 60

const DAY_MS = 24 * 60 * 60_000

function failureCode(error: unknown): TransportCode {
  return error instanceof RepositoryError ? error.code : "unknown"
}

const isIntegerIn = (value: number, range: { min: number; max: number }) =>
  Number.isInteger(value) && value >= range.min && value <= range.max

/* ---------- Search (AD-09) ---------- */

/** Trimmed, single-spaced, capped query; "" lists everyone. */
export function normalizeStudentQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, STUDENT_QUERY_MAX)
}

/** Throws RepositoryError on transport failures (the container shows retry). */
export async function searchStudents(deps: Pick<AdminDeps, "admin">, query: string | null | undefined): Promise<StudentSummary[]> {
  return deps.admin.searchStudents(normalizeStudentQuery(query))
}

/* ---------- Detail (AD-09, AD-08.3) ---------- */

export interface StudentDetail {
  timezone: string
  now: IsoDateTime
  today: LocalDate
  student: StudentSummary
  /** Packs valid right now (credits left or not), earliest expiry first. */
  activeGrants: AdminGrantView[]
  /** Confirmed bookings of sessions that have not ended, soonest first. */
  upcoming: StudentBookingView[]
  /** Everything else, most recent first. */
  history: StudentBookingView[]
  /** Append-only ledger, newest first. */
  ledger: AdminLedgerEntry[]
}

export function isActiveGrant(grant: AdminGrantView, now: Date): boolean {
  const nowMs = now.getTime()
  return toEpochMs(grant.validFrom) <= nowMs && nowMs < toEpochMs(grant.expiresAt)
}

export function isUpcomingBooking(booking: StudentBookingView, now: Date): boolean {
  return booking.status === "confirmed" && booking.sessionStatus === "scheduled" && now.getTime() < toEpochMs(booking.endsAt)
}

/** Newest first; ties by id (bigint ids from the server, string-compared by length then value). */
export function sortLedger(entries: readonly AdminLedgerEntry[]): AdminLedgerEntry[] {
  const byId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
  return [...entries].sort((a, b) => toEpochMs(b.createdAt) - toEpochMs(a.createdAt) || byId(b.id, a.id))
}

/** Profile, server balance, packs, bookings and ledger for `/admin/alumna/?id=`. Null for invalid/unknown ids. */
export async function getStudentDetail(deps: AdminDeps, query: { id: string | null }): Promise<StudentDetail | null> {
  if (!isValidSessionId(query.id)) return null
  const id = query.id
  const [rules, student] = await Promise.all([deps.repository.getStudioRules(), deps.admin.getStudent(id)])
  if (!student) return null
  const [grants, bookings, ledger] = await Promise.all([
    deps.admin.listStudentGrants(id),
    deps.admin.listStudentBookings(id),
    deps.admin.listStudentLedger(id),
  ])
  const now = deps.clock.now()
  const byStart = (a: StudentBookingView, b: StudentBookingView) =>
    toEpochMs(a.startsAt) - toEpochMs(b.startsAt) || (a.bookingId < b.bookingId ? -1 : 1)
  const upcoming = bookings.filter((b) => isUpcomingBooking(b, now)).sort(byStart)
  const history = bookings.filter((b) => !isUpcomingBooking(b, now)).sort((a, b) => byStart(b, a))
  return {
    timezone: rules.timezone,
    now: now.toISOString(),
    today: localDateOf(now, rules.timezone),
    student,
    activeGrants: grants
      .filter((g) => isActiveGrant(g, now))
      .sort((a, b) => toEpochMs(a.expiresAt) - toEpochMs(b.expiresAt) || (a.id < b.id ? -1 : 1)),
    upcoming,
    history,
    ledger: sortLedger(ledger),
  }
}

/** Last studio-local day a pack can be used: its exclusive `expiresAt` minus one millisecond. */
export function lastValidDay(expiresAt: IsoDateTime, timezone: string): LocalDate {
  return localDateOf(new Date(toEpochMs(expiresAt) - 1), timezone)
}

/* ---------- Grant a pack (AD-08) ---------- */

export type GrantField = "credits" | "expiresOn" | "note"

export interface GrantDraft {
  credits: number
  /** Last studio-local day the pack is valid, "YYYY-MM-DD" (inclusive). */
  expiresOn: string
  note: string
}

function daysBetween(from: LocalDate, to: LocalDate): number {
  const toUtc = (d: LocalDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

/**
 * `grant_credits` takes a length in days: valid from today through local day today + days − 1.
 * So "valid through `expiresOn`" = days between today and that day, plus one.
 */
export function packValidDays(today: LocalDate, expiresOn: LocalDate): number {
  return daysBetween(today, expiresOn) + 1
}

export function defaultPackExpiry(today: LocalDate): LocalDate {
  return addDays(today, DEFAULT_PACK_DAYS - 1)
}

export function validateGrantDraft(draft: GrantDraft, context: { today: LocalDate }): FieldErrors<GrantField> {
  const errors: FieldErrors<GrantField> = {}
  if (!isIntegerIn(draft.credits, PACK_CREDITS_RANGE)) errors.credits = "out_of_range"
  if (!draft.expiresOn) errors.expiresOn = "required"
  else if (!isValidLocalDate(draft.expiresOn)) errors.expiresOn = "invalid"
  else if (draft.expiresOn < context.today) errors.expiresOn = "in_past"
  else if (packValidDays(context.today, draft.expiresOn) > PACK_VALID_DAYS_MAX) errors.expiresOn = "out_of_range"
  if (draft.note.trim().length > NOTE_MAX) errors.note = "too_long"
  return errors
}

const hasErrors = (errors: object) => Object.keys(errors).length > 0

/** One `grant_credits` call. Same request key on retry → the server returns the original pack. */
export async function grantPack(
  deps: Pick<AdminDeps, "admin" | "clock">,
  cmd: { userId: string; draft: GrantDraft; requestKey: string },
  context: { timezone: string },
): Promise<GrantCreditsResult> {
  const today = localDateOf(deps.clock.now(), context.timezone)
  if (!isValidSessionId(cmd.userId) || !isValidIdempotencyKey(cmd.requestKey)) return { ok: false, code: "invalid_input" }
  if (hasErrors(validateGrantDraft(cmd.draft, { today }))) return { ok: false, code: "invalid_input" }
  const note = cmd.draft.note.trim()
  try {
    return await deps.admin.grantCredits({
      userId: cmd.userId,
      credits: cmd.draft.credits,
      validDays: packValidDays(today, cmd.draft.expiresOn),
      note: note === "" ? null : note,
      requestKey: cmd.requestKey,
    })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/* ---------- Adjust credits (AD-08.2) ---------- */

export type AdjustField = "grantId" | "amount" | "reason"
export type AdjustDirection = "add" | "remove"

export interface AdjustDraft {
  grantId: string
  direction: AdjustDirection
  amount: number
  reason: string
}

/**
 * Field errors for an adjustment. The pack keeps 0 ≤ remaining ≤ size, so the UI bounds the amount
 * the same way the RPC does (the server still re-checks under a row lock).
 */
export function validateAdjustDraft(draft: AdjustDraft, grant: Pick<AdminGrantView, "remaining" | "total"> | null): FieldErrors<AdjustField> {
  const errors: FieldErrors<AdjustField> = {}
  if (!grant || !isValidSessionId(draft.grantId)) errors.grantId = "required"
  if (!isIntegerIn(draft.amount, ADJUST_AMOUNT_RANGE)) errors.amount = "out_of_range"
  else if (grant && adjustAmountMax(draft.direction, grant) < draft.amount) errors.amount = "out_of_range"
  const reason = draft.reason.trim()
  if (!reason) errors.reason = "required"
  else if (reason.length > NOTE_MAX) errors.reason = "too_long"
  return errors
}

/** Largest amount the pack allows in that direction (0 = nothing to adjust). */
export function adjustAmountMax(direction: AdjustDirection, grant: Pick<AdminGrantView, "remaining" | "total">): number {
  return direction === "remove" ? grant.remaining : grant.total - grant.remaining
}

export async function adjustCredits(
  deps: Pick<AdminDeps, "admin">,
  cmd: { draft: AdjustDraft; grant: Pick<AdminGrantView, "remaining" | "total"> | null; requestKey: string },
): Promise<AdjustCreditsResult> {
  if (!isValidIdempotencyKey(cmd.requestKey) || hasErrors(validateAdjustDraft(cmd.draft, cmd.grant))) {
    return { ok: false, code: "invalid_input" }
  }
  const sign = cmd.draft.direction === "remove" ? -1 : 1
  try {
    return await deps.admin.adjustCredits({
      grantId: cmd.draft.grantId,
      delta: sign * cmd.draft.amount,
      reason: cmd.draft.reason.trim(),
      requestKey: cmd.requestKey,
    })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/* ---------- Book / cancel on behalf (AD-10) ---------- */

export interface BookableSession extends AdminDayEntry {
  isFull: boolean
}

/** Scheduled sessions from now to BOOK_FOR_DAYS_AHEAD days, soonest first (full ones flagged). */
export async function listBookableSessions(deps: AdminDeps): Promise<{ timezone: string; sessions: BookableSession[] }> {
  const rules = await deps.repository.getStudioRules()
  const now = deps.clock.now()
  const views = await deps.admin.listSessions({
    from: now.toISOString(),
    to: new Date(now.getTime() + BOOK_FOR_DAYS_AHEAD * DAY_MS).toISOString(),
  })
  const sessions = views
    .map((view) => toAdminDayEntry(view, rules.timezone, now))
    .filter((entry) => entry.state === "upcoming")
    .sort((a, b) => toEpochMs(a.session.startsAt) - toEpochMs(b.session.startsAt) || (a.session.id < b.session.id ? -1 : 1))
    .map((entry) => ({ ...entry, isFull: entry.confirmedCount >= entry.session.capacity }))
  return { timezone: rules.timezone, sessions }
}

export async function bookForStudent(deps: Pick<AdminDeps, "admin">, cmd: BookForStudentCommand): Promise<BookForStudentResult> {
  if (!isValidSessionId(cmd.userId) || !isValidSessionId(cmd.sessionId) || !isValidIdempotencyKey(cmd.requestKey)) {
    return { ok: false, code: "invalid_input" }
  }
  try {
    return await deps.admin.bookForStudent({ userId: cmd.userId, sessionId: cmd.sessionId, requestKey: cmd.requestKey })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/** State-idempotent on the server: a second call returns `replayed: true` and refunds nothing. */
export async function cancelForStudent(deps: Pick<AdminDeps, "admin">, cmd: CancelForStudentCommand): Promise<CancelForStudentResult> {
  if (!isValidSessionId(cmd.bookingId) || typeof cmd.refund !== "boolean") return { ok: false, code: "invalid_input" }
  try {
    return await deps.admin.cancelForStudent({ bookingId: cmd.bookingId, refund: cmd.refund })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}
