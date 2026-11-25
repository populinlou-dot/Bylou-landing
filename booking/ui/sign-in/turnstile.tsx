"use client"

/**
 * Cloudflare Turnstile for the sign-in screen (ADR-024). No npm dependency: a typed loader for
 * the official script (explicit rendering) plus one widget component. The script is requested
 * only when this component mounts, i.e. only on the sign-in screen and only when a site key is
 * configured. The token is single use and valid for 300 s; Supabase Auth verifies it server-side.
 */
import { AlertCircle } from "lucide-react"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useCopy } from "../booking-context"
import { buttonClass } from "../primitives"

export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
/** Offline, blocked by an extension or a hanging request: show the retry message after this. */
export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000

/** Subset of the explicit-rendering options this app uses (developers.cloudflare.com/turnstile). */
export interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  "expired-callback": () => void
  "timeout-callback": () => void
  /** A truthy return marks the error as handled (Turnstile then logs nothing). */
  "error-callback": (code: string) => boolean
  language: string
  theme: "light" | "dark" | "auto"
  size: "normal" | "flexible" | "compact"
  appearance: "always" | "execute" | "interaction-only"
  retry: "auto" | "never"
  "refresh-expired": "auto" | "manual" | "never"
  "response-field": boolean
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

/**
 * Loads the Turnstile script once per page. A failed or timed-out load removes its script tag and
 * is forgotten, so the next call (the "retry" button) starts a fresh request.
 */
export function loadTurnstile(timeoutMs = TURNSTILE_LOAD_TIMEOUT_MS): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script")
    const fail = () => {
      clearTimeout(timer)
      script.remove()
      reject(new Error("turnstile_unavailable"))
    }
    const timer = setTimeout(fail, timeoutMs)
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.dataset.bookingTurnstile = ""
    script.onload = () => {
      clearTimeout(timer)
      if (window.turnstile) resolve(window.turnstile)
      else fail()
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  loading = attempt
  attempt.catch(() => {
    if (loading === attempt) loading = null
  })
  return attempt
}

/** Test hook: forget a cached load between tests. */
export function resetTurnstileLoader(): void {
  loading = null
}

/**
 * Turnstile language for a BCP 47 brand locale. Turnstile has no "es-AR"/"es-419" but supports
 * the two-letter "es"; anything unusable falls back to "auto" (the visitor's browser language).
 */
export function turnstileLanguage(locale: string): string {
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0] ?? ""
  return /^[a-z]{2}$/.test(primary) ? primary : "auto"
}

export interface TurnstileWidgetHandle {
  /** Drop the current token and run a fresh challenge (after every request that spent it). */
  reset(): void
}

export interface TurnstileWidgetProps {
  siteKey: string
  /** Brand locale (BCP 47), mapped with `turnstileLanguage`. */
  locale: string
  /** A fresh token, or null when there is none (consumed, expired, failed). */
  onToken: (token: string | null) => void
  /** Show the "verifying…" line while there is no token (the step whose submit waits for it). */
  showPendingHint: boolean
}

type WidgetStatus = "pending" | "ready" | "failed"

/**
 * Managed widget, `interaction-only`: most visitors never see it; it appears only when Cloudflare
 * needs an interaction. Light theme (the booking theme has no dark mode), `flexible` width so it
 * follows the form. When the script cannot load or the challenge errors, an inline message with a
 * retry button replaces it; the widget never traps focus (it is a normal iframe in tab order).
 */
export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { siteKey, locale, onToken, showPendingHint },
  ref,
) {
  const t = useCopy()
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<TurnstileApi | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const [status, setStatus] = useState<WidgetStatus>("pending")
  /** Bumped by "retry" after a failed script load: re-runs the mount effect. */
  const [loadAttempt, setLoadAttempt] = useState(0)
  const language = turnstileLanguage(locale)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  const resetWidget = useCallback(() => {
    onTokenRef.current(null)
    const api = apiRef.current
    const id = widgetIdRef.current
    if (api && id) {
      setStatus("pending")
      api.reset(id)
    }
  }, [])

  useImperativeHandle(ref, () => ({ reset: resetWidget }), [resetWidget])

  useEffect(() => {
    let active = true
    setStatus("pending")
    loadTurnstile().then(
      (api) => {
        const container = containerRef.current
        if (!active || !container) return
        apiRef.current = api
        const id = api.render(container, {
          sitekey: siteKey,
          language,
          theme: "light",
          size: "flexible",
          appearance: "interaction-only",
          retry: "auto",
          // Expiry (300 s) is handled below with an explicit reset, so there is one owner of it.
          "refresh-expired": "never",
          // The token goes to Supabase through the auth port, not through a hidden form field.
          "response-field": false,
          callback: (token) => {
            setStatus("ready")
            onTokenRef.current(token)
          },
          "expired-callback": () => {
            onTokenRef.current(null)
            setStatus("pending")
            if (widgetIdRef.current) api.reset(widgetIdRef.current)
          },
          // The visitor did not solve an interactive challenge in time; Turnstile resets itself.
          "timeout-callback": () => {
            onTokenRef.current(null)
            setStatus("pending")
          },
          "error-callback": () => {
            onTokenRef.current(null)
            setStatus("failed")
            return true
          },
        })
        widgetIdRef.current = id ?? null
        if (!id) setStatus("failed")
      },
      () => {
        if (active) setStatus("failed")
      },
    )
    return () => {
      active = false
      const api = apiRef.current
      const id = widgetIdRef.current
      widgetIdRef.current = null
      if (api && id) api.remove(id)
      onTokenRef.current(null)
    }
  }, [siteKey, language, loadAttempt])

  const retry = () => {
    if (apiRef.current && widgetIdRef.current) resetWidget()
    else setLoadAttempt((n) => n + 1)
  }

  return (
    <div className="flex flex-col gap-2" data-booking-captcha="">
      <div ref={containerRef} />
      {status === "failed" ? (
        <div className="flex flex-col items-start gap-1">
          <p role="alert" className="flex items-start gap-2 text-[14.5px] font-semibold text-destructive">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("auth.captcha.error")}
          </p>
          <button type="button" onClick={retry} className={buttonClass.link}>
            {t("auth.captcha.retry")}
          </button>
        </div>
      ) : status === "pending" && showPendingHint ? (
        <p className="text-[14px] text-muted-foreground">{t("auth.captcha.pending")}</p>
      ) : null}
    </div>
  )
})
