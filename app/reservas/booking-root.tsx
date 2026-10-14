"use client"

import type { ReactNode } from "react"
import { BookingProvider, BookingShell, BookingThemeScope } from "@/booking/ui"
import { bookingComposition as composed } from "../_booking/composition"

/**
 * Composition root for /reservas (ARCHITECTURE §2): brand + adapters come from the shared
 * module-level composition (app/_booking), so the in-memory mock keeps the same seed across
 * client navigations, including to and from /admin.
 */
export function BookingRoot({ children }: { children: ReactNode }) {
  return (
    <BookingProvider brand={composed.brand} runtime={composed.runtime}>
      <BookingThemeScope brand={composed.brand}>
        <BookingShell>{children}</BookingShell>
      </BookingThemeScope>
    </BookingProvider>
  )
}
