"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { MY_BOOKINGS_PATH, SIGN_IN_PATH } from "../application"
import { useAuthState, useBooking, useCopy, useReadyRuntime } from "./booking-context"
import { DemoBanner } from "./demo-banner"
import { BookingRuntimeGate } from "./runtime-gate"

const MAIN_ID = "contenido"

/** Page chrome for /reservas: skip link, header (with the demo banner inside the banner landmark), main landmark. */
export function BookingShell({ children }: { children: ReactNode }) {
  const { brand, runtime } = useBooking()
  const t = useCopy()
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
  return (
    <>
      <a href={`#${MAIN_ID}`} className="booking-skip-link">
        {t("layout.skip")}
      </a>
      <header>
        <div className="border-b border-border bg-card/80">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 rounded-full text-foreground">
              {brand.logo.src ? (
                <img src={`${basePath}/${brand.logo.src}`} alt="" width={28} height={28} className="size-7 object-contain" />
              ) : null}
              <span className="[font-family:var(--font-display)] text-[19px] font-medium tracking-[-0.01em]">
                {brand.logo.wordmark}
              </span>
            </Link>
            {runtime.status === "ready" ? <AccountNav /> : null}
          </div>
        </div>
        {/* Inside the banner landmark, so no page content sits outside a landmark (axe `region`). */}
        {runtime.status === "ready" && runtime.isDemo ? <DemoBanner /> : null}
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <BookingRuntimeGate>{children}</BookingRuntimeGate>
      </main>
    </>
  )
}

/** "Mis reservas" + sign in/out. UX only: every request is re-checked by RLS/RPC. */
function AccountNav() {
  const t = useCopy()
  const auth = useAuthState()
  const { auth: authPort } = useReadyRuntime()
  const router = useRouter()
  const linkClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-[14.5px] font-semibold text-primary underline-offset-4 hover:underline"
  return (
    <nav className="flex items-center gap-1 sm:gap-3">
      <Link href={MY_BOOKINGS_PATH} className={linkClass}>
        {t("mine.title")}
      </Link>
      {auth.status === "signed_in" ? (
        <button
          type="button"
          className={linkClass}
          onClick={async () => {
            await authPort.signOut()
            router.push("/reservas/")
          }}
        >
          {t("auth.signOut")}
        </button>
      ) : auth.status === "signed_out" ? (
        <Link href={SIGN_IN_PATH} className={linkClass}>
          {t("auth.signIn")}
        </Link>
      ) : null}
    </nav>
  )
}
