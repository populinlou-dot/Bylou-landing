"use client"

import { Clock3 } from "lucide-react"
import { useId } from "react"
import { useCopy } from "./booking-context"
import { cx } from "./format"

/**
 * Read-only slice: "Reservar" is visible so the flow is recognisable, but it does nothing
 * and says why. It never fakes a booking. `aria-disabled` (not `disabled`) keeps it
 * focusable so keyboard and screen-reader users also reach the explanation.
 */
export function ReserveCtaPlaceholder({ describedBy, fullWidth = false }: { describedBy?: string; fullWidth?: boolean }) {
  const t = useCopy()
  const noteId = useId()
  return (
    <div className={cx("flex flex-col gap-2", !fullWidth && "sm:flex-row sm:items-center sm:gap-3")}>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={[describedBy, noteId].filter(Boolean).join(" ")}
        onClick={(event) => event.preventDefault()}
        className={cx(
          "inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-[var(--radius-button)] border-[1.5px] border-dashed border-input bg-secondary px-6 text-[15px] font-semibold text-secondary-foreground",
          fullWidth && "w-full",
        )}
      >
        {t("session.cta")}
      </button>
      <p id={noteId} className="flex items-start gap-1.5 text-[13.5px] leading-snug text-muted-foreground">
        <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("session.soon")}
      </p>
    </div>
  )
}
