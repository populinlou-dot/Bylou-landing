import type { IsoDateTime } from "./types"

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/** Parses a UTC ISO instant to epoch ms. Throws on invalid input instead of silently comparing NaN. */
export function toEpochMs(instant: IsoDateTime): number {
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) {
    throw new RangeError(`Invalid ISO instant: ${instant}`)
  }
  return ms
}
