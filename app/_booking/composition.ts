import type { AdminRepository, BookingRuntime } from "@/booking/application"
import { createBookingAdapters } from "@/booking/infrastructure/data-source"
import { DEMO_STAFF_EMAIL } from "@/booking/infrastructure/mock"
import type { BrandConfig } from "@/booking/theme"
import { resolveBrand } from "@/brands"

/**
 * Shared composition root for /reservas and /admin (ARCHITECTURE §2, ADR-013): picks the brand
 * and the adapters from build-time env. Evaluated once per page load and shared by both layouts,
 * so the auth session (and the in-memory mock studio) survive client navigation between them —
 * e.g. signing in at /reservas/ingresar/ and returning to /admin/.
 * `_booking` is a private folder: never a route.
 */
export interface BookingComposition {
  brand: BrandConfig
  runtime: BookingRuntime
  /** Null exactly when the runtime is not ready (config error). */
  admin: AdminRepository | null
  /** Demo-only sign-in hint for the admin guard (mock data source). */
  demoStaffEmail: string | null
}

function compose(): BookingComposition {
  const brandResolution = resolveBrand(process.env.NEXT_PUBLIC_BOOKING_BRAND)
  if (!brandResolution.ok) {
    return {
      brand: brandResolution.fallback,
      admin: null,
      demoStaffEmail: null,
      runtime: {
        status: "config_error",
        reason: "invalid",
        variable: "NEXT_PUBLIC_BOOKING_BRAND",
        received: brandResolution.received,
      },
    }
  }
  const { brand } = brandResolution
  const { runtime, admin } = createBookingAdapters(process.env.NEXT_PUBLIC_BOOKING_DATA_SOURCE, {
    rules: brand.rules,
    waitlist: brand.features.waitlist,
    mockLatencyMs: 250,
    // Public values only (anon/publishable key); written literally so Next inlines them at build.
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  })
  const demoStaffEmail = runtime.status === "ready" && runtime.isDemo ? DEMO_STAFF_EMAIL : null
  return { brand, runtime, admin, demoStaffEmail }
}

export const bookingComposition: BookingComposition = compose()
