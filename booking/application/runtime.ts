import type { BookingRepository, Clock } from "./ports"

/** Environment variables the booking pages depend on (ADR-013). */
export type BookingConfigVariable = "NEXT_PUBLIC_BOOKING_DATA_SOURCE" | "NEXT_PUBLIC_BOOKING_BRAND"

/**
 * What the composition root hands to the UI. The UI renders a state per variant and
 * never falls back to mock data on its own (ADR-013).
 */
export type BookingRuntime =
  | { status: "ready"; repository: BookingRepository; clock: Clock; isDemo: boolean }
  /** Valid configuration whose adapter is not built yet (Supabase before Phase 3). */
  | { status: "unavailable"; source: "supabase" }
  | {
      status: "config_error"
      reason: "missing" | "invalid"
      variable: BookingConfigVariable
      /** Raw value received (null when missing). Shown to the owner, never secret. */
      received: string | null
    }
