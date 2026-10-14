"use client"

import { AlertCircle, ShieldAlert, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  CONFIRM_EMAIL_MAX,
  anonymizeStudent,
  eraseConfirmationKind,
  validateEraseConfirmation,
  type EraseTarget,
  type AnonymizeStudentCode,
  type AnonymizeStudentResult,
} from "../../application"
import { useCopy, type Translate } from "../../ui/booking-context"
import { buttonClass } from "../../ui/primitives"
import { Sheet } from "../../ui/sheet"
import { useAdminRepository } from "../admin-context"
import { TextField } from "../form-fields"

const RETRYABLE: readonly AnonymizeStudentCode[] = ["network_error", "unknown"]

/** The field's mismatch message, worded for what the staff member was asked to type. */
export function eraseMismatchMessage(target: EraseTarget, t: Translate): string {
  return eraseConfirmationKind(target) === "email" ? t("admin.erase.mismatch") : t("admin.erase.mismatchOther")
}

/** Sheet-level failures. `email_mismatch` is shown on the field instead (see `fieldError`). */
export function eraseFailureMessage(code: AnonymizeStudentCode, t: Translate): string {
  switch (code) {
    case "has_upcoming_bookings":
      return t("admin.erase.upcoming")
    case "email_mismatch":
      return t("admin.erase.mismatch")
    case "not_found":
      return t("admin.erase.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.erase.error")
  }
}

export type ErasePhase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: AnonymizeStudentCode }

export interface EraseSheetViewProps {
  studentName: string
  /** What the typed confirmation is checked against: her email, else her name or her id. */
  target: EraseTarget
  typed: string
  /** Client-side field error (empty / does not match), shown only after a submit. */
  fieldError: string | null
  phase: ErasePhase
  onType: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

/** Destructive confirm sheet (presentational): typed email (or name / id) as a typo guard, then the RPC. */
export function EraseSheetView({ studentName, target, typed, fieldError, phase, onType, onSubmit, onClose }: EraseSheetViewProps) {
  const t = useCopy()
  const pending = phase.status === "pending"
  const failed = phase.status === "failed" ? phase.code : null
  // A server-side mismatch belongs to the field, like the client-side one.
  const error = fieldError ?? (failed === "email_mismatch" ? eraseMismatchMessage(target, t) : null)
  const sheetFailure = failed && failed !== "email_mismatch" ? failed : null
  const canSubmit = sheetFailure === null || RETRYABLE.includes(sheetFailure)
  const kind = eraseConfirmationKind(target)
  const label = kind === "email" ? t("admin.erase.email") : t("admin.erase.other")
  const hint =
    kind === "email"
      ? t("admin.erase.emailHint", { email: target.email ?? "" })
      : kind === "name_or_id"
        ? t("admin.erase.nameHint", { name: target.displayName?.trim() ?? "", id: target.userId })
        : t("admin.erase.idHint", { id: target.userId })
  const formRef = useRef<HTMLFormElement>(null)

  // A field error is not a live region: move focus to the field so its description (the error) is read.
  useEffect(() => {
    if (error) formRef.current?.querySelector("input")?.focus()
  }, [error])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (canSubmit) onSubmit()
  }

  return (
    <Sheet title={t("admin.erase.title", { name: studentName })} onClose={onClose} closeDisabled={pending}>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? t("admin.erase.pending") : ""}
      </p>
      <p className="text-[15px] text-foreground">{t("admin.erase.body")}</p>
      {/* The app cannot touch Auth: the owner still has to ban the user (SUPABASE_SETUP.md §10). */}
      <p className="flex items-start gap-2 rounded-[var(--radius)] border border-border bg-accent p-3 text-[14.5px] font-semibold text-accent-foreground">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("admin.erase.after")}
      </p>

      <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
          <TextField
            label={label}
            hint={hint}
            value={typed}
            onChange={onType}
            error={error}
            maxLength={CONFIRM_EMAIL_MAX}
            disabled={pending}
            required
          />
          {sheetFailure ? (
            <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] font-semibold text-foreground">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              {eraseFailureMessage(sheetFailure, t)}
            </p>
          ) : null}
          {canSubmit ? (
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-button)] bg-destructive px-5 text-[15px] font-semibold text-destructive-foreground disabled:cursor-progress disabled:opacity-70"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {pending ? t("admin.erase.pending") : sheetFailure ? t("error.retry") : t("admin.erase.confirm")}
            </button>
          ) : null}
      </form>
      <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
        {t("admin.erase.keep")}
      </button>
    </Sheet>
  )
}

/** Container: validates the typed confirmation, then one idempotent RPC call (never optimistic). */
export function EraseSheet({
  target,
  studentName,
  onClose,
  onErased,
}: {
  target: EraseTarget
  studentName: string
  onClose: () => void
  onErased: (result: Extract<AnonymizeStudentResult, { ok: true }>) => void
}) {
  const admin = useAdminRepository()
  const t = useCopy()
  const [typed, setTyped] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [phase, setPhase] = useState<ErasePhase>({ status: "idle" })
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    const invalid = validateEraseConfirmation(typed, target)
    if (invalid) {
      setFieldError(invalid === "required" ? t("admin.field.required") : eraseMismatchMessage(target, t))
      return
    }
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await anonymizeStudent({ admin }, { userId: target.userId, confirmEmail: typed })
    inFlight.current = false
    if (result.ok) {
      onErased(result)
      return
    }
    if (result.code === "unknown") console.error("[admin] admin_anonymize_student returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return (
    <EraseSheetView
      studentName={studentName}
      target={target}
      typed={typed}
      fieldError={fieldError}
      phase={phase}
      onType={(value) => {
        setTyped(value)
        setFieldError(null)
        if (phase.status === "failed" && phase.code === "email_mismatch") setPhase({ status: "idle" })
      }}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  )
}
