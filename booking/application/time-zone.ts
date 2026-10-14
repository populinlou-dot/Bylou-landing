/**
 * Calendar math in the studio timezone using only `Intl` (no date library).
 * A `LocalDate` is a wall-calendar day in that timezone, "YYYY-MM-DD".
 */
import { DAY_MS } from "../domain/time"

export type LocalDate = string

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^(\d{2}):(\d{2})$/

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(epochMs: number, timeZone: string): WallClock {
  const values: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") values[part.type] = Number(part.value)
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant; e.g. -3 h for Buenos Aires. */
function offsetMs(epochMs: number, timeZone: string): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000
  const w = wallClock(wholeSecond, timeZone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - wholeSecond
}

function parseLocalDate(date: LocalDate): [number, number, number] {
  const match = LOCAL_DATE.exec(date)
  if (!match) throw new RangeError(`Invalid local date: ${date}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Calendar day of an instant in the studio timezone. */
export function localDateOf(instant: Date | string, timeZone: string): LocalDate {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime()
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant: ${String(instant)}`)
  const w = wallClock(ms, timeZone)
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = parseLocalDate(date)
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const [y, m, d] = parseLocalDate(date)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 ? 7 : day
}

/** Monday of the week containing `date` (weeks start on Monday, es-AR convention). */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date))
}

/** The UTC instant of a wall-clock time ("HH:mm") on a local date in `timeZone`. */
export function zonedTimeToInstant(date: LocalDate, time: string, timeZone: string): Date {
  const [y, m, d] = parseLocalDate(date)
  const match = TIME.exec(time)
  if (!match) throw new RangeError(`Invalid time: ${time}`)
  const asIfUtc = Date.UTC(y, m - 1, d, Number(match[1]), Number(match[2]))
  const firstGuess = asIfUtc - offsetMs(asIfUtc, timeZone)
  // Re-check once: the offset can differ across a DST change between guess and result.
  const corrected = asIfUtc - offsetMs(firstGuess, timeZone)
  return new Date(corrected)
}
