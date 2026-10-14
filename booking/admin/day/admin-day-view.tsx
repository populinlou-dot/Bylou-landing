"use client"

import { AlertCircle, CalendarX2, ChevronLeft, ChevronRight, RotateCw, Users } from "lucide-react"
import Link from "next/link"
import { useId } from "react"
import { adminDayHref, adminSessionHref, type AdminDay, type AdminDayEntry } from "../../application"
import { useBooking, useCopy } from "../../ui/booking-context"
import { cx, formatDayHeading, formatTime } from "../../ui/format"
import { Badge, SkeletonBlock, StatusPanel, buttonClass } from "../../ui/primitives"
import { ModalityIcon, useModalityLabel } from "../../ui/session-meta"
import { AdminStateBadge, Occupancy } from "../admin-meta"

export type AdminDayLoadState = { status: "loading" } | { status: "error" } | { status: "ready"; day: AdminDay }

const navButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-button)] border-[1.5px] border-input bg-card px-3 text-[14.5px] font-semibold text-primary transition-colors duration-[var(--dur)] ease-[var(--ease)] hover:bg-secondary"

/** A1 "Hoy" (`/admin/?dia=`): presentational, data from AdminDayContainer. */
export function AdminDayView({ load, onRetry }: { load: AdminDayLoadState; onRetry: () => void }) {
  const t = useCopy()

  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {t("admin.day.loading")}
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3" data-testid="admin-day-skeleton">
          <SkeletonBlock className="h-9 w-56" />
          <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
          <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
    )
  }

  if (load.status === "error") {
    return (
      <StatusPanel
        role="alert"
        titleAs="h1"
        icon={<AlertCircle className="size-5" />}
        title={t("admin.day.error")}
        action={
          <button type="button" onClick={onRetry} className={buttonClass.primary}>
            <RotateCw aria-hidden="true" className="size-4" />
            {t("error.retry")}
          </button>
        }
      />
    )
  }

  return <AdminDayContent day={load.day} />
}

function AdminDayContent({ day }: { day: AdminDay }) {
  const { brand } = useBooking()
  const t = useCopy()
  const heading = formatDayHeading(day.date, brand.locale)

  return (
    <section className="flex flex-col gap-5" aria-labelledby="admin-day-title">
      <header className="flex flex-col gap-3">
        <h1 id="admin-day-title" className="[font-family:var(--font-display)] text-[28px] font-medium leading-tight text-foreground">
          {day.isToday ? t("admin.day.todayTitle", { date: heading }) : heading}
        </h1>
        <nav aria-label={t("admin.nav.today")} className="flex flex-wrap items-center gap-2">
          <Link href={adminDayHref(day.previous)} className={navButton}>
            <ChevronLeft aria-hidden="true" className="size-5" />
            <span className="sr-only sm:not-sr-only">{t("admin.day.prev")}</span>
          </Link>
          {day.isToday ? null : (
            <Link href={adminDayHref()} className={buttonClass.secondary}>
              {t("admin.day.backToToday")}
            </Link>
          )}
          <Link href={adminDayHref(day.next)} className={navButton}>
            <span className="sr-only sm:not-sr-only">{t("admin.day.next")}</span>
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        </nav>
      </header>

      {day.sessions.length === 0 ? (
        <StatusPanel role="status" icon={<CalendarX2 className="size-5" />} title={t("admin.day.empty")} />
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {day.sessions.map((entry) => (
            <li key={entry.session.id}>
              <AdminSessionRow entry={entry} timezone={day.timezone} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AdminSessionRow({ entry, timezone }: { entry: AdminDayEntry; timezone: string }) {
  const { brand } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const titleId = useId()
  const { session } = entry
  const inactive = entry.state === "cancelled" || entry.state === "finished"

  return (
    <article
      aria-labelledby={titleId}
      className={cx(
        "flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-4",
        inactive ? "bg-muted" : "bg-card [box-shadow:var(--shadow-card)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-[16px] font-semibold text-foreground">
          <time dateTime={session.startsAt} className="tabular-nums">
            {formatTime(session.startsAt, timezone, brand.locale)}
          </time>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          <span className={cx(entry.state === "cancelled" && "line-through decoration-1")}>{entry.classTypeName}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.isPublished ? null : <Badge tone="neutral">{t("admin.session.unpublished")}</Badge>}
          <AdminStateBadge state={entry.state} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[14.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ModalityIcon modality={session.modality} />
          {modalityLabel(session.modality)}
        </span>
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <Users aria-hidden="true" className="size-4 text-primary" />
          <Occupancy confirmed={entry.confirmedCount} capacity={session.capacity} />
        </span>
      </div>
      <Link href={adminSessionHref(session.id)} className={cx(buttonClass.link, "self-start")} aria-describedby={titleId}>
        {t("admin.session.open")}
      </Link>
    </article>
  )
}
