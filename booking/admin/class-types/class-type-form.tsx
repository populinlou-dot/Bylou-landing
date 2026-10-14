"use client"

import { AlertCircle } from "lucide-react"
import { useRef, useState, type FormEvent } from "react"
import {
  CAPACITY_RANGE,
  DURATION_RANGE,
  TEXT_LIMITS,
  saveClassType,
  validateClassType,
  type AdminClassTypeView,
  type ClassTypeField,
  type FieldErrors,
  type SaveClassTypeResult,
  type TransportCode,
} from "../../application"
import type { Modality } from "../../domain"
import { useCopy, type Translate } from "../../ui/booking-context"
import { newIdempotencyKey } from "../../ui/idempotency"
import { buttonClass } from "../../ui/primitives"
import { Sheet } from "../../ui/sheet"
import { useAdminRepository } from "../admin-context"
import { CheckboxField, ModalityField, TextField, fieldErrorMessage, parseWholeNumber } from "../form-fields"

export interface ClassTypeFormValues {
  name: string
  description: string
  duration: string
  capacity: string
  modality: Modality
  isPublished: boolean
}

export type SavePhase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: TransportCode }

export function classTypeFormValues(type: AdminClassTypeView | null): ClassTypeFormValues {
  return type
    ? {
        name: type.name,
        description: type.description ?? "",
        duration: String(type.durationMinutes),
        capacity: String(type.defaultCapacity),
        modality: type.defaultModality,
        isPublished: type.isPublished,
      }
    : { name: "", description: "", duration: "60", capacity: "8", modality: "in_person", isPublished: true }
}

function saveFailureMessage(code: TransportCode, t: Translate): string {
  if (code === "forbidden") return t("error.forbidden")
  if (code === "unauthenticated") return t("admin.guard.signIn")
  return t("admin.classType.error")
}

export interface ClassTypeFormViewProps {
  mode: "create" | "edit"
  values: ClassTypeFormValues
  errors: FieldErrors<ClassTypeField>
  phase: SavePhase
  onChange: (patch: Partial<ClassTypeFormValues>) => void
  onSubmit: () => void
  onClose: () => void
}

/** Create/edit/archive form in a sheet (presentational). */
export function ClassTypeFormView({ mode, values, errors, phase, onChange, onSubmit, onClose }: ClassTypeFormViewProps) {
  const t = useCopy()
  const pending = phase.status === "pending"
  const fieldError = (field: ClassTypeField, range?: { min: number; max: number }) => {
    const error = errors[field]
    return error ? fieldErrorMessage(error, t, range) : null
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Sheet title={mode === "create" ? t("admin.classType.createTitle") : t("admin.classType.editTitle")} onClose={onClose} closeDisabled={pending}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={pending}>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? t("admin.classType.pending") : ""}
        </p>
        <TextField
          label={t("admin.classType.name")}
          value={values.name}
          onChange={(name) => onChange({ name })}
          error={fieldError("name")}
          maxLength={TEXT_LIMITS.className}
          disabled={pending}
          required
        />
        <TextField
          label={t("admin.classType.description")}
          value={values.description}
          onChange={(description) => onChange({ description })}
          error={fieldError("description")}
          maxLength={TEXT_LIMITS.description}
          disabled={pending}
          multiline
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("admin.classType.duration")}
            type="number"
            inputMode="numeric"
            value={values.duration}
            onChange={(duration) => onChange({ duration })}
            error={fieldError("durationMinutes", DURATION_RANGE)}
            disabled={pending}
            required
          />
          <TextField
            label={t("admin.classType.capacity")}
            type="number"
            inputMode="numeric"
            value={values.capacity}
            onChange={(capacity) => onChange({ capacity })}
            error={fieldError("defaultCapacity", CAPACITY_RANGE)}
            disabled={pending}
            required
          />
        </div>
        <ModalityField
          legend={t("admin.classType.modality")}
          value={values.modality}
          onChange={(modality) => onChange({ modality })}
          disabled={pending}
        />
        <CheckboxField
          label={t("admin.classType.published")}
          hint={t("admin.classType.archiveHint")}
          checked={values.isPublished}
          onChange={(isPublished) => onChange({ isPublished })}
          disabled={pending}
        />

        {phase.status === "failed" ? (
          <p role="alert" className="flex items-start gap-2 rounded-[var(--radius)] bg-secondary p-4 text-[15px] font-semibold text-foreground">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            {saveFailureMessage(phase.code, t)}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 pt-1">
          <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}>
            {pending ? t("admin.classType.pending") : phase.status === "failed" ? t("error.retry") : t("admin.classType.submit")}
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
 * Container: one client-generated id per "new" form, reused on every retry, so a double submit or
 * a retry after a network error updates the row it created instead of adding a duplicate.
 */
export function ClassTypeFormSheet({
  initial,
  onClose,
  onSaved,
}: {
  initial: AdminClassTypeView | null
  onClose: () => void
  onSaved: (result: Extract<SaveClassTypeResult, { ok: true }>) => void
}) {
  const admin = useAdminRepository()
  const [id] = useState(() => initial?.id ?? newIdempotencyKey())
  const [values, setValues] = useState(() => classTypeFormValues(initial))
  const [errors, setErrors] = useState<FieldErrors<ClassTypeField>>({})
  const [phase, setPhase] = useState<SavePhase>({ status: "idle" })
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    const cmd = {
      id,
      name: values.name,
      description: values.description,
      durationMinutes: parseWholeNumber(values.duration),
      defaultCapacity: parseWholeNumber(values.capacity),
      defaultModality: values.modality,
      isPublished: values.isPublished,
    }
    const found = validateClassType(cmd)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await saveClassType({ admin }, cmd)
    inFlight.current = false
    if (result.ok) {
      onSaved(result)
      return
    }
    if (result.code === "unknown") console.error("[admin] admin_upsert_class_type returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return (
    <ClassTypeFormView
      mode={initial ? "edit" : "create"}
      values={values}
      errors={errors}
      phase={phase}
      onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  )
}
