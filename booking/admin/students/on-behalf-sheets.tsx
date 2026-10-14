"use client"

import { AlertCircle, Ban, CalendarPlus, RotateCw } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  BOOK_FOR_DAYS_AHEAD,
  bookForStudent,
  cancelForStudent,
  listBookableSessions,
  type BookForStudentCode,
  type BookForStudentResult,
  type BookableSession,
  type CancelForStudentCode,
  type CancelForStudentResult,
  type StudentBookingView,
} from "../../application"
import { useBooking, useCopy, useReadyRuntime, type Translate } from "../../ui/booking-context"
import { newIdempotencyKey } from "../../ui/idempotency"
import { SkeletonBlock, buttonClass } from "../../ui/primitives"
import { Sheet } from "../../ui/sheet"
import { useAdminRepository } from "../admin-context"
import { CheckboxField, SelectField } from "../form-fields"
import { sessionWhen } from "./student-format"

const RETRYABLE = ["network_error", "unknown"] as const
const isRetryable = (code: string) => (RETRYABLE as readonly string[]).includes(code)

function FailureAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] font-semibold text-foreground">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      {children}
    </p>
  )
}

/* ---------- Book on behalf (AD-10) ---------- */

export function bookForFailureMessage(code: BookForStudentCode, t: Translate): string {
  switch (code) {
    case "session_full":
      return t("admin.bookFor.sessionFull")
    case "already_booked":
      return t("admin.bookFor.already")
    case "no_valid_credit":
      return t("admin.bookFor.noCredit")
    case "session_started":
      return t("admin.bookFor.started")
    case "session_cancelled":
      return t("admin.bookFor.cancelled")
    case "not_found":
      return t("admin.bookFor.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.bookFor.error")
  }
}

export type BookForSessionsState = { status: "loading" } | { status: "error" } | { status: "ready"; timezone: string; sessions: BookableSession[] }
export type BookForPhase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: BookForStudentCode }

export interface BookForSheetViewProps {
  studentName: string
  sessions: BookForSessionsState
  selected: string
  phase: BookForPhase
  onSelect: (sessionId: string) => void
  onSubmit: () => void
  onRetryLoad: () => void
  onClose: () => void
}

/** Pick a session and book it for the student (presentational). Full sessions are listed but disabled. */
export function BookForSheetView({ studentName, sessions, selected, phase, onSelect, onSubmit, onRetryLoad, onClose }: BookForSheetViewProps) {
  const { brand } = useBooking()
  const t = useCopy()
  const pending = phase.status === "pending"

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  let body: ReactNode
  if (sessions.status === "loading") {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {t("admin.bookFor.loading")}
        </p>
        <SkeletonBlock className="h-12 w-full rounded-[var(--radius)]" />
      </div>
    )
  } else if (sessions.status === "error") {
    body = (
      <div className="flex flex-col items-start gap-3">
        <FailureAlert>{t("admin.bookFor.loadError")}</FailureAlert>
        <button type="button" onClick={onRetryLoad} className={buttonClass.secondary}>
          <RotateCw aria-hidden="true" className="size-4" />
          {t("error.retry")}
        </button>
      </div>
    )
  } else if (sessions.sessions.length === 0) {
    body = <p className="text-[15px] text-muted-foreground">{t("admin.bookFor.none", { days: BOOK_FOR_DAYS_AHEAD })}</p>
  } else {
    const options = sessions.sessions.map((s) => ({
      value: s.session.id,
      label:
        `${sessionWhen(s.session.startsAt, sessions.timezone, brand.locale)} · ${s.classTypeName} ` +
        `(${s.confirmedCount}/${s.session.capacity})${s.isFull ? ` · ${t("admin.bookFor.full")}` : ""}`,
      disabled: s.isFull,
    }))
    body = (
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? t("admin.bookFor.pending") : ""}
        </p>
        <SelectField label={t("admin.bookFor.session")} value={selected} onChange={onSelect} options={options} disabled={pending} />
        {phase.status === "failed" ? <FailureAlert>{bookForFailureMessage(phase.code, t)}</FailureAlert> : null}
        <button
          type="submit"
          disabled={pending || !selected}
          aria-busy={pending}
          className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}
        >
          <CalendarPlus aria-hidden="true" className="size-4" />
          {pending ? t("admin.bookFor.pending") : phase.status === "failed" && isRetryable(phase.code) ? t("error.retry") : t("admin.bookFor.submit")}
        </button>
      </form>
    )
  }

  return (
    <Sheet title={t("admin.bookFor.title", { name: studentName })} onClose={onClose} closeDisabled={pending}>
      <p className="text-[14.5px] text-muted-foreground">{t("admin.bookFor.intro")}</p>
      {body}
      <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
        {t("sheet.back")}
      </button>
    </Sheet>
  )
}

/**
 * Container: loads upcoming sessions, keeps ONE request key per chosen session (a retry for the same
 * session replays; another session gets its own key, since the server rejects a key reused elsewhere).
 */
export function BookForSheet({
  userId,
  studentName,
  onClose,
  onBooked,
}: {
  userId: string
  studentName: string
  onClose: () => void
  onBooked: (result: Extract<BookForStudentResult, { ok: true }>) => void
}) {
  const admin = useAdminRepository()
  const { repository, clock } = useReadyRuntime()
  const [attempt, setAttempt] = useState(0)
  const [sessions, setSessions] = useState<BookForSessionsState>({ status: "loading" })
  const [selected, setSelected] = useState("")
  const [phase, setPhase] = useState<BookForPhase>({ status: "idle" })
  const keys = useRef(new Map<string, string>())
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    setSessions({ status: "loading" })
    listBookableSessions({ admin, repository, clock }).then(
      (result) => {
        if (!active) return
        setSessions({ status: "ready", ...result })
        setSelected((prev) => prev || (result.sessions.find((s) => !s.isFull)?.session.id ?? ""))
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] bookable sessions load failed", error)
        setSessions({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, repository, clock, attempt])

  async function submit() {
    if (inFlight.current || !selected) return
    let requestKey = keys.current.get(selected)
    if (!requestKey) {
      requestKey = newIdempotencyKey()
      keys.current.set(selected, requestKey)
    }
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await bookForStudent({ admin }, { userId, sessionId: selected, requestKey })
    inFlight.current = false
    if (result.ok) {
      onBooked(result)
      return
    }
    if (result.code === "unknown") console.error("[admin] admin_book_for returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return (
    <BookForSheetView
      studentName={studentName}
      sessions={sessions}
      selected={selected}
      phase={phase}
      onSelect={(sessionId) => {
        setSelected(sessionId)
        setPhase({ status: "idle" })
      }}
      onSubmit={() => void submit()}
      onRetryLoad={() => setAttempt((n) => n + 1)}
      onClose={onClose}
    />
  )
}

/* ---------- Cancel on behalf (AD-10) ---------- */

export function cancelForFailureMessage(code: CancelForStudentCode, t: Translate): string {
  switch (code) {
    case "cancellation_not_allowed":
      return t("admin.cancelFor.notAllowed")
    case "not_found":
      return t("admin.cancelFor.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.cancelFor.error")
  }
}

export type CancelForPhase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: CancelForStudentCode }

export interface CancelForSheetViewProps {
  booking: StudentBookingView
  studentName: string
  timezone: string
  refund: boolean
  phase: CancelForPhase
  onRefundChange: (refund: boolean) => void
  onConfirm: () => void
  onClose: () => void
}

/** Confirm dialog: which booking, that the window does not apply, and whether the class goes back. */
export function CancelForSheetView({ booking, studentName, timezone, refund, phase, onRefundChange, onConfirm, onClose }: CancelForSheetViewProps) {
  const { brand } = useBooking()
  const t = useCopy()
  const pending = phase.status === "pending"
  const failed = phase.status === "failed" ? phase.code : null
  const canConfirm = failed === null || isRetryable(failed)

  return (
    <Sheet title={t("admin.cancelFor.title")} onClose={onClose} closeDisabled={pending}>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? t("admin.cancelFor.pending") : ""}
      </p>
      <p className="text-[15px] text-foreground">
        {/* User-entered name: plain text only. */}
        <strong className="font-semibold">{studentName}</strong>
        <br />
        {booking.classTypeName}
        <br />
        <time dateTime={booking.startsAt}>{sessionWhen(booking.startsAt, timezone, brand.locale)}</time>
      </p>
      <p className="text-[14.5px] text-muted-foreground">{t("admin.cancelFor.intro")}</p>
      <CheckboxField
        label={t("admin.cancelFor.refund")}
        hint={t("admin.cancelFor.refundHint")}
        checked={refund}
        onChange={onRefundChange}
        disabled={pending}
      />
      <p className="text-[14.5px] text-muted-foreground">{t("admin.cancelFor.notice")}</p>

      {failed ? <FailureAlert>{cancelForFailureMessage(failed, t)}</FailureAlert> : null}

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
            {pending ? t("admin.cancelFor.pending") : failed ? t("error.retry") : t("admin.cancelFor.confirm")}
          </button>
        ) : null}
        <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
          {t("admin.cancelFor.keep")}
        </button>
      </div>
    </Sheet>
  )
}

/** Container: never optimistic; the RPC is state-idempotent, so a retry cannot refund twice. */
export function CancelForSheet({
  booking,
  studentName,
  timezone,
  onClose,
  onCancelled,
}: {
  booking: StudentBookingView
  studentName: string
  timezone: string
  onClose: () => void
  onCancelled: (result: Extract<CancelForStudentResult, { ok: true }>, refundRequested: boolean) => void
}) {
  const admin = useAdminRepository()
  const [refund, setRefund] = useState(true)
  const [phase, setPhase] = useState<CancelForPhase>({ status: "idle" })
  const inFlight = useRef(false)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await cancelForStudent({ admin }, { bookingId: booking.bookingId, refund })
    inFlight.current = false
    if (result.ok) {
      onCancelled(result, refund)
      return
    }
    if (result.code === "unknown") console.error("[admin] admin_cancel_for returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return (
    <CancelForSheetView
      booking={booking}
      studentName={studentName}
      timezone={timezone}
      refund={refund}
      phase={phase}
      onRefundChange={setRefund}
      onConfirm={() => void confirm()}
      onClose={onClose}
    />
  )
}
