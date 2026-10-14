"use client"

import { AlertCircle, Ban } from "lucide-react"
import { useRef, useState, type FormEvent } from "react"
import {
  CAPACITY_RANGE,
  cancelSession,
  minimumCapacity,
  type AdminDayEntry,
  type CancelSessionCode,
  type CancelSessionResult,
  type UpdateSessionCode,
} from "../../application"
import { useBooking, useCopy, type Translate } from "../../ui/booking-context"
import { formatDayHeading, formatTime } from "../../ui/format"
import { buttonClass } from "../../ui/primitives"
import { Sheet } from "../../ui/sheet"
import { useAdminRepository } from "../admin-context"
import { TextField } from "../form-fields"

/* ---------- Capacity (AD-05.1) ---------- */

export type CapacityPhase =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "invalid" }
  | { status: "failed"; code: UpdateSessionCode; confirmedCount?: number }

export function capacityFailureMessage(code: UpdateSessionCode, confirmedCount: number, t: Translate): string {
  switch (code) {
    case "capacity_below_bookings":
      return t("admin.capacity.below", { n: confirmedCount })
    case "session_started":
      return t("admin.capacity.started")
    case "session_cancelled":
      return t("admin.capacity.cancelled")
    case "not_found":
      return t("admin.session.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    case "invalid_input":
      return t("admin.field.range", CAPACITY_RANGE)
    default:
      return t("admin.capacity.error")
  }
}

/** Inline capacity editor (presentational). The server is the authority on the minimum. */
export function CapacityEditor({
  value,
  confirmedCount,
  phase,
  onChange,
  onSubmit,
}: {
  value: string
  confirmedCount: number
  phase: CapacityPhase
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  const t = useCopy()
  const pending = phase.status === "pending"
  const error =
    phase.status === "invalid"
      ? t("admin.field.range", { min: minimumCapacity(confirmedCount), max: CAPACITY_RANGE.max })
      : phase.status === "failed"
        ? capacityFailureMessage(phase.code, phase.confirmedCount ?? confirmedCount, t)
        : null

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form noValidate onSubmit={submit} aria-busy={pending} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <TextField
            label={t("admin.capacity.label")}
            type="number"
            inputMode="numeric"
            value={value}
            onChange={onChange}
            disabled={pending}
            error={error}
          />
        </div>
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass.secondary} disabled:cursor-progress disabled:opacity-70`}>
          {pending ? t("admin.capacity.pending") : t("admin.capacity.save")}
        </button>
      </div>
      {confirmedCount > 0 ? <p className="text-[13.5px] text-muted-foreground">{t("admin.capacity.hint", { n: confirmedCount })}</p> : null}
    </form>
  )
}

/* ---------- Cancel session (AD-05.2) ---------- */

export type CancelSessionPhase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: CancelSessionCode }

function cancelFailureMessage(code: CancelSessionCode, t: Translate): string {
  switch (code) {
    case "not_found":
      return t("admin.session.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.cancelSession.error")
  }
}

const RETRYABLE: readonly CancelSessionCode[] = ["network_error", "unknown"]

export interface CancelSessionSheetViewProps {
  entry: AdminDayEntry
  timezone: string
  phase: CancelSessionPhase
  onConfirm: () => void
  onClose: () => void
}

/** Confirm dialog: what is cancelled, how many students are affected, and that credits go back. */
export function CancelSessionSheetView({ entry, timezone, phase, onConfirm, onClose }: CancelSessionSheetViewProps) {
  const { brand } = useBooking()
  const t = useCopy()
  const pending = phase.status === "pending"
  const failed = phase.status === "failed" ? phase.code : null
  const canConfirm = failed === null || RETRYABLE.includes(failed)
  const n = entry.confirmedCount
  const affected =
    n === 0
      ? t("admin.cancelSession.affected.none")
      : n === 1
        ? t("admin.cancelSession.affected.one")
        : t("admin.cancelSession.affected.many", { n })

  return (
    <Sheet title={t("admin.cancelSession.title")} onClose={onClose} closeDisabled={pending}>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? t("admin.cancelSession.pending") : ""}
      </p>
      <p className="text-[15px] text-foreground">
        <strong className="font-semibold">{entry.classTypeName}</strong>
        <br />
        <time dateTime={entry.session.startsAt}>
          {formatDayHeading(entry.localDate, brand.locale)} · {formatTime(entry.session.startsAt, timezone, brand.locale)}
        </time>
      </p>
      <p className="text-[15px] font-semibold text-foreground">{affected}</p>
      {n > 0 ? <p className="text-[14.5px] text-muted-foreground">{t("admin.cancelSession.notice")}</p> : null}

      {failed ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] font-semibold text-foreground">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          {cancelFailureMessage(failed, t)}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 pt-1">
        {canConfirm ? (
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-button)] bg-destructive px-5 text-[15px] font-semibold text-destructive-foreground disabled:cursor-progress disabled:opacity-70"
          >
            <Ban aria-hidden="true" className="size-4" />
            {pending ? t("admin.cancelSession.pending") : failed ? t("error.retry") : t("admin.cancelSession.confirm")}
          </button>
        ) : null}
        <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
          {t("admin.cancelSession.keep")}
        </button>
      </div>
    </Sheet>
  )
}

/** Container: never optimistic; the RPC is state-idempotent, so a retry cannot refund twice. */
export function CancelSessionSheet({
  entry,
  timezone,
  onClose,
  onCancelled,
}: {
  entry: AdminDayEntry
  timezone: string
  onClose: () => void
  onCancelled: (result: Extract<CancelSessionResult, { ok: true }>) => void
}) {
  const admin = useAdminRepository()
  const [phase, setPhase] = useState<CancelSessionPhase>({ status: "idle" })
  const inFlight = useRef(false)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await cancelSession({ admin }, { sessionId: entry.session.id })
    inFlight.current = false
    if (result.ok) {
      onCancelled(result)
      return
    }
    if (result.code === "unknown") console.error("[admin] admin_cancel_session returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return <CancelSessionSheetView entry={entry} timezone={timezone} phase={phase} onConfirm={() => void confirm()} onClose={onClose} />
}
