/**
 * Admin use cases for Phase 4.2 (AD-02 … AD-05): class types, single and weekly-recurring sessions,
 * capacity edit and session cancellation. Validation here is UX (inline field errors before a round
 * trip); the RPCs re-check everything and are the only authority (ADR-005, ADR-014).
 * Writes are never optimistic: callers show a pending state until the server answers.
 */
import { toEpochMs, type IsoDateTime, type Modality } from "../domain"
import { isValidLocalDate, type AdminDeps } from "./admin"
import { isValidIdempotencyKey } from "./booking-actions"
import { isValidSessionId } from "./get-agenda"
import {
  RepositoryError,
  type AdminClassTypeView,
  type CancelSessionCommand,
  type CancelSessionResult,
  type CreateSessionsCommand,
  type CreateSessionsResult,
  type SaveClassTypeCommand,
  type SaveClassTypeResult,
  type TransportCode,
  type UpdateSessionCapacityCommand,
  type UpdateSessionResult,
} from "./ports"
import { addDays, localDateOf, zonedTimeToInstant, type LocalDate } from "./time-zone"

/* ---------- Limits (mirror the CHECK constraints and RPC guards) ---------- */

export const CAPACITY_RANGE = { min: 1, max: 100 } as const
export const DURATION_RANGE = { min: 10, max: 480 } as const
export const MAX_REPEAT_WEEKS = 12
export const DEFAULT_REPEAT_WEEKS = 4
export const TEXT_LIMITS = {
  className: 80,
  description: 2000,
  locationLabel: 80,
  address: 300,
  meetingUrl: 500,
  instructorName: 80,
} as const

const MODALITIES: readonly Modality[] = ["in_person", "online"]
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Why a field is invalid; the UI maps each one to copy. */
export type FieldError = "required" | "too_long" | "out_of_range" | "invalid_url" | "in_past" | "invalid"
export type FieldErrors<F extends string> = Partial<Record<F, FieldError>>

const isIntegerIn = (value: number, range: { min: number; max: number }) =>
  Number.isInteger(value) && value >= range.min && value <= range.max

/** Trimmed text, or null when blank. */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

function failureCode(error: unknown): TransportCode {
  return error instanceof RepositoryError ? error.code : "unknown"
}

/* ---------- Class types (AD-02) ---------- */

export type ClassTypeField = "name" | "description" | "durationMinutes" | "defaultCapacity" | "defaultModality"

export function validateClassType(cmd: Omit<SaveClassTypeCommand, "id" | "isPublished">): FieldErrors<ClassTypeField> {
  const errors: FieldErrors<ClassTypeField> = {}
  const name = cleanText(cmd.name)
  if (!name) errors.name = "required"
  else if (name.length > TEXT_LIMITS.className) errors.name = "too_long"
  if ((cleanText(cmd.description)?.length ?? 0) > TEXT_LIMITS.description) errors.description = "too_long"
  if (!isIntegerIn(cmd.durationMinutes, DURATION_RANGE)) errors.durationMinutes = "out_of_range"
  if (!isIntegerIn(cmd.defaultCapacity, CAPACITY_RANGE)) errors.defaultCapacity = "out_of_range"
  if (!MODALITIES.includes(cmd.defaultModality)) errors.defaultModality = "invalid"
  return errors
}

const hasErrors = (errors: object) => Object.keys(errors).length > 0

/** Published first, then archived/drafts; each group by sort order, then name. */
export function sortClassTypes(types: readonly AdminClassTypeView[]): AdminClassTypeView[] {
  return [...types].sort(
    (a, b) =>
      Number(b.isPublished) - Number(a.isPublished) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "es") ||
      (a.id < b.id ? -1 : 1),
  )
}

/** Every class type for `/admin/practicas/`. Throws RepositoryError on transport failures. */
export async function listAdminClassTypes(deps: Pick<AdminDeps, "admin">): Promise<AdminClassTypeView[]> {
  return sortClassTypes(await deps.admin.listClassTypes())
}

export async function saveClassType(deps: Pick<AdminDeps, "admin">, cmd: SaveClassTypeCommand): Promise<SaveClassTypeResult> {
  if (!isValidSessionId(cmd.id) || hasErrors(validateClassType(cmd)) || typeof cmd.isPublished !== "boolean") {
    return { ok: false, code: "invalid_input" }
  }
  try {
    return await deps.admin.saveClassType({
      ...cmd,
      name: cleanText(cmd.name) ?? "",
      description: cleanText(cmd.description),
    })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/* ---------- New session form (AD-03 / AD-04) ---------- */

export interface NewSessionForm {
  timezone: string
  now: IsoDateTime
  today: LocalDate
  /** `?dia=` when valid and not in the past, else today. */
  defaultDate: LocalDate
  /** Only published class types: the server refuses sessions of archived ones. */
  classTypes: AdminClassTypeView[]
}

export async function getNewSessionForm(deps: AdminDeps, query: { date?: string | null } = {}): Promise<NewSessionForm> {
  const [rules, types] = await Promise.all([deps.repository.getStudioRules(), deps.admin.listClassTypes()])
  const now = deps.clock.now()
  const today = localDateOf(now, rules.timezone)
  const defaultDate = isValidLocalDate(query.date) && query.date >= today ? query.date : today
  return {
    timezone: rules.timezone,
    now: now.toISOString(),
    today,
    defaultDate,
    classTypes: sortClassTypes(types).filter((t) => t.isPublished),
  }
}

export interface SessionOccurrence {
  localDate: LocalDate
  startsAt: IsoDateTime
}

/**
 * The weekly occurrences `create_session` will insert: same wall-clock time on the same weekday,
 * computed in the studio timezone (not "+ 7 × 24 h", which drifts across a DST change).
 */
export function sessionOccurrences(localDate: LocalDate, localStart: string, repeatWeeks: number, timezone: string): SessionOccurrence[] {
  if (!isValidLocalDate(localDate) || !LOCAL_TIME.test(localStart) || !isIntegerIn(repeatWeeks, { min: 1, max: MAX_REPEAT_WEEKS })) {
    return []
  }
  return Array.from({ length: repeatWeeks }, (_, week) => {
    const date = addDays(localDate, 7 * week)
    return { localDate: date, startsAt: zonedTimeToInstant(date, localStart, timezone).toISOString() }
  })
}

export type SessionField =
  | "classTypeId"
  | "localDate"
  | "localStart"
  | "durationMinutes"
  | "capacity"
  | "modality"
  | "locationLabel"
  | "address"
  | "meetingUrl"
  | "instructorName"
  | "repeatWeeks"

export type SessionDraft = Omit<CreateSessionsCommand, "requestKey">

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname.length > 0 && value.startsWith("https://")
  } catch {
    return false
  }
}

function checkLength(errors: FieldErrors<SessionField>, field: SessionField, value: string | null, max: number) {
  if (value !== null && value.length > max) errors[field] = "too_long"
}

/**
 * Field errors for a new session. In person needs the address (shown only to booked students);
 * online needs an https meeting link. The first occurrence must start in the future.
 */
export function validateSessionDraft(draft: SessionDraft, context: { now: Date; timezone: string }): FieldErrors<SessionField> {
  const errors: FieldErrors<SessionField> = {}
  if (!isValidSessionId(draft.classTypeId)) errors.classTypeId = "required"
  if (!isValidLocalDate(draft.localDate)) errors.localDate = draft.localDate ? "invalid" : "required"
  if (!LOCAL_TIME.test(draft.localStart)) errors.localStart = draft.localStart ? "invalid" : "required"
  if (!isIntegerIn(draft.durationMinutes, DURATION_RANGE)) errors.durationMinutes = "out_of_range"
  if (!isIntegerIn(draft.capacity, CAPACITY_RANGE)) errors.capacity = "out_of_range"
  if (!isIntegerIn(draft.repeatWeeks, { min: 1, max: MAX_REPEAT_WEEKS })) errors.repeatWeeks = "out_of_range"
  if (!MODALITIES.includes(draft.modality)) errors.modality = "invalid"

  const address = cleanText(draft.address)
  const meetingUrl = cleanText(draft.meetingUrl)
  if (draft.modality === "in_person" && !address) errors.address = "required"
  if (draft.modality === "online") {
    if (!meetingUrl) errors.meetingUrl = "required"
    else if (meetingUrl.length > TEXT_LIMITS.meetingUrl) errors.meetingUrl = "too_long"
    else if (!isHttpsUrl(meetingUrl)) errors.meetingUrl = "invalid_url"
  }
  checkLength(errors, "address", address, TEXT_LIMITS.address)
  checkLength(errors, "locationLabel", cleanText(draft.locationLabel), TEXT_LIMITS.locationLabel)
  checkLength(errors, "instructorName", cleanText(draft.instructorName), TEXT_LIMITS.instructorName)

  if (!errors.localDate && !errors.localStart) {
    const start = zonedTimeToInstant(draft.localDate, draft.localStart, context.timezone)
    if (start.getTime() <= context.now.getTime()) errors.localStart = "in_past"
  }
  return errors
}

/** Only the fields the modality uses reach the server (no stale address on an online class). */
export function normalizeSessionDraft(draft: SessionDraft): SessionDraft {
  const online = draft.modality === "online"
  return {
    ...draft,
    locationLabel: online ? null : cleanText(draft.locationLabel),
    address: online ? null : cleanText(draft.address),
    meetingUrl: online ? cleanText(draft.meetingUrl) : null,
    instructorName: cleanText(draft.instructorName),
  }
}

/** One `create_session` call for 1…12 weekly occurrences (atomic; replays on the request key). */
export async function createSessions(
  deps: Pick<AdminDeps, "admin" | "clock">,
  cmd: CreateSessionsCommand,
  context: { timezone: string },
): Promise<CreateSessionsResult> {
  if (!isValidIdempotencyKey(cmd.requestKey)) return { ok: false, code: "invalid_input" }
  const errors = validateSessionDraft(cmd, { now: deps.clock.now(), timezone: context.timezone })
  if (hasErrors(errors)) return { ok: false, code: "invalid_input" }
  try {
    return await deps.admin.createSessions({ ...normalizeSessionDraft(cmd), requestKey: cmd.requestKey })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/* ---------- Capacity (AD-05.1) and cancellation (AD-05.2) ---------- */

/** Lowest capacity the UI offers: the confirmed bookings (the server refuses anything below). */
export function minimumCapacity(confirmedCount: number): number {
  return Math.max(CAPACITY_RANGE.min, confirmedCount)
}

export async function updateSessionCapacity(
  deps: Pick<AdminDeps, "admin">,
  cmd: UpdateSessionCapacityCommand,
): Promise<UpdateSessionResult> {
  if (!isValidSessionId(cmd.sessionId) || !isIntegerIn(cmd.capacity, CAPACITY_RANGE)) {
    return { ok: false, code: "invalid_input" }
  }
  try {
    return await deps.admin.updateSessionCapacity({ sessionId: cmd.sessionId, capacity: cmd.capacity })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/** State-idempotent on the server: a second call returns `replayed: true` and refunds nothing. */
export async function cancelSession(deps: Pick<AdminDeps, "admin">, cmd: CancelSessionCommand): Promise<CancelSessionResult> {
  if (!isValidSessionId(cmd.sessionId)) return { ok: false, code: "invalid_input" }
  try {
    return await deps.admin.cancelSession({ sessionId: cmd.sessionId })
  } catch (error) {
    return { ok: false, code: failureCode(error) }
  }
}

/** Whether staff may still change capacity (before start, not cancelled). Mirrors the RPC guard. */
export function canEditCapacity(session: { status: string; startsAt: IsoDateTime }, now: Date): boolean {
  return session.status !== "cancelled" && now.getTime() < toEpochMs(session.startsAt)
}
