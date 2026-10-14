"use client"

import { Check } from "lucide-react"
import type { ClassTypeView } from "../../application"
import { useCopy } from "../booking-context"
import { cx } from "../format"

/**
 * Practice chips (UX_DESIGN §2.2). Toggle buttons with `aria-pressed`; the selected chip
 * differs by fill AND a check icon, never by color alone.
 */
export function PracticeFilter({
  classTypes,
  selectedId,
  onSelect,
}: {
  classTypes: ClassTypeView[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const t = useCopy()
  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: t("filter.all") },
    ...classTypes.map((ct) => ({ id: ct.id, label: ct.name })),
  ]
  return (
    <div role="group" aria-label={t("agenda.filter")} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const pressed = option.id === selectedId
        return (
          <button
            key={option.id ?? "all"}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(option.id)}
            className={cx(
              "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-button)] border-[1.5px] px-4 text-[14.5px] font-semibold transition-colors duration-[var(--dur)] ease-[var(--ease)]",
              pressed
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card text-muted-foreground hover:bg-secondary hover:text-primary",
            )}
          >
            {pressed ? <Check aria-hidden="true" className="size-4" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
