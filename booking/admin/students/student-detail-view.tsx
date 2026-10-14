"use client"

import { AlertCircle, ArrowLeft, CalendarPlus, Package, RotateCw, SearchX, SlidersHorizontal, Trash2, XCircle } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import {
  adminStudentsHref,
  localDateOf,
  type AdminGrantView,
  type AdminLedgerEntry,
  type StudentBookingView,
  type StudentDetail,
} from "../../application"
import { useBooking, useCopy } from "../../ui/booking-context"
import { cx, formatDayMonth, formatTime } from "../../ui/format"
import { Badge, SkeletonBlock, StatusPanel, buttonClass } from "../../ui/primitives"
import { balanceLabel, bookingOutcome, packLastDay, sessionWhen, studentName } from "./student-format"

export type StudentDetailLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ready"; detail: StudentDetail }

export interface StudentDetailActions {
  onGrant: () => void
  onAdjust: (grant: AdminGrantView) => void
  onBookFor: () => void
  onCancelFor: (booking: StudentBookingView) => void
  /** Opens the erase (anonymize) confirm sheet (ADR-020). */
  onErase: () => void
}

const sectionTitle = "[font-family:var(--font-display)] text-[21px] font-medium leading-tight text-foreground"
const card = "rounded-[var(--radius-card)] border border-border bg-card p-4 [box-shadow:var(--shadow-card)]"

export function StudentDetailSkeleton() {
  const t = useCopy()
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p role="status" aria-live="polite" className="sr-only">
        {t("admin.student.loading")}
      </p>
      <SkeletonBlock className="h-9 w-56" />
      <SkeletonBlock className="h-28 w-full rounded-[var(--radius-card)]" />
      <SkeletonBlock className="h-20 w-full rounded-[var(--radius-card)]" />
    </div>
  )
}

/** A4 student detail (`/admin/alumna/?id=`): balance, packs, bookings, ledger (presentational). */
export function StudentDetailView({
  load,
  notice,
  onRetry,
  actions,
}: {
  load: StudentDetailLoadState
  notice: string | null
  onRetry: () => void
  actions: StudentDetailActions
}) {
  const t = useCopy()
  const { brand } = useBooking()

  if (load.status === "loading") return <StudentDetailSkeleton />

  if (load.status === "error") {
    return (
      <StatusPanel
        role="alert"
        titleAs="h1"
        icon={<AlertCircle className="size-5" />}
        title={t("admin.student.error")}
        action={
          <button type="button" onClick={onRetry} className={buttonClass.primary}>
            <RotateCw aria-hidden="true" className="size-4" />
            {t("error.retry")}
          </button>
        }
      />
    )
  }

  if (load.status === "not_found") {
    return (
      <StatusPanel
        role="status"
        titleAs="h1"
        icon={<SearchX className="size-5" />}
        title={t("admin.student.notFound")}
        action={
          <Link href={adminStudentsHref()} className={buttonClass.primary}>
            {t("admin.student.back")}
          </Link>
        }
      />
    )
  }

  const { detail } = load
  const anonymized = detail.student.anonymizedAt !== null
  const name = anonymized ? t("admin.erase.anonymousName") : studentName(detail.student, t)
  const showEmail = Boolean(detail.student.displayName?.trim() && detail.student.email)

  return (
    <article className="flex flex-col gap-6" aria-labelledby="admin-student-title">
      <header className="flex flex-col gap-2">
        <Link href={adminStudentsHref()} className={cx(buttonClass.link, "self-start text-[14.5px]")}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("admin.student.back")}
        </Link>
        {/* User-entered text: plain text only (React escapes it). */}
        <h1 id="admin-student-title" className="break-words [font-family:var(--font-display)] text-[28px] font-medium leading-tight text-foreground">
          {name}
        </h1>
        {showEmail ? <p className="break-all text-[15px] text-muted-foreground">{detail.student.email}</p> : null}
        {detail.student.anonymizedAt ? (
          <p className="text-[15px] text-muted-foreground">
            {t("admin.erase.anonymized", { date: formatDayMonth(localDateOf(detail.student.anonymizedAt, detail.timezone), brand.locale) })}
          </p>
        ) : null}
      </header>

      <p role="status" aria-live="polite" className="text-[14.5px] font-semibold text-[color:var(--success)] empty:hidden">
        {notice ?? ""}
      </p>

      {/* An anonymized student keeps her history, read-only: no more packs, bookings or adjustments. */}
      <BalanceCard detail={detail} actions={anonymized ? null : actions} />
      <PacksSection detail={detail} onAdjust={anonymized ? null : actions.onAdjust} />
      <BookingsSection title={t("admin.student.upcoming")} empty={t("admin.student.noUpcoming")} bookings={detail.upcoming} timezone={detail.timezone} onCancelFor={actions.onCancelFor} />
      <BookingsSection title={t("admin.student.history")} empty={t("admin.student.noHistory")} bookings={detail.history} timezone={detail.timezone} />
      <LedgerSection entries={detail.ledger} timezone={detail.timezone} />
      {anonymized ? null : <EraseSection onErase={actions.onErase} />}
    </article>
  )
}

function EraseSection({ onErase }: { onErase: () => void }) {
  const t = useCopy()
  return (
    <Section id="admin-student-erase" title={t("admin.erase.section")}>
      <p className="text-[14.5px] text-muted-foreground">{t("admin.erase.intro")}</p>
      <button type="button" onClick={onErase} className={cx(buttonClass.secondary, "self-start border-destructive text-destructive")}>
        <Trash2 aria-hidden="true" className="size-4" />
        {t("admin.erase.cta")}
      </button>
    </Section>
  )
}

function BalanceCard({ detail, actions }: { detail: StudentDetail; actions: StudentDetailActions | null }) {
  const { brand } = useBooking()
  const t = useCopy()
  const { student } = detail
  return (
    <section aria-labelledby="admin-student-balance" className={cx(card, "flex flex-col gap-3")}>
      <h2 id="admin-student-balance" className="[font-family:var(--font-display)] text-[24px] font-medium leading-tight text-primary">
        {balanceLabel(student.balance, t)}
      </h2>
      {student.nextExpiry ? (
        <p className="text-[14.5px] text-muted-foreground">
          {t("admin.student.expiry", { date: packLastDay(student.nextExpiry, detail.timezone, brand.locale) })}
        </p>
      ) : null}
      {actions ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={actions.onGrant} className={buttonClass.primary}>
            <Package aria-hidden="true" className="size-4" />
            {t("admin.grant.cta")}
          </button>
          <button type="button" onClick={actions.onBookFor} className={buttonClass.secondary}>
            <CalendarPlus aria-hidden="true" className="size-4" />
            {t("admin.bookFor.cta")}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className={sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function PacksSection({ detail, onAdjust }: { detail: StudentDetail; onAdjust: ((grant: AdminGrantView) => void) | null }) {
  const { brand } = useBooking()
  const t = useCopy()
  return (
    <Section id="admin-student-packs" title={t("admin.student.packs")}>
      {detail.activeGrants.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{t("admin.student.noPacks")}</p>
      ) : (
        <ul role="list" className="flex flex-col gap-3">
          {detail.activeGrants.map((grant) => {
            const date = packLastDay(grant.expiresAt, detail.timezone, brand.locale)
            return (
              <li key={grant.id} className={cx(card, "flex flex-col gap-2")}>
                <p className="text-[15.5px] font-semibold text-foreground">
                  {t("admin.student.pack", { remaining: grant.remaining, total: grant.total, date })}
                </p>
                {/* Staff-entered note, visible to the student too: plain text only. */}
                {grant.note ? <p className="whitespace-pre-line break-words text-[14.5px] text-muted-foreground">{grant.note}</p> : null}
                {onAdjust ? (
                  <button
                    type="button"
                    onClick={() => onAdjust(grant)}
                    aria-label={t("admin.adjust.ctaLabel", { date })}
                    className={cx(buttonClass.link, "self-start")}
                  >
                    <SlidersHorizontal aria-hidden="true" className="size-4" />
                    {t("admin.adjust.cta")}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function BookingsSection({
  title,
  empty,
  bookings,
  timezone,
  onCancelFor,
}: {
  title: string
  empty: string
  bookings: StudentBookingView[]
  timezone: string
  /** Present for upcoming bookings only. */
  onCancelFor?: (booking: StudentBookingView) => void
}) {
  const { brand } = useBooking()
  const t = useCopy()
  const id = onCancelFor ? "admin-student-upcoming" : "admin-student-history"
  return (
    <Section id={id} title={title}>
      {bookings.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{empty}</p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {bookings.map((booking) => {
            const when = sessionWhen(booking.startsAt, timezone, brand.locale)
            return (
              <li key={booking.bookingId} className={cx(card, "flex flex-col gap-1.5")}>
                <p className="text-[15.5px] font-semibold text-foreground">
                  <time dateTime={booking.startsAt}>{when}</time>
                </p>
                <p className="text-[14.5px] text-muted-foreground">{booking.classTypeName}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {onCancelFor ? null : <Badge tone="neutral">{bookingOutcome(booking, t)}</Badge>}
                  {booking.source === "staff" ? <Badge tone="brand">{t("admin.student.byStaff")}</Badge> : null}
                  {booking.source === "waitlist" ? <Badge tone="brand">{t("admin.student.fromWaitlist")}</Badge> : null}
                  {booking.refunded ? <Badge tone="neutral">{t("admin.student.refunded")}</Badge> : null}
                </div>
                {onCancelFor ? (
                  <button
                    type="button"
                    onClick={() => onCancelFor(booking)}
                    aria-label={t("admin.cancelFor.ctaLabel", { date: when })}
                    className={cx(buttonClass.link, "self-start text-destructive")}
                  >
                    <XCircle aria-hidden="true" className="size-4" />
                    {t("admin.cancelFor.cta")}
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function LedgerSection({ entries, timezone }: { entries: AdminLedgerEntry[]; timezone: string }) {
  const { brand } = useBooking()
  const t = useCopy()
  return (
    <Section id="admin-student-ledger" title={t("admin.ledger.title")}>
      <p className="text-[14.5px] text-muted-foreground">{t("admin.ledger.intro")}</p>
      {entries.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{t("admin.ledger.empty")}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-[15px] font-semibold text-foreground">
                  {t(`admin.ledger.reason.${entry.reason}`)}{" "}
                  <span className="font-normal text-muted-foreground">· {t(`admin.ledger.actor.${entry.actor}`)}</span>
                </p>
                <p className="text-[13.5px] text-muted-foreground">
                  <time dateTime={entry.createdAt}>
                    {formatDayMonth(localDateOf(entry.createdAt, timezone), brand.locale)} · {formatTime(entry.createdAt, timezone, brand.locale)}
                  </time>
                </p>
                {/* Staff-entered note / reason: plain text only. */}
                {entry.note ? <p className="whitespace-pre-line break-words text-[14px] text-foreground">{entry.note}</p> : null}
              </div>
              <p className={cx("shrink-0 text-[16px] font-bold tabular-nums", entry.delta > 0 ? "text-[color:var(--success)]" : "text-destructive")}>
                <span aria-hidden="true">{entry.delta > 0 ? `+${entry.delta}` : `−${Math.abs(entry.delta)}`}</span>
                <span className="sr-only">
                  {entry.delta > 0 ? t("admin.ledger.plus", { n: entry.delta }) : t("admin.ledger.minus", { n: Math.abs(entry.delta) })}
                </span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
