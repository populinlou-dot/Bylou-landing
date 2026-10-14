"use client"

import { AlertCircle } from "lucide-react"
import { useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  ADJUST_AMOUNT_RANGE,
  NOTE_MAX,
  PACK_CREDITS_RANGE,
  PACK_VALID_DAYS_MAX,
  adjustAmountMax,
  adjustCredits,
  defaultPackExpiry,
  grantPack,
  validateAdjustDraft,
  validateGrantDraft,
  type AdjustCreditsCode,
  type AdjustCreditsResult,
  type AdjustDirection,
  type AdjustField,
  type AdminGrantView,
  type FieldErrors,
  type GrantCreditsCode,
  type GrantCreditsResult,
  type GrantField,
  type LocalDate,
} from "../../application"
import { useBooking, useCopy, useReadyRuntime, type Translate } from "../../ui/booking-context"
import { newIdempotencyKey } from "../../ui/idempotency"
import { buttonClass } from "../../ui/primitives"
import { Sheet } from "../../ui/sheet"
import { useAdminRepository } from "../admin-context"
import { RadioGroupField, TextField, fieldErrorMessage, parseWholeNumber } from "../form-fields"
import { packLastDay } from "./student-format"

type Phase<C> = { status: "idle" } | { status: "pending" } | { status: "failed"; code: C; creditsRemaining?: number }

function FailureAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] font-semibold text-foreground">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      {children}
    </p>
  )
}

/* ---------- Grant a pack (AD-08) ---------- */

export interface GrantFormValues {
  credits: string
  expiresOn: string
  note: string
}

function grantFailureMessage(code: GrantCreditsCode, t: Translate): string {
  switch (code) {
    case "not_found":
      return t("admin.grant.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.grant.error")
  }
}

export interface GrantPackSheetViewProps {
  studentName: string
  values: GrantFormValues
  errors: FieldErrors<GrantField>
  phase: Phase<GrantCreditsCode>
  onChange: (patch: Partial<GrantFormValues>) => void
  onSubmit: () => void
  onClose: () => void
}

/** "Cargar pack" form (presentational). Copy states that nothing is charged here (ADR-006). */
export function GrantPackSheetView({ studentName, values, errors, phase, onChange, onSubmit, onClose }: GrantPackSheetViewProps) {
  const t = useCopy()
  const pending = phase.status === "pending"
  const expiresError = (() => {
    switch (errors.expiresOn) {
      case undefined:
        return null
      case "in_past":
        return t("admin.grant.pastDate")
      case "out_of_range":
        return t("admin.grant.tooFar", { max: PACK_VALID_DAYS_MAX })
      default:
        return fieldErrorMessage(errors.expiresOn, t)
    }
  })()

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Sheet title={t("admin.grant.title")} onClose={onClose} closeDisabled={pending}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? t("admin.grant.pending") : ""}
        </p>
        {/* User-entered name: plain text only. */}
        <p className="text-[15px] font-semibold text-foreground">{studentName}</p>
        <p className="text-[14.5px] text-muted-foreground">{t("admin.grant.intro")}</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("admin.grant.credits")}
            type="number"
            inputMode="numeric"
            value={values.credits}
            onChange={(credits) => onChange({ credits })}
            error={errors.credits ? fieldErrorMessage(errors.credits, t, PACK_CREDITS_RANGE) : null}
            disabled={pending}
            required
          />
          <TextField
            label={t("admin.grant.expiresOn")}
            type="date"
            value={values.expiresOn}
            onChange={(expiresOn) => onChange({ expiresOn })}
            hint={t("admin.grant.expiresHint")}
            error={expiresError}
            disabled={pending}
            required
          />
        </div>
        <TextField
          label={t("admin.grant.note")}
          value={values.note}
          onChange={(note) => onChange({ note })}
          warning={t("admin.grant.noteWarning")}
          error={errors.note ? fieldErrorMessage(errors.note, t) : null}
          maxLength={NOTE_MAX}
          disabled={pending}
        />

        {phase.status === "failed" ? <FailureAlert>{grantFailureMessage(phase.code, t)}</FailureAlert> : null}

        <div className="flex flex-col gap-2 pt-1">
          <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}>
            {pending ? t("admin.grant.pending") : phase.status === "failed" ? t("error.retry") : t("admin.grant.submit")}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
            {t("sheet.back")}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/**
 * Container: one request key per opened sheet, reused on every retry, so a double submit or a retry
 * after a network error returns the pack already granted instead of granting it twice.
 */
export function GrantPackSheet({
  userId,
  studentName,
  timezone,
  today,
  onClose,
  onGranted,
}: {
  userId: string
  studentName: string
  timezone: string
  today: LocalDate
  onClose: () => void
  onGranted: (result: Extract<GrantCreditsResult, { ok: true }>) => void
}) {
  const admin = useAdminRepository()
  const { clock } = useReadyRuntime()
  const [requestKey] = useState(newIdempotencyKey)
  const [values, setValues] = useState<GrantFormValues>(() => ({ credits: "4", expiresOn: defaultPackExpiry(today), note: "" }))
  const [errors, setErrors] = useState<FieldErrors<GrantField>>({})
  const [phase, setPhase] = useState<Phase<GrantCreditsCode>>({ status: "idle" })
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    const draft = { credits: parseWholeNumber(values.credits), expiresOn: values.expiresOn, note: values.note }
    const found = validateGrantDraft(draft, { today })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await grantPack({ admin, clock }, { userId, draft, requestKey }, { timezone })
    inFlight.current = false
    if (result.ok) {
      onGranted(result)
      return
    }
    if (result.code === "unknown") console.error("[admin] grant_credits returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return (
    <GrantPackSheetView
      studentName={studentName}
      values={values}
      errors={errors}
      phase={phase}
      onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  )
}

/* ---------- Adjust credits (AD-08.2) ---------- */

export interface AdjustFormValues {
  direction: AdjustDirection
  amount: string
  reason: string
}

function adjustFailureMessage(code: AdjustCreditsCode, remaining: number, t: Translate): string {
  switch (code) {
    case "insufficient_balance":
      return t("admin.adjust.insufficient", { n: remaining })
    case "adjust_exceeds_pack":
      return t("admin.adjust.exceeds")
    case "grant_expired":
      return t("admin.adjust.expired")
    case "not_found":
      return t("admin.adjust.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.adjust.error")
  }
}

export interface AdjustCreditsSheetViewProps {
  grant: AdminGrantView
  timezone: string
  values: AdjustFormValues
  errors: FieldErrors<AdjustField>
  phase: Phase<AdjustCreditsCode>
  onChange: (patch: Partial<AdjustFormValues>) => void
  onSubmit: () => void
  onClose: () => void
}

/** ± credits on one pack with a mandatory reason (presentational). */
export function AdjustCreditsSheetView({ grant, timezone, values, errors, phase, onChange, onSubmit, onClose }: AdjustCreditsSheetViewProps) {
  const { brand } = useBooking()
  const t = useCopy()
  const pending = phase.status === "pending"
  const max = adjustAmountMax(values.direction, grant)
  const amountError = errors.amount
    ? max === 0
      ? t("admin.adjust.nothing")
      : fieldErrorMessage(errors.amount, t, { min: ADJUST_AMOUNT_RANGE.min, max: Math.min(max, ADJUST_AMOUNT_RANGE.max) })
    : null

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Sheet title={t("admin.adjust.title")} onClose={onClose} closeDisabled={pending}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? t("admin.adjust.pending") : ""}
        </p>
        <p className="text-[15px] font-semibold text-foreground">
          {t("admin.student.pack", {
            remaining: grant.remaining,
            total: grant.total,
            date: packLastDay(grant.expiresAt, timezone, brand.locale),
          })}
        </p>
        <RadioGroupField
          legend={t("admin.adjust.direction")}
          value={values.direction}
          options={[
            { value: "remove", label: t("admin.adjust.remove") },
            { value: "add", label: t("admin.adjust.add") },
          ]}
          onChange={(direction) => onChange({ direction })}
          disabled={pending}
        />
        <div className="w-40">
          <TextField
            label={t("admin.adjust.amount")}
            type="number"
            inputMode="numeric"
            value={values.amount}
            onChange={(amount) => onChange({ amount })}
            error={amountError}
            disabled={pending}
            required
          />
        </div>
        <TextField
          label={t("admin.adjust.reason")}
          value={values.reason}
          onChange={(reason) => onChange({ reason })}
          warning={t("admin.adjust.reasonWarning")}
          error={errors.reason ? fieldErrorMessage(errors.reason, t) : null}
          maxLength={NOTE_MAX}
          disabled={pending}
          multiline
          required
        />

        {phase.status === "failed" ? (
          <FailureAlert>{adjustFailureMessage(phase.code, phase.creditsRemaining ?? grant.remaining, t)}</FailureAlert>
        ) : null}

        <div className="flex flex-col gap-2 pt-1">
          <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}>
            {pending ? t("admin.adjust.pending") : t("admin.adjust.submit")}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className={`${buttonClass.secondary} w-full`}>
            {t("sheet.back")}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/** Container: never optimistic; one request key per opened sheet, so a retry cannot apply twice. */
export function AdjustCreditsSheet({
  grant,
  timezone,
  onClose,
  onAdjusted,
}: {
  grant: AdminGrantView
  timezone: string
  onClose: () => void
  onAdjusted: (result: Extract<AdjustCreditsResult, { ok: true }>) => void
}) {
  const admin = useAdminRepository()
  const [requestKey] = useState(newIdempotencyKey)
  const [values, setValues] = useState<AdjustFormValues>(() => ({
    direction: grant.remaining > 0 ? "remove" : "add",
    amount: "1",
    reason: "",
  }))
  const [errors, setErrors] = useState<FieldErrors<AdjustField>>({})
  const [phase, setPhase] = useState<Phase<AdjustCreditsCode>>({ status: "idle" })
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    const draft = { grantId: grant.id, direction: values.direction, amount: parseWholeNumber(values.amount), reason: values.reason }
    const found = validateAdjustDraft(draft, grant)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await adjustCredits({ admin }, { draft, grant, requestKey })
    inFlight.current = false
    if (result.ok) {
      onAdjusted(result)
      return
    }
    if (result.code === "unknown") console.error("[admin] admin_adjust_credits returned an unmapped result")
    setPhase({ status: "failed", code: result.code, creditsRemaining: result.creditsRemaining })
  }

  return (
    <AdjustCreditsSheetView
      grant={grant}
      timezone={timezone}
      values={values}
      errors={errors}
      phase={phase}
      onChange={(patch) => {
        setValues((prev) => ({ ...prev, ...patch }))
        setErrors({})
      }}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  )
}
