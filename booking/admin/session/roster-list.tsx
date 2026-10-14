"use client"

import { Check, Loader2, X } from "lucide-react"
import { useId } from "react"
import { rosterLabel, type AttendanceMark, type RosterEntry } from "../../application"
import type { AttendanceWindow } from "../../domain"
import { useCopy } from "../../ui/booking-context"
import { cx } from "../../ui/format"
import { Badge } from "../../ui/primitives"

export interface RowAttendanceState {
  /** Mark being saved (server round-trip in flight). Writes are never optimistic. */
  pending: AttendanceMark | null
  error: string | null
}

const MARKS = ["attended", "no_show"] as const

const markButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-button)] border-[1.5px] px-3.5 text-[14px] font-semibold transition-colors duration-[var(--dur)] ease-[var(--ease)] disabled:cursor-not-allowed disabled:opacity-60"

export function RosterList({
  roster,
  window,
  rows,
  onMark,
}: {
  roster: RosterEntry[]
  window: AttendanceWindow
  rows: Readonly<Record<string, RowAttendanceState>>
  onMark: (entry: RosterEntry, mark: AttendanceMark) => void
}) {
  return (
    <ul role="list" className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
      {roster.map((entry) => (
        <li key={entry.bookingId} className="p-4">
          <RosterRow entry={entry} window={window} row={rows[entry.bookingId]} onMark={(mark) => onMark(entry, mark)} />
        </li>
      ))}
    </ul>
  )
}

function RosterRow({
  entry,
  window,
  row,
  onMark,
}: {
  entry: RosterEntry
  window: AttendanceWindow
  row: RowAttendanceState | undefined
  onMark: (mark: AttendanceMark) => void
}) {
  const t = useCopy()
  const nameId = useId()
  const errorId = useId()
  // Plain text only: React escapes it. Never dangerouslySetInnerHTML (security review).
  const name = rosterLabel(entry) ?? t("admin.roster.noName")
  const confirmed = entry.status === "confirmed"
  const pending = row?.pending ?? null

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={nameId} className={cx("text-[15.5px] font-semibold", confirmed ? "text-foreground" : "text-muted-foreground")}>
          {name}
        </p>
        <Badge tone={confirmed ? "brand" : "neutral"}>
          {confirmed
            ? t("admin.roster.confirmed")
            : entry.status === "late_cancelled"
              ? t("admin.roster.lateCancelled")
              : t("admin.roster.cancelled")}
        </Badge>
      </div>

      {confirmed ? (
        <div
          role="group"
          aria-label={t("admin.attendance.legend", { name })}
          aria-describedby={row?.error ? errorId : undefined}
          aria-busy={pending !== null}
          className="flex flex-wrap items-center gap-2"
        >
          {MARKS.map((mark) => {
            const selected = entry.attendance === mark
            const isPending = pending === mark
            const Icon = isPending ? Loader2 : mark === "attended" ? Check : X
            return (
              <button
                key={mark}
                type="button"
                aria-pressed={selected}
                disabled={window !== "open" || pending !== null}
                onClick={() => {
                  if (!selected) onMark(mark)
                }}
                className={cx(
                  markButton,
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-primary hover:bg-secondary",
                )}
              >
                <Icon aria-hidden="true" className={cx("size-4", isPending && "motion-safe:animate-spin")} />
                {isPending ? t("admin.attendance.pending") : t(`admin.attendance.${mark}`)}
              </button>
            )
          })}
          {entry.attendance === "unknown" && pending === null ? (
            <span className="text-[13.5px] text-muted-foreground">{t("admin.attendance.unknown")}</span>
          ) : null}
        </div>
      ) : null}

      {row?.error ? (
        <p id={errorId} role="alert" className="text-[14px] font-semibold text-destructive">
          {row.error}
        </p>
      ) : null}
    </div>
  )
}
