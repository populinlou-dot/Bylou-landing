import { DOMAIN_REASON_CODES, type DomainReasonCode } from "../domain"

/** Stable UI message ids (UX_DESIGN.md §3.1). Brands provide every key. */
export const UI_COPY_KEYS = [
  "agenda.eyebrow",
  "agenda.title",
  "agenda.tz",
  "filter.all",
  "session.cta",
  "session.spots.many",
  "session.spots.one",
  "session.full",
  "session.instructor",
  "session.inProgress",
  "waitlist.join",
  "waitlist.joined",
  "waitlist.promoted",
  "waitlist.leave",
  "sheet.confirm",
  "sheet.pending",
  "sheet.credit",
  "sheet.policy",
  "sheet.back",
  "success.title",
  "success.calendar",
  "success.mail",
  "mine.title",
  "mine.upcoming",
  "mine.history",
  "mine.empty",
  "mine.join",
  "cancel.cta",
  "cancel.confirm",
  "cancel.keep",
  "cancel.done",
  "cancel.closed",
  "history.attended",
  "history.absent",
  "history.cancelled",
  "pack.balance",
  "pack.none",
  "pack.none.cta",
  "pack.expired",
  "auth.title",
  "auth.code",
  "auth.resend",
  "error.load",
  "error.retry",
  "error.conflict",
  "empty.day",
  "empty.next",
] as const

export type UiCopyKey = (typeof UI_COPY_KEYS)[number]

/** One message per domain reason code, so every rejection has user-facing copy. */
export type ReasonCopyKey = `reason.${DomainReasonCode}`

export const REASON_COPY_KEYS: readonly ReasonCopyKey[] = DOMAIN_REASON_CODES.map(
  (code): ReasonCopyKey => `reason.${code}`,
)

export type CopyKey = UiCopyKey | ReasonCopyKey

export const COPY_KEYS: readonly CopyKey[] = [...UI_COPY_KEYS, ...REASON_COPY_KEYS]

export type CopyCatalog = Record<CopyKey, string>

/** Placeholders a message must keep, whatever the brand wording. */
export const REQUIRED_PLACEHOLDERS: Partial<Record<CopyKey, readonly string[]>> = {
  "session.spots.many": ["n"],
  "session.instructor": ["name"],
  "waitlist.joined": ["n"],
  "sheet.credit": ["n"],
  "sheet.policy": ["h"],
  "success.mail": ["email"],
  "cancel.closed": ["h"],
  "pack.balance": ["used", "total", "date"],
  "pack.expired": ["date"],
  "auth.code": ["email"],
}
