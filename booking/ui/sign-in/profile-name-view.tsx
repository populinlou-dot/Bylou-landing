"use client"

import { AlertCircle } from "lucide-react"
import { useId, useLayoutEffect, useRef, type FormEvent } from "react"
import { DISPLAY_NAME_MAX, type DisplayNameError } from "../../application"
import { useCopy } from "../booking-context"
import { DisplayTitle, Eyebrow, buttonClass } from "../primitives"

/** Validation codes from `validateDisplayName`, plus "save" for a failed request. */
export type ProfileNameError = DisplayNameError | "save"

export interface ProfileNameViewProps {
  name: string
  pending: boolean
  error: ProfileNameError | null
  onNameChange: (value: string) => void
  onSubmit: () => void
  onSkip: () => void
}

const inputClass =
  "min-h-12 w-full rounded-[var(--radius)] border-[1.5px] border-input bg-card px-4 text-[16px] text-foreground aria-[invalid=true]:border-[color:var(--destructive)]"

/** Optional step after the first sign-in: "¿Cómo te llamamos?" (save or skip). */
export function ProfileNameView(props: ProfileNameViewProps) {
  const t = useCopy()
  const fieldId = useId()
  const introId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  // The step replaces the code form: move focus to its only field, and back to it on an error.
  useLayoutEffect(() => {
    inputRef.current?.focus()
  }, [])
  useLayoutEffect(() => {
    if (props.error) inputRef.current?.focus()
  }, [props.error])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!props.pending) props.onSubmit()
  }

  const errorText =
    props.error === "save"
      ? t("profile.error.save")
      : props.error === "too_long"
        ? t("profile.error.too_long", { max: DISPLAY_NAME_MAX })
        : props.error
          ? t(`profile.error.${props.error}`)
          : null

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Eyebrow>{t("agenda.eyebrow")}</Eyebrow>
        <DisplayTitle className="text-[clamp(30px,8vw,42px)]">{t("profile.title")}</DisplayTitle>
        <p id={introId} className="text-[15.5px] text-muted-foreground">
          {t("profile.intro")}
        </p>
      </header>

      <form
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-card p-5 [box-shadow:var(--shadow-card)] sm:p-7"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-[14.5px] font-semibold text-foreground">
            {t("profile.label")}
          </label>
          <input
            ref={inputRef}
            id={fieldId}
            type="text"
            name="name"
            autoComplete="given-name"
            value={props.name}
            onChange={(e) => props.onNameChange(e.target.value)}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={[introId, props.error ? errorId : null].filter(Boolean).join(" ")}
            className={inputClass}
          />
        </div>

        {errorText ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-[14.5px] font-semibold text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {errorText}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={props.pending}
          aria-busy={props.pending}
          className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}
        >
          {props.pending ? t("profile.saving") : t("profile.save")}
        </button>
        <button type="button" onClick={props.onSkip} disabled={props.pending} className={`${buttonClass.link} self-center`}>
          {t("profile.skip")}
        </button>
      </form>
    </div>
  )
}
