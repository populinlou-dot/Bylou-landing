"use client"

import type { ReactNode } from "react"
import { AdminProvider, AdminShell } from "@/booking/admin"
import { BookingProvider, BookingThemeScope } from "@/booking/ui"
import { bookingComposition as composed } from "../_booking/composition"

/**
 * Composition root for /admin: same brand wrapper (ADR-008) and the same explicit data-source /
 * config-error behavior as /reservas (ADR-013). The shell is public; RLS/RPC protect the data.
 */
export function AdminRoot({ children }: { children: ReactNode }) {
  return (
    <BookingProvider brand={composed.brand} runtime={composed.runtime} captcha={composed.captcha}>
      <AdminProvider repository={composed.admin} demoStaffEmail={composed.demoStaffEmail}>
        <BookingThemeScope brand={composed.brand}>
          <AdminShell>{children}</AdminShell>
        </BookingThemeScope>
      </AdminProvider>
    </BookingProvider>
  )
}
