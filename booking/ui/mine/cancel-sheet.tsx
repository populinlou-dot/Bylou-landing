"use client"

import { AlertCircle } from "lucide-react"
import { useRef, useState } from "react"
import { cancelBooking, type CancelCode, type CancelResult, type MyBookingEntry } from "../../application"
import { useBooking, useCopy, useReadyRuntime, type Translate } from "../booking-context"
import { ContactLink } from "../contact"
import { formatDayHeading, formatTime } from "../format"
import { newIdempotencyKey } from "../idempotency"
import { buttonClass } from "../primitives"
import { Sheet } from "../sheet"

export type CancelPhase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: CancelCode }

const RETRYABLE: readonly CancelCode[] = ["network_error", "unknown"]

export function cancelFailureMessage(code: CancelCode, hours: number, t: Translate): string {
  switch (code) {
    case "cancellation_too_late":
      return t("cancel.closed", { h: hours })
    case "cancellation_not_allowed":
      return t("reason.cancellation_not_allowed")
    case "not_found":
    case "not_owner":
      return t("error.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("mine.signin")
    case "invalid_input":
      return t("error.generic")
    case "network_error":
    case "unknown":
      return t("cancel.error")
  }
}

export interface CancelSheetViewProps {
  item: MyBookingEntry
  timezone: string
  hours: number
  phase: CancelPhase
  onConfirm: () => void
  onClose: () => void
}

/** S6 cancel dialog (presentational): summary + consequence + "Sí, cancelar" / "No, mantener". */
export function CancelSheetView({ item, timezone, hours, phase, onConfirm, onClose }: CancelSheetViewProps) {
  const { brand } = useBooking()
  const t = useCopy()
  const pending = phase.status === "pending"
  const failed = phase.status === "failed" ? phase.code : null
  const canConfirm = failed === null || RETRYABLE.includes(failed)
  const late = item.cancellation.outcome === "late"

  return (
    <Sheet title={t("cancel.title")} onClose={onClose} closeDisabled={pending}>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? t("cancel.pending") : ""}
      </p>
      <p className="text-[15px] text-foreground">
        <strong className="font-semibold">{item.classType.name}</strong>
        <br />
        <time dateTime={item.session.startsAt}>
          {formatDayHeading(item.localDate, brand.locale)} · {formatTime(item.session.startsAt, timezone, brand.locale)}
        </time>
      </p>
      <p className="text-[15px] font-semibold text-foreground">{late ? t("cancel.late", { h: hours }) : t("cancel.refund")}</p>

      {failed ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px]">
          <p className="flex items-start gap-2 font-semibold text-foreground">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            {cancelFailureMessage(failed, hours, t)}
          </p>
          {failed === "cancellation_too_late" || failed === "cancellation_not_allowed" ? <ContactLink /> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 pt-1">
        {canConfirm ? (
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-button)] bg-destructive px-5 text-[15px] font-semibold text-destructive-foreground disabled:cursor-progress disabled:opacity-70"
          >
            {pending ? t("cancel.pending") : failed ? t("error.retry") : t("cancel.confirm")}
          </button>
        ) : null}
        <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
          {t("cancel.keep")}
        </button>
      </div>
    </Sheet>
  )
}

/** Container: one idempotency key per opened sheet, reused on retry. */
export function CancelSheet({
  item,
  timezone,
  hours,
  onClose,
  onCancelled,
}: {
  item: MyBookingEntry
  timezone: string
  hours: number
  onClose: () => void
  onCancelled: (result: Extract<CancelResult, { ok: true }>) => void
}) {
  const { repository } = useReadyRuntime()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [phase, setPhase] = useState<CancelPhase>({ status: "idle" })
  const inFlight = useRef(false)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await cancelBooking(
      { repository },
      { bookingId: item.booking.id, idempotencyKey, acceptLate: item.cancellation.outcome === "late" },
    )
    inFlight.current = false
    if (result.ok) {
      onCancelled(result)
      return
    }
    if (result.code === "unknown") console.error("[booking] cancel_booking returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return <CancelSheetView item={item} timezone={timezone} hours={hours} phase={phase} onConfirm={confirm} onClose={onClose} />
}
