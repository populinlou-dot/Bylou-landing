"use client"

import { AlertCircle, CalendarX2, RotateCw } from "lucide-react"
import type { AgendaWeek, ClassTypeView } from "../../application"
import type { Modality } from "../../domain"
import { useBooking, useCopy } from "../booking-context"
import { formatWeekBounds } from "../format"
import { DisplayTitle, Eyebrow, StatusPanel, buttonClass } from "../primitives"
import { AgendaSkeleton } from "./agenda-skeleton"
import { DayGroup } from "./day-group"
import { ModalityFilter, PracticeFilter } from "./practice-filter"
import { WeekNav } from "./week-nav"

export type AgendaLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; week: AgendaWeek }

export interface AgendaViewProps {
  load: AgendaLoadState
  /** Last known class types, kept while a new week/filter loads so chips do not jump. */
  classTypes: ClassTypeView[]
  selectedClassTypeId: string | null
  selectedModality: Modality | null
  isCurrentWeek: boolean
  onSelectClassType: (id: string | null) => void
  onSelectModality: (modality: Modality | null) => void
  onPreviousWeek: () => void
  onNextWeek: () => void
  onToday: () => void
  onRetry: () => void
}

/** Presentational agenda (S1). All data and callbacks come from AgendaContainer. */
export function AgendaView(props: AgendaViewProps) {
  const { load } = props
  const { brand } = useBooking()
  const t = useCopy()
  const week = load.status === "ready" ? load.week : null
  const weekLabel = week ? t("agenda.week", formatWeekBounds(week.weekStart, week.weekEnd, brand.locale)) : null

  const announcement =
    load.status === "loading"
      ? t("agenda.loading")
      : load.status === "error"
        ? ""
        : load.week.total === 1
          ? t("agenda.count.one")
          : load.week.total > 1
            ? t("agenda.count.many", { n: load.week.total })
            : t("empty.week")

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-2">
        <Eyebrow>{t("agenda.eyebrow")}</Eyebrow>
        <DisplayTitle className="text-[clamp(30px,8vw,46px)]">{t("agenda.title")}</DisplayTitle>
      </header>

      <div className="flex flex-col gap-5">
        <WeekNav
          label={weekLabel}
          isCurrentWeek={props.isCurrentWeek}
          onPrevious={props.onPreviousWeek}
          onNext={props.onNextWeek}
          onToday={props.onToday}
        />
        <div className="flex flex-col gap-3">
          {props.classTypes.length > 0 ? (
            <PracticeFilter
              classTypes={props.classTypes}
              selectedId={props.selectedClassTypeId}
              onSelect={props.onSelectClassType}
            />
          ) : null}
          <ModalityFilter selected={props.selectedModality} onSelect={props.onSelectModality} />
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-[14px] font-semibold text-muted-foreground">
        {announcement}
      </p>

      <div aria-busy={load.status === "loading"} className="flex flex-col gap-8">
        {load.status === "loading" ? <AgendaSkeleton /> : null}

        {load.status === "error" ? (
          <StatusPanel
            role="alert"
            icon={<AlertCircle className="size-5" />}
            title={t("error.load")}
            action={
              <button type="button" onClick={props.onRetry} className={buttonClass.primary}>
                <RotateCw aria-hidden="true" className="size-4" />
                {t("error.retry")}
              </button>
            }
          />
        ) : null}

        {week && week.total === 0 ? (
          <StatusPanel
            icon={<CalendarX2 className="size-5" />}
            title={t("empty.week")}
            action={
              <button type="button" onClick={props.onNextWeek} className={buttonClass.secondary}>
                {t("empty.next")}
              </button>
            }
          />
        ) : null}

        {week && week.total > 0
          ? week.days.map((day) => <DayGroup key={day.date} day={day} timezone={week.timezone} />)
          : null}
      </div>

      <p className="text-[13.5px] text-muted-foreground">{t("agenda.tz")}</p>
    </div>
  )
}
