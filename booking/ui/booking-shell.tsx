"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useBooking, useCopy } from "./booking-context"
import { DemoBanner } from "./demo-banner"
import { BookingRuntimeGate } from "./runtime-gate"

const MAIN_ID = "contenido"

/** Page chrome for /reservas: skip link, header, demo banner, main landmark. */
export function BookingShell({ children }: { children: ReactNode }) {
  const { brand, runtime } = useBooking()
  const t = useCopy()
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
  return (
    <>
      <a href={`#${MAIN_ID}`} className="booking-skip-link">
        {t("layout.skip")}
      </a>
      <header className="border-b border-border bg-card/80">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 rounded-full text-foreground">
            {brand.logo.src ? (
              <img src={`${basePath}/${brand.logo.src}`} alt="" width={28} height={28} className="size-7 object-contain" />
            ) : null}
            <span className="[font-family:var(--font-display)] text-[19px] font-medium tracking-[-0.01em]">
              {brand.logo.wordmark}
            </span>
          </Link>
        </div>
      </header>
      {runtime.status === "ready" && runtime.isDemo ? <DemoBanner /> : null}
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <BookingRuntimeGate>{children}</BookingRuntimeGate>
      </main>
    </>
  )
}
