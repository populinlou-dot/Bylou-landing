"use client"

import { AlertCircle, Hourglass } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState, type MouseEvent } from "react"
import {
  joinWaitlist,
  leaveWaitlist,
  saveDisplayName,
  sessionHref,
  signInHref,
  type AgendaEntry,
  type WaitlistCode,
} from "../../application"
import { useAuthState, useCopy, useReadyRuntime, type Translate } from "../booking-context"
import { ContactLink } from "../contact"
import { cx } from "../format"
import { newIdempotencyKey } from "../idempotency"
import { buttonClass } from "../primitives"
import { ProfileNameForm, type ProfileNameError } from "../sign-in/profile-name-view"
import { useDataRefresh } from "./refresh-context"

/** Why a join/leave did not go through, in the brand's words. `hours` = the studio's cancellation window. */
export function waitlistFailureMessage(code: WaitlistCode, t: Translate, hours: number | null): string {
  switch (code) {
    case "session_not_full":
      return t("waitlist.notFull")
    case "waitlist_closed":
      return hours === null ? t("reason.booking_closed") : t("waitlist.closed", { h: hours })
    case "already_booked":
    case "session_cancelled":
    case "session_started":
    case "booking_not_open":
    case "booking_closed":
      return t(`reason.${code}`)
    case "too_many_changes":
      return t("waitlist.tooManyChanges")
    case "waitlist_full":
      return t("waitlist.full")
    case "too_many_waitlists":
      return t("waitlist.tooMany")
    case "profile_incomplete":
      return t("profile.required")
    case "not_found":
      return t("error.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("auth.required")
    case "waitlist_disabled":
    case "invalid_input":
    case "network_error":
    case "unknown":
      return t("waitlist.error")
  }
}

type Phase = { status: "idle" } | { status: "pending" } | { status: "failed"; code: WaitlistCode } | { status: "name" }

/**
 * Waitlist controls for a full session (Phase 4.4, PRD ST-12), driven by `entry.action`:
 * - join_waitlist → "Anotarme en la lista" (signed out → sign-in, back to the session)
 * - waiting       → "Estás en la lista de espera · lugar N" + "Salir de la lista"
 * The server decides everything (FIFO, the owner rule, idempotency); the session is re-read after each change.
 * No notifications exist in the MVP: a promotion shows up the next time she opens the app (Mis reservas).
 * `hours` (session detail only) adds the rule / closed-window explanations.
 */
export function WaitlistAction({
  entry,
  hours,
  describedBy,
  fullWidth = false,
}: {
  entry: AgendaEntry
  hours: number | null
  describedBy?: string
  fullWidth?: boolean
}) {
  const t = useCopy()
  const auth = useAuthState()
  const router = useRouter()
  const refresh = useDataRefresh()
  const { repository } = useReadyRuntime()
  const [phase, setPhase] = useState<Phase>({ status: "idle" })
  const [notice, setNotice] = useState("")
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<ProfileNameError | null>(null)
  const [savingName, setSavingName] = useState(false)
  // One key per join attempt, reused on retries of that attempt (double tap → one entry).
  const joinKey = useRef<string | null>(null)
  const inFlight = useRef(false)
  const actionRef = useRef<HTMLButtonElement>(null)
  const focusAction = useRef(false)
  const ruleId = useId()
  const waiting = entry.action === "waiting"
  const pending = phase.status === "pending"

  // After join/leave the button changes; keep keyboard focus on the new control.
  useEffect(() => {
    if (!focusAction.current || pending) return
    focusAction.current = false
    actionRef.current?.focus()
  }, [entry.action, pending])

  async function join() {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ status: "pending" })
    setNotice("")
    joinKey.current ??= newIdempotencyKey()
    const result = await joinWaitlist({ repository }, { sessionId: entry.session.id, requestKey: joinKey.current })
    inFlight.current = false
    if (result.ok) {
      joinKey.current = null
      focusAction.current = true
      setPhase({ status: "idle" })
      refresh(entry.session.id)
      return
    }
    if (result.code === "unauthenticated") {
      router.push(signInHref(sessionHref(entry.session.id)))
      return
    }
    if (result.code === "profile_incomplete") {
      setPhase({ status: "name" })
      return
    }
    // A definitive refusal will not change with the same key; network failures keep it for the retry.
    if (result.code !== "network_error" && result.code !== "unknown") joinKey.current = null
    if (result.code === "unknown") console.error("[booking] join_waitlist returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
    // The session changed under her (a spot opened, it was cancelled…): show the fresh state.
    if (result.code === "session_not_full" || result.code === "already_booked") refresh(entry.session.id)
  }

  async function leave() {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ status: "pending" })
    setNotice("")
    const result = await leaveWaitlist({ repository }, entry.session.id)
    inFlight.current = false
    if (result.ok) {
      focusAction.current = true
      setPhase({ status: "idle" })
      setNotice(result.status === "promoted" ? t("waitlist.promoted") : t("waitlist.left"))
      refresh(entry.session.id)
      return
    }
    if (result.code === "unauthenticated") {
      router.push(signInHref(sessionHref(entry.session.id)))
      return
    }
    setPhase({ status: "failed", code: result.code })
  }

  async function saveName() {
    setSavingName(true)
    setNameError(null)
    const result = await saveDisplayName({ repository }, name)
    setSavingName(false)
    if (result.ok) {
      setPhase({ status: "idle" })
      void join()
      return
    }
    if (result.code === "empty" || result.code === "too_long" || result.code === "invalid_chars") {
      setNameError(result.code)
      return
    }
    console.error("[booking] display name save failed", result.code)
    setNameError("save")
  }

  function start(event: MouseEvent<HTMLButtonElement>) {
    if (auth.status === "loading") return
    event.currentTarget.focus()
    if (auth.status === "signed_out") {
      router.push(signInHref(sessionHref(entry.session.id)))
      return
    }
    void (waiting ? leave() : join())
  }

  const describers = [describedBy, hours !== null && !waiting ? ruleId : null].filter(Boolean).join(" ") || undefined
  // One polite region: her place while she waits (announced when she joins), else the last outcome.
  const position = waiting ? entry.myWaitlistPosition : null
  const status = position !== null ? t("waitlist.joined", { n: position }) : notice

  return (
    <div className={cx("flex flex-col gap-2", !fullWidth && "items-start")}>
      <p
        role="status"
        aria-live="polite"
        className={cx(
          "flex items-center gap-1.5 text-[14.5px] font-semibold empty:hidden",
          position !== null ? "text-foreground" : "text-[color:var(--success)]",
        )}
      >
        {position !== null ? <Hourglass aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
        {status}
      </p>
      {waiting && !entry.waitlistOpen && hours !== null ? (
        <p className="text-[14px] text-muted-foreground">{t("waitlist.closedHint", { h: hours })}</p>
      ) : null}

      {phase.status === "name" ? (
        <div className="flex w-full flex-col gap-3 rounded-[var(--radius)] bg-secondary p-4">
          <p id={ruleId} className="font-semibold text-foreground">
            {t("profile.required")}
          </p>
          <ProfileNameForm
            name={name}
            pending={savingName}
            error={nameError}
            describedBy={ruleId}
            onNameChange={(value) => {
              setName(value)
              if (nameError) setNameError(null)
            }}
            onSubmit={() => void saveName()}
          />
        </div>
      ) : (
        <button
          ref={actionRef}
          type="button"
          onClick={start}
          disabled={pending}
          aria-busy={pending}
          aria-describedby={describers}
          aria-disabled={auth.status === "loading" ? true : undefined}
          className={cx(
            waiting ? buttonClass.secondary : buttonClass.primary,
            fullWidth ? "w-full" : "self-start",
            "disabled:cursor-progress disabled:opacity-70",
          )}
        >
          {pending ? (waiting ? t("waitlist.leaving") : t("waitlist.joining")) : waiting ? t("waitlist.leave") : t("waitlist.join")}
        </button>
      )}

      {hours !== null && !waiting && phase.status !== "name" ? (
        <p id={ruleId} className="text-[14px] text-muted-foreground">
          {t("waitlist.rule", { h: hours })}
        </p>
      ) : null}

      {phase.status === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-1 text-[14.5px] font-semibold text-foreground">
          <p className="flex items-start gap-2">
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            {waitlistFailureMessage(phase.code, t, hours)}
          </p>
          {phase.code === "too_many_changes" ? <ContactLink /> : null}
        </div>
      ) : null}

    </div>
  )
}
