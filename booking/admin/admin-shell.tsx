"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ADMIN_PATH } from "../application"
import { useAuthState, useBooking, useCopy, useReadyRuntime } from "../ui/booking-context"
import { DemoBanner } from "../ui/demo-banner"
import { BookingRuntimeGate } from "../ui/runtime-gate"
import { StaffGuard } from "./staff-guard"

const MAIN_ID = "contenido"

/**
 * Page chrome for /admin (UX_DESIGN A1): quieter than the student shell, same brand tokens.
 * Order matters: config errors first (ADR-013), then the staff guard, then the page.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { brand, runtime } = useBooking()
  const t = useCopy()
  return (
    <>
      <a href={`#${MAIN_ID}`} className="booking-skip-link">
        {t("layout.skip")}
      </a>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Link href={ADMIN_PATH} className="inline-flex min-h-11 items-center gap-2 rounded-full text-foreground">
            <span className="[font-family:var(--font-display)] text-[18px] font-medium tracking-[-0.01em]">
              {brand.logo.wordmark}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
              {t("admin.label")}
            </span>
          </Link>
          {runtime.status === "ready" ? <AdminAccountNav /> : null}
        </div>
      </header>
      {runtime.status === "ready" && runtime.isDemo ? <DemoBanner /> : null}
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <BookingRuntimeGate>
          <StaffGuard>{children}</StaffGuard>
        </BookingRuntimeGate>
      </main>
    </>
  )
}

function AdminAccountNav() {
  const t = useCopy()
  const auth = useAuthState()
  const { auth: authPort } = useReadyRuntime()
  const linkClass =
    "inline-flex min-h-11 items-center rounded-full px-2 text-[14.5px] font-semibold text-primary underline-offset-4 hover:underline"
  return (
    <nav className="flex items-center gap-1 sm:gap-3">
      <Link href={ADMIN_PATH} className={linkClass}>
        {t("admin.nav.today")}
      </Link>
      {auth.status === "signed_in" ? (
        <button type="button" className={linkClass} onClick={() => void authPort.signOut()}>
          {t("auth.signOut")}
        </button>
      ) : null}
    </nav>
  )
}
