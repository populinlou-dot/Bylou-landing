"use client"

import { AlertCircle, Mail } from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, type FormEvent } from "react"
import type { AuthCode } from "../../application"
import { useCopy } from "../booking-context"
import { DisplayTitle, Eyebrow, buttonClass } from "../primitives"

export type SignInStep = "email" | "code"

export interface SignInViewProps {
  step: SignInStep
  email: string
  code: string
  pending: boolean
  error: AuthCode | null
  /** Seconds until "Reenviar código" is allowed again. */
  cooldown: number
  /** Mock adapter only: the fixed demo code, shown on screen. */
  demoCode: string | null
  /** Polite confirmation after a resend. */
  notice: string | null
  onEmailChange: (value: string) => void
  onCodeChange: (value: string) => void
  onSubmitEmail: () => void
  onSubmitCode: () => void
  onResend: () => void
  onChangeEmail: () => void
}

const inputClass =
  "min-h-12 w-full rounded-[var(--radius)] border-[1.5px] border-input bg-card px-4 text-[16px] text-foreground aria-[invalid=true]:border-[color:var(--destructive)]"

/** S3 sign-in (`/reservas/ingresar/`): email → 6-digit code on the same page (ADR-004). */
export function SignInView(props: SignInViewProps) {
  const t = useCopy()
  const fieldId = useId()
  const errorId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  // The form is server-rendered in dev (and interactive before hydration): adopt anything typed
  // before React took over, otherwise the next render of the controlled input would wipe it.
  const adoptTypedEmail = useRef({ step: props.step, email: props.email, onEmailChange: props.onEmailChange })
  useEffect(() => {
    const node = inputRef.current
    const initial = adoptTypedEmail.current
    if (initial.step === "email" && node && node.value !== initial.email) initial.onEmailChange(node.value)
  }, [])

  // Moving between steps (or failing) puts focus on the field that needs attention. Layout effects:
  // focus moves in the same commit that shows the field (a passive effect ran a task later, so the
  // new input was briefly on screen without focus — the source of a flaky test).
  useLayoutEffect(() => {
    if (props.step === "code") inputRef.current?.focus()
  }, [props.step])
  useLayoutEffect(() => {
    if (props.error) inputRef.current?.focus()
  }, [props.error])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (props.pending) return
    if (props.step === "email") props.onSubmitEmail()
    else props.onSubmitCode()
  }

  const describedBy = [props.step === "code" ? hintId : null, props.error ? errorId : null].filter(Boolean).join(" ") || undefined

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Eyebrow>{t("agenda.eyebrow")}</Eyebrow>
        <DisplayTitle className="text-[clamp(30px,8vw,42px)]">{t("auth.title")}</DisplayTitle>
        <p className="text-[15.5px] text-muted-foreground">
          {props.step === "email" ? t("auth.intro") : t("auth.code", { email: props.email })}
        </p>
      </header>

      <form
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-card p-5 [box-shadow:var(--shadow-card)] sm:p-7"
      >
        {props.step === "code" && props.demoCode ? (
          <p role="note" className="rounded-[var(--radius)] bg-accent p-3 text-[14.5px] text-accent-foreground">
            {t("auth.demoCode", { code: props.demoCode })}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="text-[14.5px] font-semibold text-foreground">
            {props.step === "email" ? t("auth.email.label") : t("auth.code.label")}
          </label>
          {props.step === "email" ? (
            <input
              ref={inputRef}
              id={fieldId}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={props.email}
              onChange={(e) => props.onEmailChange(e.target.value)}
              aria-invalid={props.error ? true : undefined}
              aria-describedby={describedBy}
              className={inputClass}
            />
          ) : (
            <input
              ref={inputRef}
              id={fieldId}
              type="text"
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={props.code}
              onChange={(e) => props.onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={props.error ? true : undefined}
              aria-describedby={describedBy}
              className={`${inputClass} text-center text-[22px] tracking-[0.4em] tabular-nums`}
            />
          )}
          {props.step === "code" ? (
            <p id={hintId} className="sr-only">
              {t("auth.code", { email: props.email })}
            </p>
          ) : null}
        </div>

        {props.error ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-[14.5px] font-semibold text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t(`auth.error.${props.error}`)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={props.pending}
          aria-busy={props.pending}
          className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}
        >
          {props.step === "email" ? <Mail aria-hidden="true" className="size-4" /> : null}
          {props.pending
            ? props.step === "email"
              ? t("auth.sending")
              : t("auth.verifying")
            : props.step === "email"
              ? t("auth.email.submit")
              : t("auth.code.submit")}
        </button>

        {props.step === "code" ? (
          <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={props.onResend}
              disabled={props.cooldown > 0 || props.pending}
              className={`${buttonClass.link} disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline`}
            >
              {props.cooldown > 0 ? t("auth.resend.wait", { s: props.cooldown }) : t("auth.resend")}
            </button>
            <button type="button" onClick={props.onChangeEmail} disabled={props.pending} className={buttonClass.link}>
              {t("auth.changeEmail")}
            </button>
          </div>
        ) : null}

        <p role="status" aria-live="polite" className="text-[14px] text-muted-foreground empty:hidden">
          {props.notice ?? ""}
        </p>
      </form>
    </div>
  )
}
