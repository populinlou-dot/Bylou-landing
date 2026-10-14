"use client"

import { FlaskConical } from "lucide-react"
import { useCopy } from "./booking-context"

/** Persistent while the mock adapter is active (ADR-013, PL-03). Not dismissible on purpose. */
export function DemoBanner() {
  const t = useCopy()
  return (
    <div role="note" aria-label={t("demo.banner")} className="border-b border-border bg-accent text-accent-foreground">
      <div className="mx-auto flex w-full max-w-3xl items-start gap-3 px-4 py-3 sm:px-6">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[color:var(--warning)]" />
        <p className="text-[14px] leading-snug">
          <strong className="font-bold">{t("demo.banner")}.</strong> {t("demo.note")}
        </p>
      </div>
    </div>
  )
}
