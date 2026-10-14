"use client"

import type { ReactNode } from "react"
import type { BookingRuntime } from "@/booking/application"
import { createBookingRuntime } from "@/booking/infrastructure/data-source"
import type { BrandConfig } from "@/booking/theme"
import { BookingProvider, BookingShell, BookingThemeScope } from "@/booking/ui"
import { resolveBrand } from "@/brands"

/**
 * Composition root for /reservas (ARCHITECTURE §2): picks the brand and the adapters from
 * build-time env and hands them to booking/ui. NEXT_PUBLIC_* values are inlined at build.
 * Module-level so the in-memory mock keeps the same seed across client navigations.
 */
function compose(): { brand: BrandConfig; runtime: BookingRuntime } {
  const brandResolution = resolveBrand(process.env.NEXT_PUBLIC_BOOKING_BRAND)
  if (!brandResolution.ok) {
    return {
      brand: brandResolution.fallback,
      runtime: {
        status: "config_error",
        reason: "invalid",
        variable: "NEXT_PUBLIC_BOOKING_BRAND",
        received: brandResolution.received,
      },
    }
  }
  const { brand } = brandResolution
  return {
    brand,
    runtime: createBookingRuntime(process.env.NEXT_PUBLIC_BOOKING_DATA_SOURCE, {
      rules: brand.rules,
      mockLatencyMs: 250,
      // Public values only (anon/publishable key); written literally so Next inlines them at build.
      supabase: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
    }),
  }
}

const composed = compose()

export function BookingRoot({ children }: { children: ReactNode }) {
  return (
    <BookingProvider brand={composed.brand} runtime={composed.runtime}>
      <BookingThemeScope brand={composed.brand}>
        <BookingShell>{children}</BookingShell>
      </BookingThemeScope>
    </BookingProvider>
  )
}
