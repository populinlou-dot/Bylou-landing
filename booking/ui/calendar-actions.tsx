"use client"

import { CalendarPlus, Download, ExternalLink } from "lucide-react"
import { useId } from "react"
import {
  bookingCalendarEvent,
  buildIcs,
  googleCalendarUrl,
  icsFileName,
  type SessionPrivateDetails,
} from "../application"
import type { Session } from "../domain"
import { useBooking, useCopy } from "./booking-context"
import { cx } from "./format"
import { buttonClass } from "./primitives"
import { useModalityLabel } from "./session-meta"

export interface CalendarActionsProps {
  session: Pick<Session, "id" | "startsAt" | "endsAt" | "modality">
  classTypeName: string
  instructorName: string | null
  /** Attendee-only details from the backend (her own active booking); null when not loaded. */
  privateDetails: SessionPrivateDetails | null
  timezone: string
  /** Id of the element naming the class (cards in a list), so each action is told apart. */
  describedBy?: string
  /** "buttons" = full-size secondary buttons (confirmation); "links" = compact text actions (Mis reservas). */
  variant?: "buttons" | "links"
}

/**
 * "Agregar al calendario" for a class she has booked (PRD ST-11): download an `.ics` file built on the
 * device, or open Google Calendar's template in a new tab. Render it only for her own confirmed,
 * not finished booking; the event builder drops attendee-only details otherwise.
 */
export function CalendarActions({
  session,
  classTypeName,
  instructorName,
  privateDetails,
  timezone,
  describedBy,
  variant = "links",
}: CalendarActionsProps) {
  const { brand, runtime } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const labelId = useId()
  const calendarBrand = { name: brand.name, domain: brand.domain }

  const event = bookingCalendarEvent({
    session,
    className: classTypeName,
    brand: calendarBrand,
    booked: true,
    privateDetails,
    labels: {
      modality: modalityLabel(session.modality),
      instructor: instructorName ? t("session.instructor", { name: instructorName }) : null,
      meetingLine: (url) => t("calendar.meeting", { url }),
    },
  })

  function download() {
    const now = runtime.status === "ready" ? runtime.clock.now() : new Date()
    const ics = buildIcs(event, { now, brand: calendarBrand })
    saveFile(icsFileName(classTypeName, session.startsAt, timezone), ics, "text/calendar;charset=utf-8")
  }

  const buttons = variant === "buttons"
  const actionClass = buttons ? cx(buttonClass.secondary, "flex-1 basis-40") : buttonClass.link

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <p id={labelId} className="flex items-center gap-2 text-[14.5px] font-semibold text-foreground">
        <CalendarPlus aria-hidden="true" className="size-4 shrink-0 text-primary" />
        {t("success.calendar")}
      </p>
      <div className={cx("flex flex-wrap", buttons ? "gap-3" : "gap-x-5 gap-y-0")}>
        <button type="button" onClick={download} aria-describedby={describedBy} className={actionClass}>
          <Download aria-hidden="true" className="size-4 shrink-0" />
          {t("calendar.ics")}
        </button>
        <a
          href={googleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={describedBy}
          className={actionClass}
        >
          <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
          {t("calendar.google")}{" "}
          <span className="sr-only">({t("calendar.newTab")})</span>
        </a>
      </div>
    </div>
  )
}

/** Hands a generated file to the browser's download flow (no server round trip). */
function saveFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser time to start the download before the blob URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
