"use client"

import { Check } from "lucide-react"
import { MODALITIES, type ClassTypeView } from "../../application"
import type { Modality } from "../../domain"
import { useCopy } from "../booking-context"
import { cx } from "../format"

interface ChipOption<T extends string> {
  id: T | null
  label: string
}

/**
 * Filter chips (UX_DESIGN §2.2). Toggle buttons with `aria-pressed`; the selected chip
 * differs by fill AND a check icon, never by color alone.
 */
function FilterChips<T extends string>({
  label,
  options,
  selectedId,
  onSelect,
}: {
  label: string
  options: ChipOption<T>[]
  selectedId: T | null
  onSelect: (id: T | null) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
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
  const options: ChipOption<string>[] = [
    { id: null, label: t("filter.all") },
    ...classTypes.map((ct) => ({ id: ct.id, label: ct.name })),
  ]
  return <FilterChips label={t("agenda.filter")} options={options} selectedId={selectedId} onSelect={onSelect} />
}

/** Todas / Presencial / Online (PRD ST-01 AC4). */
export function ModalityFilter({
  selected,
  onSelect,
}: {
  selected: Modality | null
  onSelect: (modality: Modality | null) => void
}) {
  const t = useCopy()
  const options: ChipOption<Modality>[] = [
    { id: null, label: t("filter.all") },
    ...MODALITIES.map((modality) => ({
      id: modality,
      label: modality === "online" ? t("filter.modality.online") : t("filter.modality.inPerson"),
    })),
  ]
  return <FilterChips label={t("agenda.filter.modality")} options={options} selectedId={selected} onSelect={onSelect} />
}
