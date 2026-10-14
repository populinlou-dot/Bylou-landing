"use client"

import { AlertCircle, ArrowLeft, CalendarClock, CalendarSearch, MapPin, MonitorPlay, RotateCw, UserRound } from "lucide-react"
import Link from "next/link"
import { useId } from "react"
import type { SessionDetail, SessionPrivateDetails } from "../../application"
import { useBooking, useCopy } from "../booking-context"
import { formatDayHeading, formatTime } from "../format"
import { DisplayTitle, Eyebrow, SkeletonBlock, StatusPanel, buttonClass } from "../primitives"
import { ReserveAction } from "../reserve/reserve-action"
import { ModalityIcon, StateBadge, statusText, useModalityLabel } from "../session-meta"

export const AGENDA_PATH = "/reservas/"

export type SessionDetailLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ready"; detail: SessionDetail }

export function BackToAgenda() {
  const t = useCopy()
  return (
    <Link href={AGENDA_PATH} className={buttonClass.link}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t("session.back")}
    </Link>
  )
}

export function SessionDetailSkeleton() {
  const t = useCopy()
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <p role="status" aria-live="polite" className="sr-only">
        {t("agenda.loading")}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-4" data-testid="session-skeleton">
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-10 w-64" />
        <SkeletonBlock className="h-40 w-full rounded-[var(--radius-card)]" />
      </div>
    </div>
  )
}

/** S1 detail (`/reservas/sesion/?id=`): presentational, data from SessionDetailContainer. */
export function SessionDetailView({
  load,
  onRetry,
  reopenSheet = false,
}: {
  load: SessionDetailLoadState
  onRetry: () => void
  reopenSheet?: boolean
}) {
  const t = useCopy()

  if (load.status === "loading") return <SessionDetailSkeleton />

  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-5">
        <BackToAgenda />
        <StatusPanel
          role="alert"
          titleAs="h1"
          icon={<AlertCircle className="size-5" />}
          title={t("error.load")}
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
        title={t("session.notFound")}
        action={<BackToAgenda />}
      />
    )
  }

  return <SessionDetailContent detail={load.detail} reopenSheet={reopenSheet} />
}

function SessionDetailContent({ detail, reopenSheet }: { detail: SessionDetail; reopenSheet: boolean }) {
  const { brand } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const statusId = useId()
  const { entry, timezone } = detail
  const { session } = entry
  const status = statusText(entry, t)

  return (
    <article className="flex flex-col gap-6" aria-labelledby="session-title">
      <BackToAgenda />
      <header className="flex flex-col gap-2">
        <Eyebrow>{brand.terminology.classType.singular}</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          <DisplayTitle id="session-title" className="text-[clamp(30px,8vw,44px)]">
            {entry.classType.name}
          </DisplayTitle>
          <StateBadge state={entry.state} />
        </div>
      </header>

      <div className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-card p-5 [box-shadow:var(--shadow-card)] sm:p-7">
        <ul role="list" className="flex flex-col gap-3 text-[15.5px] text-foreground">
          <li className="flex items-start gap-2">
            <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <time dateTime={session.startsAt} className="font-semibold">
                {formatDayHeading(entry.localDate, brand.locale)}
              </time>
              <br />
              <span className="tabular-nums">
                {formatTime(session.startsAt, timezone, brand.locale)} – {formatTime(session.endsAt, timezone, brand.locale)}
              </span>{" "}
              <span className="text-muted-foreground">({t("session.duration", { min: entry.durationMinutes })})</span>
            </span>
          </li>
          <li className="flex items-center gap-2">
            <ModalityIcon modality={session.modality} />
            {modalityLabel(session.modality)}
          </li>
          {entry.instructorName ? (
            <li className="flex items-center gap-2">
              <UserRound aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {t("session.instructor", { name: entry.instructorName })}
            </li>
          ) : null}
        </ul>

        {entry.classType.description ? (
          <p className="text-[15.5px] leading-relaxed text-muted-foreground">{entry.classType.description}</p>
        ) : null}

        {status ? (
          <p id={statusId} className="text-[15px] font-semibold text-primary">
            {status}
          </p>
        ) : null}

        {detail.privateDetails ? <PrivateDetails details={detail.privateDetails} /> : null}

        <ReserveAction
          entry={entry}
          timezone={timezone}
          describedBy={status ? statusId : undefined}
          fullWidth
          autoOpen={reopenSheet}
          waitlistHours={detail.cancellationWindowHours}
        />
      </div>

      <p className="text-[13.5px] text-muted-foreground">{t("agenda.tz")}</p>
    </article>
  )
}

/** Defense in depth (the DB CHECK already requires https): never render javascript:/data: links. */
const SAFE_MEETING_URL = /^https:\/\/[^\s]+$/i

/** Meeting link / address: rendered only when the backend returned them (booked users). */
export function PrivateDetails({ details }: { details: SessionPrivateDetails }) {
  const t = useCopy()
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] text-foreground">
      {details.meetingUrl && SAFE_MEETING_URL.test(details.meetingUrl) ? (
        <a href={details.meetingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass.link}>
          <MonitorPlay aria-hidden="true" className="size-4" />
          {t("mine.join")}
        </a>
      ) : null}
      {details.address ? (
        <p className="flex items-start gap-2">
          <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
          {t("mine.address", { address: details.address })}
        </p>
      ) : null}
      {details.instructions ? <p className="text-muted-foreground">{details.instructions}</p> : null}
    </div>
  )
}
