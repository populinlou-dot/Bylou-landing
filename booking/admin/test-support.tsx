/**
 * Render helper for booking/admin component tests (test-only). No brand import here: the
 * boundary rule allows brands only inside *.test.tsx, so tests pass the brand fixture in.
 */
import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import type { AdminRepository, AuthPort, BookingRepository } from "../application"
import { fakeRepository, fixedClock } from "../application/test-support"
import type { BrandConfig } from "../theme"
import { BookingProvider } from "../ui/booking-context"
import { AdminProvider } from "./admin-context"
import { AdminShell } from "./admin-shell"

// Wednesday 2026-10-14 12:00 Buenos Aires.
export const NOW = "2026-10-14T15:00:00.000Z"

export function renderAdmin(
  ui: ReactNode,
  {
    brand,
    admin,
    auth,
    repository = fakeRepository([]),
    isDemo = false,
    demoStaffEmail = null,
    withShell = true,
  }: {
    brand: BrandConfig
    admin: AdminRepository
    auth: AuthPort
    repository?: BookingRepository
    isDemo?: boolean
    demoStaffEmail?: string | null
    withShell?: boolean
  },
) {
  return render(
    <BookingProvider brand={brand} runtime={{ status: "ready", repository, clock: fixedClock(NOW), isDemo, auth }}>
      <AdminProvider repository={admin} demoStaffEmail={demoStaffEmail}>
        {withShell ? <AdminShell>{ui}</AdminShell> : ui}
      </AdminProvider>
    </BookingProvider>,
  )
}
