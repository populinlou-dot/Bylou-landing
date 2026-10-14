"use client"

import Link from "next/link"
import { useId } from "react"
import type { AgendaEntry } from "../../application"
import { useBooking, useCopy } from "../booking-context"
import { cx, formatTime } from "../format"
import { ReserveAction } from "../reserve/reserve-action"
import { ModalityIcon, StateBadge, availabilityText, useModalityLabel } from "../session-meta"

export const SESSION_DETAIL_PATH = "/reservas/sesion/"

export function SessionCard({ entry, timezone }: { entry: AgendaEntry; timezone: string }) {
  const { brand } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const titleId = useId()
  const statusId = useId()
  const { session } = entry
  const inactive = entry.state === "past" || entry.state === "cancelled"
  const status = availabilityText(entry, t)

  return (
    <article
      aria-labelledby={titleId}
      className={cx(
        "flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-5",
        inactive ? "bg-muted" : "bg-card [box-shadow:var(--shadow-card)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-semibold text-foreground">
          <time dateTime={session.startsAt} className="tabular-nums">
            {formatTime(session.startsAt, timezone, brand.locale)}
          </time>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          <span className="font-normal text-muted-foreground">{t("session.duration", { min: entry.durationMinutes })}</span>
        </p>
        <StateBadge state={entry.state} />
      </div>

      <h3 id={titleId} className="[font-family:var(--font-display)] text-[21px] font-medium leading-tight">
        <Link
          href={{ pathname: SESSION_DETAIL_PATH, query: { id: session.id } }}
          className={cx(
            "rounded-sm text-foreground underline-offset-4 hover:text-primary hover:underline",
            entry.state === "cancelled" && "line-through decoration-1",
          )}
        >
          {entry.classType.name}
        </Link>
      </h3>

      <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1 text-[14.5px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <ModalityIcon modality={session.modality} />
          {modalityLabel(session.modality)}
        </li>
        {entry.instructorName ? <li>{t("session.instructor", { name: entry.instructorName })}</li> : null}
      </ul>

      {status ? (
        <p
          id={statusId}
          className={cx("text-[14.5px] font-semibold", entry.state === "available" ? "text-primary" : "text-muted-foreground")}
        >
          {status}
        </p>
      ) : null}

      <ReserveAction entry={entry} timezone={timezone} describedBy={status ? `${titleId} ${statusId}` : titleId} />
    </article>
  )
}
