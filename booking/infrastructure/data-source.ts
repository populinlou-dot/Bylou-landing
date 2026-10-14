/**
 * Adapter selection (ADR-013): the data source is EXPLICIT. Missing or invalid values
 * produce a config-error runtime; there is never a silent fallback to mock data.
 */
import type { BookingRuntime, Clock } from "../application"
import type { StudioRules } from "../domain"
import { MockAuth, MockBookingRepository } from "./mock"
import {
  SupabaseAuth,
  SupabaseBookingRepository,
  createSupabaseClientProvider,
  resolveSupabaseConfig,
} from "./supabase"

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
  /** Raw NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (required for "supabase"). */
  supabase?: { url?: string | null; anonKey?: string | null }
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
  const clock = options.clock ?? systemClock
  if (resolution.source === "supabase") {
    // Missing/invalid Supabase vars are a config error, never a fallback to mock (ADR-013).
    const config = resolveSupabaseConfig(options.supabase?.url, options.supabase?.anonKey)
    if (!config.ok) {
      return { status: "config_error", reason: config.reason, variable: config.variable, received: config.received }
    }
    const client = createSupabaseClientProvider(config.config)
    return {
      status: "ready",
      isDemo: false,
      clock,
      repository: new SupabaseBookingRepository(client, clock),
      auth: new SupabaseAuth(client),
    }
  }
  const auth = new MockAuth({ latencyMs: options.mockLatencyMs })
  return {
    status: "ready",
    isDemo: true,
    clock,
    auth,
    repository: new MockBookingRepository({
      clock,
      rules: options.rules,
      latencyMs: options.mockLatencyMs,
      currentUserId: () => auth.currentUserId(),
    }),
  }
}
