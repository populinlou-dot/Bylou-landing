"use client"

import { AlertCircle } from "lucide-react"
import { useId, type ReactNode } from "react"
import type { FieldError } from "../application"
import type { Modality } from "../domain"
import { useCopy, type Translate } from "../ui/booking-context"
import { cx } from "../ui/format"

/**
 * Small labelled form controls for the staff forms (Phase 4.2). Every error is text tied to its
 * input through aria-describedby + aria-invalid (never color alone). Values are controlled strings:
 * containers parse them, so a half-typed number never crashes the form.
 */
export const inputClass =
  "min-h-12 w-full rounded-[var(--radius)] border-[1.5px] border-input bg-card px-4 text-[16px] text-foreground aria-[invalid=true]:border-[color:var(--destructive)] disabled:opacity-60"

export function fieldErrorMessage(error: FieldError, t: Translate, range?: { min: number; max: number }): string {
  switch (error) {
    case "required":
      return t("admin.field.required")
    case "too_long":
      return t("admin.field.tooLong")
    case "out_of_range":
      return range ? t("admin.field.range", range) : t("admin.field.invalid")
    case "invalid_url":
      return t("admin.field.url")
    case "in_past":
      return t("admin.field.past")
    case "invalid":
      return t("admin.field.invalid")
  }
}

interface FieldFrameProps {
  label: string
  hint?: string | null
  error?: string | null
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** Label + control + hint + error, wired for screen readers. */
export function FieldFrame({ label, hint, error, children }: FieldFrameProps) {
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[14.5px] font-semibold text-foreground">
        {label}
      </label>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-[13.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-[14px] font-semibold text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  type = "text",
  maxLength,
  disabled,
  inputMode,
  multiline = false,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string | null
  error?: string | null
  type?: "text" | "number" | "date" | "time" | "url"
  maxLength?: number
  disabled?: boolean
  inputMode?: "numeric" | "url" | "text"
  multiline?: boolean
  required?: boolean
}) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      {({ inputId, describedBy, invalid }) =>
        multiline ? (
          <textarea
            id={inputId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            maxLength={maxLength}
            disabled={disabled}
            rows={3}
            className={cx(inputClass, "py-3")}
          />
        ) : (
          <input
            id={inputId}
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-required={required || undefined}
            maxLength={maxLength}
            disabled={disabled}
            inputMode={inputMode}
            className={inputClass}
          />
        )
      }
    </FieldFrame>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  error?: string | null
  disabled?: boolean
}) {
  return (
    <FieldFrame label={label} error={error}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          className={inputClass}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  )
}

const MODALITIES: readonly Modality[] = ["in_person", "online"]

/** Two radio buttons in a fieldset (keyboard: arrow keys move between them natively). */
export function ModalityField({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: string
  value: Modality
  onChange: (value: Modality) => void
  disabled?: boolean
}) {
  const t = useCopy()
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="pb-1.5 text-[14.5px] font-semibold text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {MODALITIES.map((modality) => (
          <label
            key={modality}
            className={cx(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-button)] border-[1.5px] px-4 text-[15px] font-semibold",
              value === modality ? "border-primary bg-secondary text-primary" : "border-input bg-card text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={modality}
              checked={value === modality}
              onChange={() => onChange(modality)}
              className="size-4 accent-[color:var(--primary)]"
            />
            {t(`admin.modality.${modality}`)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function CheckboxField({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string | null
  disabled?: boolean
}) {
  const inputId = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-semibold text-foreground">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hint ? hintId : undefined}
          disabled={disabled}
          className="size-5 shrink-0 accent-[color:var(--primary)]"
        />
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="pl-8 text-[13.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Whole-number input parse: "" or junk → NaN (validation turns that into a field error). */
export function parseWholeNumber(value: string): number {
  return /^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN
}
