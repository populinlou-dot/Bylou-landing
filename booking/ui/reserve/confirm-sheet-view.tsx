"use client"

import { AlertCircle, CalendarClock, CheckCircle2, UserRound } from "lucide-react"
import Link from "next/link"
import { useId } from "react"
import type { AgendaEntry, BookCode } from "../../application"
import { MY_BOOKINGS_PATH } from "../../application"
import { useBooking, useCopy, type Translate } from "../booking-context"
import { ContactLink } from "../contact"
import { formatDayHeading, formatTime } from "../format"
import { buttonClass } from "../primitives"
import { ModalityIcon, useModalityLabel } from "../session-meta"
import { Sheet } from "../sheet"
import { ProfileNameForm, type ProfileNameFormProps } from "../sign-in/profile-name-view"

export type BalanceState = { status: "loading" } | { status: "ready"; available: number } | { status: "error" }

export type ConfirmPhase =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success" }
  | { status: "failed"; code: BookCode }

export interface ConfirmSheetViewProps {
  entry: AgendaEntry
  timezone: string
  balance: BalanceState
  /** From the DB rules (null until loaded). */
  policyHours: number | null
  creditsPerBooking: number
  phase: ConfirmPhase
  /** Set while she has no display name yet: the required name form replaces the confirm button. */
  nameStep?: Omit<ProfileNameFormProps, "describedBy"> | null
  onConfirm: () => void
  onClose: () => void
}

/** Transport failures where re-sending the SAME idempotency key is safe and useful. */
const RETRYABLE: readonly BookCode[] = ["network_error", "unknown"]

export function bookFailureMessage(code: BookCode, t: Translate): string {
  switch (code) {
    case "session_full":
      return t("error.conflict")
    case "no_valid_credit":
      return t("pack.none")
    case "session_cancelled":
    case "session_started":
    case "booking_not_open":
    case "booking_closed":
    case "already_booked":
      return t(`reason.${code}`)
    case "too_many_changes":
      return t("sheet.tooManyChanges")
    case "profile_incomplete":
      return t("profile.required")
    case "not_found":
      return t("error.notFound")
    case "forbidden":
      return t("error.forbidden")
    case "unauthenticated":
      return t("auth.required")
    case "invalid_input":
      return t("error.generic")
    case "network_error":
    case "unknown":
      return t("sheet.error")
  }
}

/** S2 confirm sheet (presentational). The container owns the idempotency key and the RPC. */
export function ConfirmSheetView(props: ConfirmSheetViewProps) {
  const { entry, timezone, balance, phase } = props
  const { brand } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const nameIntroId = useId()
  const pending = phase.status === "pending"
  const failed = phase.status === "failed" ? phase.code : null
  const nameStep = props.nameStep ?? null
  const noCredit = (balance.status === "ready" && balance.available < props.creditsPerBooking) || failed === "no_valid_credit"
  const canConfirm = phase.status !== "success" && !nameStep && !noCredit && (failed === null || RETRYABLE.includes(failed))

  return (
    <Sheet title={phase.status === "success" ? t("success.title") : entry.classType.name} onClose={props.onClose} closeDisabled={pending}>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? t("sheet.pending") : phase.status === "success" ? t("success.title") : ""}
      </p>

      <ul role="list" className="flex flex-col gap-2 text-[15px] text-foreground">
        {phase.status === "success" ? <li className="font-semibold">{entry.classType.name}</li> : null}
        <li className="flex items-start gap-2">
          <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <time dateTime={entry.session.startsAt} className="font-semibold">
              {formatDayHeading(entry.localDate, brand.locale)}
            </time>
            <br />
            <span className="tabular-nums">
              {formatTime(entry.session.startsAt, timezone, brand.locale)} – {formatTime(entry.session.endsAt, timezone, brand.locale)}
            </span>
          </span>
        </li>
        <li className="flex items-center gap-2">
          <ModalityIcon modality={entry.session.modality} />
          {modalityLabel(entry.session.modality)}
        </li>
        {entry.instructorName ? (
          <li className="flex items-center gap-2">
            <UserRound aria-hidden="true" className="size-4 shrink-0 text-primary" />
            {t("session.instructor", { name: entry.instructorName })}
          </li>
        ) : null}
      </ul>

      {phase.status === "success" ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-[color:var(--success)]">
            <CheckCircle2 aria-hidden="true" className="size-5" />
            {t("mine.confirmed")}
          </p>
          <Link href={MY_BOOKINGS_PATH} className={`${buttonClass.primary} w-full`}>
            {t("success.mine")}
          </Link>
          <button type="button" onClick={props.onClose} className={`${buttonClass.secondary} w-full`}>
            {t("sheet.back")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-border pt-4 text-[15px]">
          {balance.status === "loading" ? <p className="text-muted-foreground">{t("sheet.loadingBalance")}</p> : null}
          {balance.status === "ready" && !noCredit ? <p>{t("sheet.credit", { n: balance.available })}</p> : null}
          {props.policyHours !== null ? <p className="text-muted-foreground">{t("sheet.policy", { h: props.policyHours })}</p> : null}
          {entry.session.modality === "online" ? <p className="text-muted-foreground">{t("sheet.online")}</p> : null}

          {nameStep && !noCredit ? (
            <div className="flex flex-col gap-3 rounded-[var(--radius)] bg-secondary p-4">
              <p id={nameIntroId} className="font-semibold text-foreground">
                {t("profile.required")}
              </p>
              <ProfileNameForm {...nameStep} describedBy={nameIntroId} />
            </div>
          ) : null}

          {noCredit ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-[var(--radius)] bg-secondary p-4">
              <p className="font-semibold text-foreground">{t("pack.none")}</p>
              <ContactLink label={t("pack.none.cta")} />
            </div>
          ) : failed && failed !== "profile_incomplete" ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-[var(--radius)] bg-secondary p-4">
              <p className="flex items-start gap-2 font-semibold text-foreground">
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                {bookFailureMessage(failed, t)}
              </p>
              {failed === "already_booked" ? (
                <Link href={MY_BOOKINGS_PATH} className={buttonClass.link}>
                  {t("success.mine")}
                </Link>
              ) : null}
              {failed === "too_many_changes" ? <ContactLink /> : null}
            </div>
          ) : null}

          {canConfirm ? (
            <button
              type="button"
              onClick={props.onConfirm}
              disabled={pending}
              aria-busy={pending}
              className={`${buttonClass.primary} w-full disabled:cursor-progress disabled:opacity-70`}
            >
              {pending ? t("sheet.pending") : failed ? t("error.retry") : t("sheet.confirm")}
            </button>
          ) : null}
          <button type="button" onClick={props.onClose} disabled={pending} className={`${buttonClass.link} self-center`}>
            {t("sheet.back")}
          </button>
        </div>
      )}
    </Sheet>
  )
}
