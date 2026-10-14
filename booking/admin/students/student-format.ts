/**
 * Display helpers for the student screens (Phase 4.3). Text only, never color alone; user-provided
 * names/notes are returned raw and rendered by React as plain text.
 */
import { lastValidDay, localDateOf, rosterLabel, type StudentBookingView, type StudentSummary } from "../../application"
import type { Translate } from "../../ui/booking-context"
import { formatDayHeading, formatDayMonth, formatTime } from "../../ui/format"

/** Name, else email, else the neutral "no name" label. */
export function studentName(student: Pick<StudentSummary, "displayName" | "email">, t: Translate): string {
  return rosterLabel(student) ?? t("admin.roster.noName")
}

export function balanceLabel(n: number, t: Translate): string {
  if (n <= 0) return t("admin.student.balance.none")
  return n === 1 ? t("admin.student.balance.one") : t("admin.student.balance.many", { n })
}

/** "Jueves 15 de octubre · 18:00" in the studio timezone. */
export function sessionWhen(startsAt: string, timezone: string, locale: string): string {
  return `${formatDayHeading(localDateOf(startsAt, timezone), locale)} · ${formatTime(startsAt, timezone, locale)}`
}

/** "11 de noviembre": the last day a pack can be used (its expiry is exclusive). */
export function packLastDay(expiresAt: string, timezone: string, locale: string): string {
  return formatDayMonth(lastValidDay(expiresAt, timezone), locale)
}

/** How a past or cancelled booking reads in the history list. */
export function bookingOutcome(booking: StudentBookingView, t: Translate): string {
  if (booking.sessionStatus === "cancelled") return t("reason.session_cancelled")
  if (booking.status === "cancelled") return t("admin.state.cancelled")
  if (booking.status === "late_cancelled") return t("admin.roster.lateCancelled")
  if (booking.attendance === "attended") return t("admin.attendance.attended")
  if (booking.attendance === "no_show") return t("admin.attendance.no_show")
  return t("admin.attendance.unknown")
}
