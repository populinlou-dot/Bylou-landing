"use client"

import { useId } from "react"
import type { AgendaDay } from "../../application"
import { useBooking } from "../booking-context"
import { formatDayHeading } from "../format"
import { SessionCard } from "./session-card"

export function DayGroup({ day, timezone }: { day: AgendaDay; timezone: string }) {
  const { brand } = useBooking()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-[15px] font-bold text-foreground">
        <time dateTime={day.date}>{formatDayHeading(day.date, brand.locale)}</time>
      </h2>
      <ul role="list" className="flex flex-col gap-3">
        {day.entries.map((entry) => (
          <li key={entry.session.id}>
            <SessionCard entry={entry} timezone={timezone} />
          </li>
        ))}
      </ul>
    </section>
  )
}
