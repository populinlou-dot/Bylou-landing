"use client"

import { AlertCircle, ArrowLeft, CalendarCheck2, Plus, RotateCw } from "lucide-react"
import Link from "next/link"
import type { FormEvent } from "react"
import {
  ADMIN_CLASS_TYPES_PATH,
  CAPACITY_RANGE,
  DURATION_RANGE,
  MAX_REPEAT_WEEKS,
  TEXT_LIMITS,
  adminDayHref,
  type CreateSessionsCode,
  type FieldErrors,
  type NewSessionForm,
  type SessionField,
  type SessionOccurrence,
} from "../../application"
import type { Modality } from "../../domain"
import { useBooking, useCopy, type Translate } from "../../ui/booking-context"
import { formatDayHeading, formatTime } from "../../ui/format"
import { SkeletonBlock, StatusPanel, buttonClass } from "../../ui/primitives"
import { CheckboxField, ModalityField, SelectField, TextField, fieldErrorMessage } from "../form-fields"

export interface NewSessionValues {
  classTypeId: string
  date: string
  time: string
  duration: string
  capacity: string
  modality: Modality
  address: string
  locationLabel: string
  meetingUrl: string
  instructorName: string
  repeat: boolean
  weeks: string
}

export type NewSessionLoadState = { status: "loading" } | { status: "error" } | { status: "ready"; form: NewSessionForm }

export type NewSessionPhase =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failed"; code: CreateSessionsCode }
  | { status: "done"; count: number; replayed: boolean; firstDate: string }

function failureMessage(code: CreateSessionsCode, t: Translate): string {
  switch (code) {
    case "not_found":
      return t("admin.newSession.notFound")
    case "invalid_input":
      return t("admin.newSession.invalid")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.newSession.error")
  }
}

function BackToDay({ date }: { date?: string }) {
  const t = useCopy()
  return (
    <Link href={adminDayHref(date)} className={buttonClass.link}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t("admin.session.back")}
    </Link>
  )
}

export interface NewSessionViewProps {
  load: NewSessionLoadState
  values: NewSessionValues
  errors: FieldErrors<SessionField>
  phase: NewSessionPhase
  /** Occurrences the current values would create (empty while date/time are incomplete). */
  occurrences: SessionOccurrence[]
  onChange: (patch: Partial<NewSessionValues>) => void
  onClassTypeChange: (classTypeId: string) => void
  onSubmit: () => void
  onAnother: () => void
  onRetryLoad: () => void
}

/** A2 "Nueva clase" (`/admin/nueva-clase/?dia=`): presentational form for one or N weekly sessions. */
export function NewSessionView(props: NewSessionViewProps) {
  const { load, onRetryLoad } = props
  const t = useCopy()

  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {t("admin.newSession.loading")}
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <SkeletonBlock className="h-9 w-48" />
          <SkeletonBlock className="h-64 w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
    )
  }

  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-5">
        <BackToDay />
        <StatusPanel
          role="alert"
          titleAs="h1"
          icon={<AlertCircle className="size-5" />}
          title={t("admin.newSession.loadError")}
          action={
            <button type="button" onClick={onRetryLoad} className={buttonClass.primary}>
              <RotateCw aria-hidden="true" className="size-4" />
              {t("error.retry")}
            </button>
          }
        />
      </div>
    )
  }

  if (load.form.classTypes.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <BackToDay />
        <StatusPanel
          role="status"
          titleAs="h1"
          title={t("admin.newSession.title")}
          action={
            <Link href={ADMIN_CLASS_TYPES_PATH} className={buttonClass.primary}>
              {t("admin.classTypes.new")}
            </Link>
          }
        >
          {t("admin.newSession.noClassTypes")}
        </StatusPanel>
      </div>
    )
  }

  if (props.phase.status === "done") return <NewSessionDone phase={props.phase} onAnother={props.onAnother} />

  return <NewSessionFormContent {...props} form={load.form} />
}

function NewSessionDone({ phase, onAnother }: { phase: Extract<NewSessionPhase, { status: "done" }>; onAnother: () => void }) {
  const t = useCopy()
  const title = phase.replayed
    ? t("admin.newSession.replayed")
    : phase.count === 1
      ? t("admin.newSession.success.one")
      : t("admin.newSession.success.many", { n: phase.count })
  return (
    <StatusPanel
      role="status"
      titleAs="h1"
      icon={<CalendarCheck2 className="size-5" />}
      title={title}
      action={
        <div className="flex flex-wrap gap-2">
          <Link href={adminDayHref(phase.firstDate)} className={buttonClass.primary}>
            {t("admin.newSession.viewDay")}
          </Link>
          <button type="button" onClick={onAnother} className={buttonClass.secondary}>
            <Plus aria-hidden="true" className="size-4" />
            {t("admin.newSession.another")}
          </button>
        </div>
      }
    />
  )
}

function NewSessionFormContent({
  form,
  values,
  errors,
  phase,
  occurrences,
  onChange,
  onClassTypeChange,
  onSubmit,
}: NewSessionViewProps & { form: NewSessionForm }) {
  const { brand } = useBooking()
  const t = useCopy()
  const pending = phase.status === "pending"
  const fieldError = (field: SessionField, range?: { min: number; max: number }) => {
    const error = errors[field]
    return error ? fieldErrorMessage(error, t, range) : null
  }
  const count = values.repeat ? occurrences.length : Math.min(occurrences.length, 1)
  const shown = values.repeat ? occurrences : occurrences.slice(0, 1)
  const hasErrors = Object.keys(errors).length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="admin-new-session-title">
      <BackToDay date={values.date || undefined} />
      <h1 id="admin-new-session-title" className="[font-family:var(--font-display)] text-[28px] font-medium leading-tight text-foreground">
        {t("admin.newSession.title")}
      </h1>

      <form
        noValidate
        onSubmit={submit}
        aria-busy={pending}
        className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-card p-4 [box-shadow:var(--shadow-card)] sm:p-6"
      >
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? t("admin.newSession.pending") : ""}
        </p>
        <SelectField
          label={t("admin.newSession.classType")}
          value={values.classTypeId}
          onChange={onClassTypeChange}
          options={form.classTypes.map((ct) => ({ value: ct.id, label: ct.name }))}
          error={fieldError("classTypeId")}
          disabled={pending}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("admin.newSession.date")}
            type="date"
            value={values.date}
            onChange={(date) => onChange({ date })}
            error={fieldError("localDate")}
            disabled={pending}
            required
          />
          <TextField
            label={t("admin.newSession.time")}
            type="time"
            value={values.time}
            onChange={(time) => onChange({ time })}
            hint={t("admin.newSession.timeHint")}
            error={fieldError("localStart")}
            disabled={pending}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("admin.newSession.duration")}
            type="number"
            inputMode="numeric"
            value={values.duration}
            onChange={(duration) => onChange({ duration })}
            error={fieldError("durationMinutes", DURATION_RANGE)}
            disabled={pending}
            required
          />
          <TextField
            label={t("admin.newSession.capacity")}
            type="number"
            inputMode="numeric"
            value={values.capacity}
            onChange={(capacity) => onChange({ capacity })}
            error={fieldError("capacity", CAPACITY_RANGE)}
            disabled={pending}
            required
          />
        </div>
        <ModalityField
          legend={t("admin.newSession.modality")}
          value={values.modality}
          onChange={(modality) => onChange({ modality })}
          disabled={pending}
        />
        {values.modality === "in_person" ? (
          <>
            <TextField
              label={t("admin.newSession.address")}
              value={values.address}
              onChange={(address) => onChange({ address })}
              hint={t("admin.newSession.addressHint")}
              error={fieldError("address")}
              maxLength={TEXT_LIMITS.address}
              disabled={pending}
              required
            />
            <TextField
              label={t("admin.newSession.locationLabel")}
              value={values.locationLabel}
              onChange={(locationLabel) => onChange({ locationLabel })}
              error={fieldError("locationLabel")}
              maxLength={TEXT_LIMITS.locationLabel}
              disabled={pending}
            />
          </>
        ) : (
          <TextField
            label={t("admin.newSession.meetingUrl")}
            type="url"
            inputMode="url"
            value={values.meetingUrl}
            onChange={(meetingUrl) => onChange({ meetingUrl })}
            hint={t("admin.newSession.meetingUrlHint")}
            error={fieldError("meetingUrl")}
            maxLength={TEXT_LIMITS.meetingUrl}
            disabled={pending}
            required
          />
        )}
        <TextField
          label={t("admin.newSession.instructor")}
          value={values.instructorName}
          onChange={(instructorName) => onChange({ instructorName })}
          error={fieldError("instructorName")}
          maxLength={TEXT_LIMITS.instructorName}
          disabled={pending}
        />
        <CheckboxField
          label={t("admin.newSession.repeat")}
          checked={values.repeat}
          onChange={(repeat) => onChange({ repeat })}
          disabled={pending}
        />
        {values.repeat ? (
          <TextField
            label={t("admin.newSession.weeks", { max: MAX_REPEAT_WEEKS })}
            type="number"
            inputMode="numeric"
            value={values.weeks}
            onChange={(weeks) => onChange({ weeks })}
            error={fieldError("repeatWeeks", { min: 1, max: MAX_REPEAT_WEEKS })}
            disabled={pending}
            required
          />
        ) : null}

        {shown.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-[var(--radius)] bg-secondary p-4 text-[14.5px] text-foreground">
            <p className="font-semibold">
              {count === 1 ? t("admin.newSession.preview.one") : t("admin.newSession.preview.many", { n: count })}
            </p>
            <ul role="list" className="flex flex-col gap-0.5">
              {shown.map((o) => (
                <li key={o.startsAt}>
                  <time dateTime={o.startsAt}>
                    {formatDayHeading(o.localDate, brand.locale)} · {formatTime(o.startsAt, form.timezone, brand.locale)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase.status === "failed" ? (
          <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] font-semibold text-foreground">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            {failureMessage(phase.code, t)}
          </p>
        ) : hasErrors ? (
          <p role="alert" className="text-[14.5px] font-semibold text-destructive">
            {t("admin.newSession.fixErrors")}
          </p>
        ) : null}

        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}>
          {pending
            ? t("admin.newSession.pending")
            : count > 1
              ? t("admin.newSession.submit.many", { n: count })
              : t("admin.newSession.submit.one")}
        </button>
      </form>
    </section>
  )
}
