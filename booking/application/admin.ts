/**
 * Admin use cases (Phase 4.1: shell + "Hoy", AD-01 / AD-06 / AD-07).
 * The staff check here is UX only: every admin read is RLS-scoped and every admin write is an
 * RPC that starts with `private.assert_staff()` (ADR-005). Attendance is never optimistic.
 */
import { attendanceWindow, toEpochMs, type AttendanceWindow, type IsoDateTime } from "../domain"
import { isValidSessionId } from "./get-agenda"
import {
  RepositoryError,
  type AdminRepository,
  type AdminSessionView,
  type AttendanceMark,
  type BookingRepository,
  type Clock,
  type MarkAttendanceCommand,
  type MarkAttendanceResult,
  type RosterEntry,
} from "./ports"
import { addDays, localDateOf, zonedTimeToInstant, type LocalDate } from "./time-zone"

export interface AdminDeps {
  admin: AdminRepository
  /** Studio rules (timezone) come from the same source the student agenda uses. */
  repository: Pick<BookingRepository, "getStudioRules">
  clock: Clock
}

/* ---------- Staff guard ---------- */

export type StaffAccess = "signed_out" | "staff" | "forbidden"

/** Reads only the caller's own role. Throws RepositoryError on transport failures (retryable). */
export async function resolveStaffAccess(deps: Pick<AdminDeps, "admin">): Promise<StaffAccess> {
  try {
    const role = await deps.admin.getMyRole()
    if (role === null) return "signed_out"
    return role === "staff" ? "staff" : "forbidden"
  } catch (error) {
    if (error instanceof RepositoryError && error.code === "unauthenticated") return "signed_out"
    if (error instanceof RepositoryError && error.code === "forbidden") return "forbidden"
    throw error
  }
}

/* ---------- "Hoy" (one studio-local day) ---------- */

/** upcoming → in_progress → finished; cancelled wins over time. */
export type AdminSessionState = "upcoming" | "in_progress" | "finished" | "cancelled"

export interface AdminDayEntry extends AdminSessionView {
  localDate: LocalDate
  durationMinutes: number
  state: AdminSessionState
  attendanceWindow: AttendanceWindow
}

export interface AdminDay {
  timezone: string
  now: IsoDateTime
  date: LocalDate
  today: LocalDate
  previous: LocalDate
  next: LocalDate
  isToday: boolean
  sessions: AdminDayEntry[]
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** "YYYY-MM-DD" naming a real calendar day (rejects 2026-02-30, junk from the URL, etc.). */
export function isValidLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (y < 2000 || y > 2100) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function toAdminDayEntry(view: AdminSessionView, timezone: string, now: Date): AdminDayEntry {
  const { session } = view
  const startMs = toEpochMs(session.startsAt)
  const endMs = toEpochMs(session.endsAt)
  const nowMs = now.getTime()
  const state: AdminSessionState =
    session.status === "cancelled" ? "cancelled" : nowMs < startMs ? "upcoming" : nowMs < endMs ? "in_progress" : "finished"
  return {
    ...view,
    localDate: localDateOf(session.startsAt, timezone),
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    state,
    attendanceWindow: attendanceWindow(session, now),
  }
}

/** Sessions of one studio-local day (default: today). Invalid `date` falls back to today. */
export async function getAdminDay(deps: AdminDeps, query: { date?: string | null } = {}): Promise<AdminDay> {
  const rules = await deps.repository.getStudioRules()
  const tz = rules.timezone
  const now = deps.clock.now()
  const today = localDateOf(now, tz)
  const date = isValidLocalDate(query.date) ? query.date : today
  const views = await deps.admin.listSessions({
    from: zonedTimeToInstant(date, "00:00", tz).toISOString(),
    to: zonedTimeToInstant(addDays(date, 1), "00:00", tz).toISOString(),
  })
  const sessions = views
    .map((view) => toAdminDayEntry(view, tz, now))
    // Defensive: an adapter must not leak sessions of other days into this one.
    .filter((entry) => entry.localDate === date)
    .sort((a, b) => toEpochMs(a.session.startsAt) - toEpochMs(b.session.startsAt) || (a.session.id < b.session.id ? -1 : 1))
  return {
    timezone: tz,
    now: now.toISOString(),
    date,
    today,
    previous: addDays(date, -1),
    next: addDays(date, 1),
    isToday: date === today,
    sessions,
  }
}

/* ---------- Roster ---------- */

export interface AdminSessionDetail {
  timezone: string
  now: IsoDateTime
  entry: AdminDayEntry
  /** Confirmed first (by name), then cancelled ones (most recent booking first). */
  roster: RosterEntry[]
}

/** Display label for a roster row: name, else email, else null (the UI shows a neutral label). */
export function rosterLabel(entry: Pick<RosterEntry, "displayName" | "email">): string | null {
  const name = entry.displayName?.trim()
  if (name) return name
  const email = entry.email?.trim()
  return email ? email : null
}

function compareRoster(a: RosterEntry, b: RosterEntry): number {
  const activeA = a.status === "confirmed" ? 0 : 1
  const activeB = b.status === "confirmed" ? 0 : 1
  if (activeA !== activeB) return activeA - activeB
  if (activeA === 0) {
    const byName = (rosterLabel(a) ?? "￿").localeCompare(rosterLabel(b) ?? "￿", "es")
    if (byName !== 0) return byName
  }
  return toEpochMs(b.bookedAt) - toEpochMs(a.bookedAt) || (a.bookingId < b.bookingId ? -1 : 1)
}

/** Session + roster for `/admin/clase/?id=`. Null for invalid or unknown ids. */
export async function getAdminSessionDetail(deps: AdminDeps, query: { id: string | null }): Promise<AdminSessionDetail | null> {
  if (!isValidSessionId(query.id)) return null
  const [rules, view] = await Promise.all([deps.repository.getStudioRules(), deps.admin.getSession(query.id)])
  if (!view) return null
  const roster = await deps.admin.getRoster(view.session.id)
  const now = deps.clock.now()
  return {
    timezone: rules.timezone,
    now: now.toISOString(),
    entry: toAdminDayEntry(view, rules.timezone, now),
    roster: [...roster].sort(compareRoster),
  }
}

/* ---------- Attendance (AD-07) ---------- */

const ATTENDANCE_MARKS: readonly AttendanceMark[] = ["attended", "no_show", "unknown"]

/** Server-confirmed only: the caller shows a pending state until this resolves. */
export async function markAttendance(deps: Pick<AdminDeps, "admin">, cmd: MarkAttendanceCommand): Promise<MarkAttendanceResult> {
  if (!isValidSessionId(cmd.bookingId) || !ATTENDANCE_MARKS.includes(cmd.attendance)) {
    return { ok: false, code: "invalid_input" }
  }
  try {
    return await deps.admin.markAttendance({ bookingId: cmd.bookingId, attendance: cmd.attendance })
  } catch (error) {
    return { ok: false, code: error instanceof RepositoryError ? error.code : "unknown" }
  }
}
