import type { Session } from "./types"
import { DAY_MS, MINUTE_MS, toEpochMs } from "./time"

/** Attendance can be recorded from this many minutes before the start (early check-in). */
export const ATTENDANCE_OPENS_MINUTES_BEFORE = 15
/** …and stays editable for this many days after the session ends (PRD AD-07). */
export const ATTENDANCE_EDITABLE_DAYS = 7

/**
 * Whether staff may record attendance right now. Mirrors `mark_attendance`
 * (`starts_at - 15 min <= now() <= ends_at + 7 days`); the database stays the authority,
 * this preview only decides which controls the admin UI enables.
 */
export type AttendanceWindow = "not_yet" | "open" | "closed"

export function attendanceWindow(session: Pick<Session, "startsAt" | "endsAt">, now: Date): AttendanceWindow {
  const nowMs = now.getTime()
  if (nowMs < toEpochMs(session.startsAt) - ATTENDANCE_OPENS_MINUTES_BEFORE * MINUTE_MS) return "not_yet"
  if (nowMs > toEpochMs(session.endsAt) + ATTENDANCE_EDITABLE_DAYS * DAY_MS) return "closed"
  return "open"
}
