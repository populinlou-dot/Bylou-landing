/**
 * Adapter selection (ADR-013): the data source is EXPLICIT. Missing or invalid values
 * produce a config-error runtime; there is never a silent fallback to mock data.
 */
import type { BookingRuntime, Clock } from "../application"
import type { StudioRules } from "../domain"
import { MockBookingRepository } from "./mock"

export const BOOKING_DATA_SOURCES = ["mock", "supabase"] as const
export type BookingDataSource = (typeof BOOKING_DATA_SOURCES)[number]

export type DataSourceResolution =
  | { ok: true; source: BookingDataSource }
  | { ok: false; reason: "missing" | "invalid"; received: string | null }

/** Exact lowercase match after trimming; anything else is invalid, empty is missing. */
export function resolveDataSource(raw: string | null | undefined): DataSourceResolution {
  const value = raw?.trim() ?? ""
  if (value === "") return { ok: false, reason: "missing", received: null }
  if ((BOOKING_DATA_SOURCES as readonly string[]).includes(value)) {
    return { ok: true, source: value as BookingDataSource }
  }
  return { ok: false, reason: "invalid", received: value }
}

export const systemClock: Clock = { now: () => new Date() }

export interface CreateRuntimeOptions {
  /** Brand rule defaults; they seed the mock adapter (ADR-014). */
  rules: StudioRules
  clock?: Clock
  mockLatencyMs?: number
}

export function createBookingRuntime(rawDataSource: string | null | undefined, options: CreateRuntimeOptions): BookingRuntime {
  const resolution = resolveDataSource(rawDataSource)
  if (!resolution.ok) {
    return {
      status: "config_error",
      reason: resolution.reason,
      variable: "NEXT_PUBLIC_BOOKING_DATA_SOURCE",
      received: resolution.received,
    }
  }
  if (resolution.source === "supabase") {
    // Supabase adapters arrive in Phase 3; until then this is an honest "not available yet".
    return { status: "unavailable", source: "supabase" }
  }
  const clock = options.clock ?? systemClock
  return {
    status: "ready",
    isDemo: true,
    clock,
    repository: new MockBookingRepository({ clock, rules: options.rules, latencyMs: options.mockLatencyMs }),
  }
}
