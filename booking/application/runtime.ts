import type { AuthPort, BookingRepository, Clock } from "./ports"

/** Environment variables the booking pages depend on (ADR-013). */
export type BookingConfigVariable =
  | "NEXT_PUBLIC_BOOKING_DATA_SOURCE"
  | "NEXT_PUBLIC_BOOKING_BRAND"
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"

/**
 * What the composition root hands to the UI. The UI renders a state per variant and
 * never falls back to mock data on its own (ADR-013).
 */
export type BookingRuntime =
  | { status: "ready"; repository: BookingRepository; auth: AuthPort; clock: Clock; isDemo: boolean }
  /** Valid configuration whose adapter cannot be used (kept for future maintenance windows). */
  | { status: "unavailable"; source: "supabase" }
  | {
      status: "config_error"
      reason: "missing" | "invalid"
      variable: BookingConfigVariable
      /** Raw value received (null when missing or secret-like). Shown to the owner. */
      received: string | null
    }
