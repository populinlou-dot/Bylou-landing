/**
 * Display formatting. Times are always shown in the STUDIO timezone (ADR-011), 24 h.
 * Brand strings never live here: templates come from the copy catalog.
 */
import type { LocalDate } from "../application"

/** Replaces `{name}` placeholders; unknown placeholders are left visible on purpose. */
export function formatMessage(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

const cache = new Map<string, Intl.DateTimeFormat>()

function dtf(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    cache.set(key, formatter)
  }
  return formatter
}

/** "19:00" in the studio timezone. */
export function formatTime(instant: string, timeZone: string, locale: string): string {
  return dtf(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant))
}

/** A LocalDate rendered at noon UTC so no timezone can move it to another day. */
function localDateToDate(date: LocalDate): Date {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1)

/** "Martes 14 de octubre" (UX_DESIGN §3.1: long form, no comma after the weekday). */
export function formatDayHeading(date: LocalDate, locale: string): string {
  const text = dtf(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(localDateToDate(date))
  return capitalize(text.replace(/^([^\s,]+),\s*/u, "$1 "))
}

/** "14 de octubre". */
export function formatDayMonth(date: LocalDate, locale: string): string {
  return dtf(locale, { timeZone: "UTC", day: "numeric", month: "long" }).format(localDateToDate(date))
}

/** "14". */
export function formatDayNumber(date: LocalDate, locale: string): string {
  return dtf(locale, { timeZone: "UTC", day: "numeric" }).format(localDateToDate(date))
}

/** Pieces for "Semana del {from} al {to}": "13" / "19 de octubre", or full dates across months. */
export function formatWeekBounds(start: LocalDate, end: LocalDate, locale: string): { from: string; to: string } {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  return {
    from: sameMonth ? formatDayNumber(start, locale) : formatDayMonth(start, locale),
    to: formatDayMonth(end, locale),
  }
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ")
}
