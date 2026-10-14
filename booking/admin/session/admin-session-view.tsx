"use client"

import { AlertCircle, ArrowLeft, Ban, CalendarSearch, RotateCw, Users } from "lucide-react"
import Link from "next/link"
import { adminDayHref, canEditCapacity, type AdminSessionDetail, type AttendanceMark, type RosterEntry } from "../../application"
import { ATTENDANCE_EDITABLE_DAYS, ATTENDANCE_OPENS_MINUTES_BEFORE } from "../../domain"
import { useBooking, useCopy } from "../../ui/booking-context"
import { formatDayHeading, formatTime } from "../../ui/format"
import { Badge, SkeletonBlock, StatusPanel, buttonClass } from "../../ui/primitives"
import { ModalityIcon, useModalityLabel } from "../../ui/session-meta"
import { AdminStateBadge, Occupancy } from "../admin-meta"
import { RosterList, type RowAttendanceState } from "./roster-list"
import { CapacityEditor, type CapacityPhase } from "./session-actions"

/** Session-level staff actions (AD-05): capacity edit and cancel. Optional so 4.1 callers still render. */
export interface SessionActionsProps {
  /** Outcome of the last capacity change or cancellation (polite live region). */
  notice: string | null
  capacityValue: string
  capacityPhase: CapacityPhase
  onCapacityChange: (value: string) => void
  onCapacitySubmit: () => void
  onCancelRequest: () => void
}

export type AdminSessionLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ready"; detail: AdminSessionDetail }

function BackToDay({ date }: { date?: string }) {
  const t = useCopy()
  return (
    <Link href={adminDayHref(date)} className={buttonClass.link}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t("admin.session.back")}
    </Link>
  )
}

export function AdminSessionSkeleton() {
  const t = useCopy()
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p role="status" aria-live="polite" className="sr-only">
        {t("admin.roster.loading")}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-9 w-56" />
        <SkeletonBlock className="h-40 w-full rounded-[var(--radius-card)]" />
      </div>
    </div>
  )
}

/** A3 roster + attendance (`/admin/clase/?id=`): presentational, state from AdminSessionContainer. */
export function AdminSessionView({
  load,
  rows,
  notice,
  onRetry,
  onMark,
  actions,
}: {
  load: AdminSessionLoadState
  rows: Readonly<Record<string, RowAttendanceState>>
  notice: string | null
  onRetry: () => void
  onMark: (entry: RosterEntry, mark: AttendanceMark) => void
  actions?: SessionActionsProps
}) {
  const t = useCopy()

  if (load.status === "loading") return <AdminSessionSkeleton />

  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-5">
        <BackToDay />
        <StatusPanel
          role="alert"
          titleAs="h1"
          icon={<AlertCircle className="size-5" />}
          title={t("admin.roster.error")}
          action={
            <button type="button" onClick={onRetry} className={buttonClass.primary}>
              <RotateCw aria-hidden="true" className="size-4" />
              {t("error.retry")}
            </button>
          }
        />
      </div>
    )
  }

  if (load.status === "not_found") {
    return (
      <StatusPanel
        role="status"
        titleAs="h1"
        icon={<CalendarSearch className="size-5" />}
        title={t("admin.session.notFound")}
        action={<BackToDay />}
      />
    )
  }

  return <AdminSessionContent detail={load.detail} rows={rows} notice={notice} onMark={onMark} actions={actions} />
}

function AdminSessionContent({
  detail,
  rows,
  notice,
  onMark,
  actions,
}: {
  detail: AdminSessionDetail
  rows: Readonly<Record<string, RowAttendanceState>>
  notice: string | null
  onMark: (entry: RosterEntry, mark: AttendanceMark) => void
  actions?: SessionActionsProps
}) {
  const { brand } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const { entry, timezone, roster } = detail
  const { session } = entry
  const hasConfirmed = roster.some((r) => r.status === "confirmed")
  const windowNote =
    entry.state === "cancelled" || !hasConfirmed
      ? null
      : entry.attendanceWindow === "not_yet"
        ? t("admin.attendance.notYet", { min: ATTENDANCE_OPENS_MINUTES_BEFORE })
        : entry.attendanceWindow === "closed"
          ? t("admin.attendance.closed", { days: ATTENDANCE_EDITABLE_DAYS })
          : null

  return (
    <article className="flex flex-col gap-5" aria-labelledby="admin-session-title">
      <BackToDay date={entry.localDate} />
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="admin-session-title" className="[font-family:var(--font-display)] text-[28px] font-medium leading-tight text-foreground">
            {entry.classTypeName}
          </h1>
          {entry.isPublished ? null : <Badge tone="neutral">{t("admin.session.unpublished")}</Badge>}
          <AdminStateBadge state={entry.state} />
        </div>
        <p className="text-[15px] text-foreground">
          {formatDayHeading(entry.localDate, brand.locale)}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          <time dateTime={session.startsAt} className="tabular-nums">
            {formatTime(session.startsAt, timezone, brand.locale)}–{formatTime(session.endsAt, timezone, brand.locale)}
          </time>
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ModalityIcon modality={session.modality} />
            {modalityLabel(session.modality)}
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <Users aria-hidden="true" className="size-4 text-primary" />
            <Occupancy confirmed={entry.confirmedCount} capacity={session.capacity} />
          </span>
        </p>
      </header>

      {actions ? <SessionActions detail={detail} actions={actions} /> : null}

      <section className="flex flex-col gap-3" aria-labelledby="admin-roster-title">
        <h2 id="admin-roster-title" className="text-[17px] font-semibold text-foreground">
          {t("admin.roster.title")}
        </h2>
        {windowNote ? <p className="text-[14.5px] text-muted-foreground">{windowNote}</p> : null}
        <p role="status" aria-live="polite" className="min-h-0 text-[14.5px] font-semibold text-[color:var(--success)]">
          {notice ?? ""}
        </p>
        {roster.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-[15px] text-muted-foreground">
            {t("admin.roster.empty")}
          </p>
        ) : (
          <RosterList roster={roster} window={entry.attendanceWindow} rows={rows} onMark={onMark} />
        )}
      </section>
    </article>
  )
}

/** Capacity editor before start; cancel while upcoming or in progress (finished classes are history). */
function SessionActions({ detail, actions }: { detail: AdminSessionDetail; actions: SessionActionsProps }) {
  const t = useCopy()
  const { entry } = detail
  const editable = canEditCapacity(entry.session, new Date(detail.now))
  const cancellable = entry.state === "upcoming" || entry.state === "in_progress"
  return (
    <div className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-[14.5px] font-semibold text-[color:var(--success)] empty:hidden">
        {actions.notice ?? ""}
      </p>
      {editable || cancellable ? (
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-card p-4">
          {editable ? (
            <CapacityEditor
              value={actions.capacityValue}
              confirmedCount={entry.confirmedCount}
              phase={actions.capacityPhase}
              onChange={actions.onCapacityChange}
              onSubmit={actions.onCapacitySubmit}
            />
          ) : null}
          {cancellable ? (
            <button
              type="button"
              onClick={actions.onCancelRequest}
              className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-[var(--radius-button)] border-[1.5px] border-[color:var(--destructive)] bg-card px-5 text-[15px] font-semibold text-destructive hover:bg-secondary"
            >
              <Ban aria-hidden="true" className="size-4" />
              {t("admin.cancelSession.cta")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
