"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCopy } from "../booking-context"
import { buttonClass } from "../primitives"
import { cx } from "../format"

const iconButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-button)] border-[1.5px] border-input bg-card px-3 text-[14.5px] font-semibold text-primary transition-colors duration-[var(--dur)] ease-[var(--ease)] hover:bg-secondary"

export function WeekNav({
  label,
  isCurrentWeek,
  onPrevious,
  onNext,
  onToday,
}: {
  /** "Semana del 13 al 19 de octubre", or null while the week is loading. */
  label: string | null
  isCurrentWeek: boolean
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  const t = useCopy()
  return (
    <div className="flex flex-col gap-3">
      <p className="min-h-6 text-[16px] font-semibold text-foreground" aria-hidden={label === null}>
        {label ?? ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onPrevious} className={iconButton}>
          <ChevronLeft aria-hidden="true" className="size-5" />
          <span className="sr-only sm:not-sr-only">{t("agenda.prevWeek")}</span>
        </button>
        <button
          type="button"
          onClick={onToday}
          disabled={isCurrentWeek}
          className={cx(buttonClass.secondary, "disabled:cursor-default disabled:border-border disabled:text-muted-foreground disabled:hover:bg-card")}
        >
          {t("agenda.thisWeek")}
        </button>
        <button type="button" onClick={onNext} className={iconButton}>
          <span className="sr-only sm:not-sr-only">{t("agenda.nextWeek")}</span>
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  )
}
