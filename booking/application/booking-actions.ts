/**
 * Transactional use cases (Phase 3): reserve, cancel and the "Mis reservas" read model.
 * The backend is the only authority (ADR-005): these functions validate input shape, call the
 * port and never decide capacity or credits themselves. Cancellation previews reuse the domain
 * policy so the UI hides actions the backend would refuse.
 */
import { evaluateCancellation, toEpochMs, type CancellationEvaluation, type IsoDateTime, type StudioRules } from "../domain"
import { isValidSessionId } from "./get-agenda"
import {
  RepositoryError,
  type BookCommand,
  type BookResult,
  type BookingRepository,
  type CancelCommand,
  type CancelResult,
  type Clock,
  type CreditBalance,
  type MyBooking,
} from "./ports"
import { localDateOf, type LocalDate } from "./time-zone"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && UUID.test(key)
}

export interface BookingDeps {
  repository: BookingRepository
}

/** Same `idempotencyKey` on retry → the backend returns the original booking (replayed). */
export async function reserveSession(deps: BookingDeps, cmd: BookCommand): Promise<BookResult> {
  if (!isValidSessionId(cmd.sessionId) || !isValidIdempotencyKey(cmd.idempotencyKey)) {
    return { ok: false, code: "invalid_input" }
  }
  try {
    return await deps.repository.book({ sessionId: cmd.sessionId, idempotencyKey: cmd.idempotencyKey })
  } catch (error) {
    return { ok: false, code: error instanceof RepositoryError ? error.code : "unknown" }
  }
}

export async function cancelBooking(deps: BookingDeps, cmd: CancelCommand): Promise<CancelResult> {
  if (!isValidSessionId(cmd.bookingId) || !isValidIdempotencyKey(cmd.idempotencyKey)) {
    return { ok: false, code: "invalid_input" }
  }
  try {
    return await deps.repository.cancel({
      bookingId: cmd.bookingId,
      idempotencyKey: cmd.idempotencyKey,
      acceptLate: cmd.acceptLate === true,
    })
  } catch (error) {
    return { ok: false, code: error instanceof RepositoryError ? error.code : "unknown" }
  }
}

/** How a past or cancelled booking reads in the history list. */
export type HistoryOutcome = "attended" | "absent" | "finished" | "cancelled" | "session_cancelled"

export interface MyBookingEntry extends MyBooking {
  localDate: LocalDate
  durationMinutes: number
  /** Domain preview of what "Cancelar" would do right now (upcoming only; history = denied). */
  cancellation: CancellationEvaluation
  historyOutcome: HistoryOutcome | null
}

export interface MyAccount {
  timezone: string
  now: IsoDateTime
  rules: StudioRules
  balance: CreditBalance
  /** Confirmed bookings of sessions that have not ended, soonest first. */
  upcoming: MyBookingEntry[]
  /** Everything else, most recent first. */
  history: MyBookingEntry[]
}

export interface AccountDeps {
  repository: BookingRepository
  clock: Clock
}

/** Throws RepositoryError("unauthenticated") when signed out, so the UI can ask to sign in. */
export async function getMyAccount(deps: AccountDeps): Promise<MyAccount> {
  const [rules, bookings, balance] = await Promise.all([
    deps.repository.getStudioRules(),
    deps.repository.listMyBookings(),
    deps.repository.getMyCreditBalance(),
  ])
  const now = deps.clock.now()
  const nowMs = now.getTime()
  const upcoming: MyBookingEntry[] = []
  const history: MyBookingEntry[] = []

  for (const item of bookings) {
    const { booking, session } = item
    const isUpcoming =
      booking.status === "confirmed" && session.status === "scheduled" && nowMs < toEpochMs(session.endsAt)
    const entry: MyBookingEntry = {
      ...item,
      localDate: localDateOf(session.startsAt, rules.timezone),
      durationMinutes: Math.round((toEpochMs(session.endsAt) - toEpochMs(session.startsAt)) / 60_000),
      cancellation: evaluateCancellation(booking, session, rules, now),
      historyOutcome: isUpcoming ? null : historyOutcome(item),
      // Private details are only meaningful while the booking is active.
      privateDetails: isUpcoming ? item.privateDetails : null,
    }
    ;(isUpcoming ? upcoming : history).push(entry)
  }

  const byStart = (a: MyBookingEntry, b: MyBookingEntry) => toEpochMs(a.session.startsAt) - toEpochMs(b.session.startsAt)
  upcoming.sort(byStart)
  history.sort((a, b) => byStart(b, a))
  return { timezone: rules.timezone, now: now.toISOString(), rules, balance, upcoming, history }
}

function historyOutcome({ booking, session }: MyBooking): HistoryOutcome {
  if (booking.status !== "confirmed") return "cancelled"
  if (session.status === "cancelled") return "session_cancelled"
  if (booking.attendance === "attended") return "attended"
  if (booking.attendance === "no_show") return "absent"
  return "finished"
}
