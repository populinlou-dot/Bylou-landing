"use client"

import { AlertCircle, CalendarClock, CalendarHeart, Hourglass, LogIn, RotateCw, Sparkles, UserRound } from "lucide-react"
import Link from "next/link"
import { useId } from "react"
import {
  AGENDA_PATH,
  MY_BOOKINGS_PATH,
  localDateOf,
  signInHref,
  type HistoryOutcome,
  type MyAccount,
  type MyBookingEntry,
  type MyWaitlistItem,
} from "../../application"
import { useBooking, useCopy, type Translate } from "../booking-context"
import { CalendarActions } from "../calendar-actions"
import { ContactLink } from "../contact"
import { formatDayHeading, formatDayMonth, formatTime } from "../format"
import { Badge, DisplayTitle, Eyebrow, SkeletonBlock, StatusPanel, buttonClass, type BadgeTone } from "../primitives"
import { ModalityIcon, useModalityLabel } from "../session-meta"
import { PrivateDetails } from "../session/session-detail-view"

export type MyBookingsLoadState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "error" }
  | { status: "ready"; account: MyAccount }

export interface MyBookingsViewProps {
  load: MyBookingsLoadState
  /** Polite confirmation after a cancellation or leaving a waitlist (toast). */
  notice: string | null
  onRetry: () => void
  onCancel: (item: MyBookingEntry) => void
  /** Waitlist entry being left (its button is busy). */
  leaving?: string | null
  leaveError?: { entryId: string; message: string } | null
  onLeave?: (item: MyWaitlistItem) => void
}

interface WaitlistProps {
  leaving: string | null
  leaveError: { entryId: string; message: string } | null
  onLeave: (item: MyWaitlistItem) => void
}

/** S5 "Mis reservas": pack balance, upcoming (with cancel rules) and history. */
export function MyBookingsView({
  load,
  notice,
  onRetry,
  onCancel,
  leaving = null,
  leaveError = null,
  onLeave = () => {},
}: MyBookingsViewProps) {
  const t = useCopy()

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-2">
        <Eyebrow>{t("agenda.eyebrow")}</Eyebrow>
        <DisplayTitle className="text-[clamp(30px,8vw,46px)]">{t("mine.title")}</DisplayTitle>
      </header>

      <p role="status" aria-live="polite" className="text-[15px] font-semibold text-[color:var(--success)] empty:hidden">
        {notice ?? ""}
      </p>

      {load.status === "loading" ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <p className="sr-only">{t("mine.loading")}</p>
          <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
          <SkeletonBlock className="h-36 w-full rounded-[var(--radius-card)]" />
        </div>
      ) : null}

      {load.status === "signed_out" ? (
        <StatusPanel
          icon={<LogIn className="size-5" />}
          title={t("mine.signin")}
          action={
            <Link href={signInHref(MY_BOOKINGS_PATH)} className={buttonClass.primary}>
              {t("auth.signIn")}
            </Link>
          }
        />
      ) : null}

      {load.status === "error" ? (
        <StatusPanel
          role="alert"
          icon={<AlertCircle className="size-5" />}
          title={t("mine.error")}
          action={
            <button type="button" onClick={onRetry} className={buttonClass.primary}>
              <RotateCw aria-hidden="true" className="size-4" />
              {t("error.retry")}
            </button>
          }
        />
      ) : null}

      {load.status === "ready" ? (
        <AccountContent account={load.account} onCancel={onCancel} waitlist={{ leaving, leaveError, onLeave }} />
      ) : null}
    </div>
  )
}

function AccountContent({
  account,
  onCancel,
  waitlist,
}: {
  account: MyAccount
  onCancel: (item: MyBookingEntry) => void
  waitlist: WaitlistProps
}) {
  const t = useCopy()
  const upcomingId = useId()
  const historyId = useId()
  const waitlistId = useId()
  return (
    <>
      <PackSummary account={account} />

      <section aria-labelledby={upcomingId} className="flex flex-col gap-3">
        <h2 id={upcomingId} className="text-[17px] font-bold text-foreground">
          {t("mine.upcoming")}
        </h2>
        {account.upcoming.length === 0 ? (
          <StatusPanel
            icon={<CalendarHeart className="size-5" />}
            title={t("mine.empty")}
            action={
              <Link href={AGENDA_PATH} className={buttonClass.secondary}>
                {t("mine.browse")}
              </Link>
            }
          />
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {account.upcoming.map((item) => (
              <li key={item.booking.id}>
                <BookingCard item={item} account={account} onCancel={onCancel} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {account.waitlist.length > 0 ? (
        <section aria-labelledby={waitlistId} className="flex flex-col gap-3">
          <h2 id={waitlistId} className="text-[17px] font-bold text-foreground">
            {t("mine.waitlist")}
          </h2>
          <ul role="list" className="flex flex-col gap-3">
            {account.waitlist.map((item) => (
              <li key={item.entryId}>
                <WaitlistCard item={item} account={account} {...waitlist} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {account.history.length > 0 ? (
        <section aria-labelledby={historyId} className="flex flex-col gap-3">
          <h2 id={historyId} className="text-[17px] font-bold text-foreground">
            {t("mine.history")}
          </h2>
          <ul role="list" className="flex flex-col gap-3">
            {account.history.map((item) => (
              <li key={item.booking.id}>
                <BookingCard item={item} account={account} onCancel={onCancel} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

function PackSummary({ account }: { account: MyAccount }) {
  const { brand } = useBooking()
  const t = useCopy()
  const { balance } = account
  return (
    <section
      aria-label={t("pack.title")}
      className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-border bg-card p-5 [box-shadow:var(--shadow-card)]"
    >
      <p className="text-[11.5px] font-bold uppercase tracking-[0.22em] text-primary">{t("pack.title")}</p>
      {balance.available > 0 ? (
        <>
          <p className="text-[17px] font-semibold text-foreground">
            {balance.available === 1 ? t("pack.available.one") : t("pack.available.many", { n: balance.available })}
          </p>
          {balance.nextExpiry ? (
            <p className="text-[14.5px] text-muted-foreground">
              {t("pack.expiry", { date: formatDayMonth(localDateOf(balance.nextExpiry, account.timezone), brand.locale) })}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-[16px] font-semibold text-foreground">{t("pack.none")}</p>
          <ContactLink label={t("pack.none.cta")} />
        </>
      )}
    </section>
  )
}

function historyBadge(outcome: HistoryOutcome, t: Translate): { label: string; tone: BadgeTone } {
  switch (outcome) {
    case "attended":
      return { label: t("history.attended"), tone: "success" }
    case "absent":
      return { label: t("history.absent"), tone: "neutral" }
    case "cancelled":
      return { label: t("history.cancelled"), tone: "neutral" }
    case "session_cancelled":
      return { label: t("session.cancelled"), tone: "danger" }
    case "finished":
      return { label: t("session.past"), tone: "neutral" }
  }
}

function BookingCard({
  item,
  account,
  onCancel,
}: {
  item: MyBookingEntry
  account: MyAccount
  onCancel: (item: MyBookingEntry) => void
}) {
  const { brand } = useBooking()
  const t = useCopy()
  const modalityLabel = useModalityLabel()
  const titleId = useId()
  const { session } = item
  const tz = account.timezone
  const badge = item.historyOutcome ? historyBadge(item.historyOutcome, t) : { label: t("mine.confirmed"), tone: "brand" as const }

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-5 [box-shadow:var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2 text-[15px] font-semibold text-foreground">
          <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <time dateTime={session.startsAt}>
            {formatDayHeading(item.localDate, brand.locale)} · {formatTime(session.startsAt, tz, brand.locale)}
          </time>
        </p>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <h3 id={titleId} className="[font-family:var(--font-display)] text-[21px] font-medium leading-tight text-foreground">
        {item.classType.name}
      </h3>
      <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1 text-[14.5px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <ModalityIcon modality={session.modality} />
          {modalityLabel(session.modality)}
        </li>
        {item.instructorName ? (
          <li className="flex items-center gap-1.5">
            <UserRound aria-hidden="true" className="size-4 shrink-0 text-primary" />
            {t("session.instructor", { name: item.instructorName })}
          </li>
        ) : null}
      </ul>

      {item.historyOutcome === null && item.source === "waitlist" ? (
        <p className="flex items-start gap-2 text-[14.5px] font-semibold text-[color:var(--success)]">
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("waitlist.promoted")}
        </p>
      ) : null}

      {item.privateDetails ? <PrivateDetails details={item.privateDetails} /> : null}

      {item.historyOutcome === null ? (
        <CalendarActions
          session={session}
          classTypeName={item.classType.name}
          instructorName={item.instructorName}
          privateDetails={item.privateDetails}
          timezone={tz}
          describedBy={titleId}
        />
      ) : null}

      {item.historyOutcome === null ? <CancelArea item={item} account={account} onCancel={onCancel} /> : null}
    </article>
  )
}

/**
 * A class she is waiting for (place + "Salir de la lista"), or one she was passed over for because she had
 * no valid pack when the spot opened (she may join again). Promotions appear as bookings above.
 */
function WaitlistCard({ item, account, leaving, leaveError, onLeave }: { item: MyWaitlistItem; account: MyAccount } & WaitlistProps) {
  const { brand } = useBooking()
  const t = useCopy()
  const titleId = useId()
  const errorId = useId()
  const tz = account.timezone
  const waiting = item.status === "waiting"
  const busy = leaving === item.entryId
  const error = leaveError?.entryId === item.entryId ? leaveError.message : null

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-5 [box-shadow:var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2 text-[15px] font-semibold text-foreground">
          <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <time dateTime={item.session.startsAt}>
            {formatDayHeading(item.localDate, brand.locale)} · {formatTime(item.session.startsAt, tz, brand.locale)}
          </time>
        </p>
        <Badge tone="neutral">{t("mine.waitlist")}</Badge>
      </div>
      <h3 id={titleId} className="[font-family:var(--font-display)] text-[21px] font-medium leading-tight text-foreground">
        {item.classTypeName}
      </h3>
      {waiting && item.position !== null ? (
        <p className="flex items-center gap-1.5 text-[14.5px] font-semibold text-foreground">
          <Hourglass aria-hidden="true" className="size-4 shrink-0 text-primary" />
          {t("waitlist.joined", { n: item.position })}
        </p>
      ) : null}
      {waiting && !item.promotionOpen ? (
        <p className="text-[14px] text-muted-foreground">{t("waitlist.closedHint", { h: account.rules.cancellationWindowHours })}</p>
      ) : null}
      {item.status === "skipped" ? (
        <p className="text-[14.5px] text-foreground">
          {item.skipReason === "no_valid_credit" ? t("waitlist.skipped") : t("waitlist.skippedOther")}
        </p>
      ) : null}
      {waiting ? (
        <div className="flex flex-col items-start gap-1 border-t border-border pt-3">
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus()
              onLeave(item)
            }}
            disabled={busy}
            aria-busy={busy}
            aria-describedby={error ? errorId : undefined}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline disabled:cursor-progress disabled:opacity-70"
          >
            {busy ? t("waitlist.leaving") : t("waitlist.leave")}
          </button>
          {error ? (
            <p id={errorId} role="alert" className="flex items-start gap-2 text-[14.5px] font-semibold text-foreground">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/**
 * Cancel affordance from the domain preview (same policy the RPC enforces):
 * refund / late (allow_without_refund) → button; Bylou "deny" inside the window → no button,
 * contact copy instead (UX_DESIGN S6); started/not allowed → reason only.
 */
function CancelArea({
  item,
  account,
  onCancel,
}: {
  item: MyBookingEntry
  account: MyAccount
  onCancel: (item: MyBookingEntry) => void
}) {
  const t = useCopy()
  const { cancellation } = item
  if (cancellation.outcome === "denied") {
    return (
      <div className="flex flex-col items-start gap-1 border-t border-border pt-3 text-[14.5px] text-muted-foreground">
        <p>
          {cancellation.code === "cancellation_too_late"
            ? t("cancel.closed", { h: account.rules.cancellationWindowHours })
            : t("reason.cancellation_not_allowed")}
        </p>
        <ContactLink />
      </div>
    )
  }
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.focus() // Safari: make this the sheet's focus-return target
          onCancel(item)
        }}
        className="inline-flex min-h-11 items-center font-semibold text-destructive underline-offset-4 hover:underline"
      >
        {t("cancel.cta")}
      </button>
    </div>
  )
}
