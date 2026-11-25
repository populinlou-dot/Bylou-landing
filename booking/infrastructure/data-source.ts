/**
 * Adapter selection (ADR-013): the data source is EXPLICIT. Missing or invalid values
 * produce a config-error runtime; there is never a silent fallback to mock data.
 */
import type { AdminRepository, BookingRuntime, Clock } from "../application"
import type { StudioRules } from "../domain"
import { MockAdminRepository, MockAuth, MockBookingRepository } from "./mock"
import {
  SupabaseAdminRepository,
  SupabaseAuth,
  SupabaseBookingRepository,
  createSupabaseClientProvider,
  resolveCaptchaConfig,
  resolveSupabaseConfig,
  type CaptchaConfig,
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
  /** Brand flag `features.waitlist`; the mock adapter uses it as its `studio_settings.waitlist_enabled`. */
  waitlist?: boolean
  clock?: Clock
  mockLatencyMs?: number
  /**
   * Raw NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (required for "supabase") and the
   * optional NEXT_PUBLIC_TURNSTILE_SITE_KEY (Supabase Auth captcha, ADR-024; ignored by "mock").
   */
  supabase?: { url?: string | null; anonKey?: string | null; turnstileSiteKey?: string | null }
}

/**
 * Every adapter a composition root needs. `admin` is non-null exactly when the runtime is
 * ready, and shares the runtime's auth/session (and, for mock, its in-memory studio).
 */
export interface BookingAdapters {
  runtime: BookingRuntime
  admin: AdminRepository | null
  /** Sign-in bot protection; null when off, always null for the mock data source (ADR-024). */
  captcha: CaptchaConfig | null
}

export function createBookingRuntime(rawDataSource: string | null | undefined, options: CreateRuntimeOptions): BookingRuntime {
  return createBookingAdapters(rawDataSource, options).runtime
}

export function createBookingAdapters(rawDataSource: string | null | undefined, options: CreateRuntimeOptions): BookingAdapters {
  const resolution = resolveDataSource(rawDataSource)
  if (!resolution.ok) {
    return {
      admin: null,
      captcha: null,
      runtime: {
        status: "config_error",
        reason: resolution.reason,
        variable: "NEXT_PUBLIC_BOOKING_DATA_SOURCE",
        received: resolution.received,
      },
    }
  }
  const clock = options.clock ?? systemClock
  if (resolution.source === "supabase") {
    // Missing/invalid Supabase vars are a config error, never a fallback to mock (ADR-013).
    const config = resolveSupabaseConfig(options.supabase?.url, options.supabase?.anonKey)
    if (!config.ok) {
      return {
        admin: null,
        captcha: null,
        runtime: { status: "config_error", reason: config.reason, variable: config.variable, received: config.received },
      }
    }
    const captcha = resolveCaptchaConfig(options.supabase?.turnstileSiteKey)
    if (!captcha.ok) {
      return {
        admin: null,
        captcha: null,
        runtime: { status: "config_error", reason: captcha.reason, variable: captcha.variable, received: captcha.received },
      }
    }
    const client = createSupabaseClientProvider(config.config)
    return {
      admin: new SupabaseAdminRepository(client),
      captcha: captcha.captcha,
      runtime: {
        status: "ready",
        isDemo: false,
        clock,
        repository: new SupabaseBookingRepository(client, clock),
        auth: new SupabaseAuth(client),
      },
    }
  }
  const auth = new MockAuth({ latencyMs: options.mockLatencyMs })
  const currentUserId = () => auth.currentUserId()
  const repository = new MockBookingRepository({
    clock,
    rules: options.rules,
    latencyMs: options.mockLatencyMs,
    currentUserId,
    waitlistEnabled: options.waitlist ?? false,
  })
  return {
    // The demo sends no email, so it needs no bot protection: the site key is ignored (ADR-024).
    captcha: null,
    admin: new MockAdminRepository({ clock, store: repository, latencyMs: options.mockLatencyMs, currentUserId }),
    runtime: { status: "ready", isDemo: true, clock, auth, repository },
  }
}
