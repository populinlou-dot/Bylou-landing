/**
 * In-memory BookingRepository for the `mock` data source (ADR-013). DEMO DATA ONLY:
 * the UI must show the "Datos de demostración" banner whenever this adapter is active.
 *
 * Writes follow the same domain policies the RPCs enforce (evaluateBooking,
 * evaluateCancellation, selectCreditGrant) and the same idempotency contract:
 * same key + same session → original booking (replayed), same key + other session → invalid_input.
 * State lives in memory only: a full page reload starts over.
 */
import {
  availability,
  creditBalance,
  evaluateBooking,
  evaluateCancellation,
  isGrantUsableAt,
  toEpochMs,
  type Booking,
  type CreditGrant,
  type IsoDateTime,
  type Modality,
  type StudioRules,
} from "../../domain"
import {
  RepositoryError,
  localDateOf,
  startOfWeek,
  zonedTimeToInstant,
  type BookCommand,
  type BookResult,
  type BookingRepository,
  type CancelCommand,
  type CancelResult,
  type BookingSource,
  type ClassTypeView,
  type Clock,
  type CreditBalance,
  type InstantRange,
  type MyBooking,
  type MyProfile,
  type SessionAvailability,
  type SessionPrivateDetails,
  type UpdateProfileResult,
} from "../../application"
import { DEMO_STAFF_ID, DEMO_USER_ID } from "./mock-auth"
import { createDemoSeed, type DemoSeed } from "./demo-seed"
import { appendLedger, expireDueGrants, type MockGrantMeta, type MockLedgerEntry } from "./mock-ledger"

export interface MockBookingRepositoryOptions {
  clock: Clock
  /** Studio rules from the active brand defaults (ADR-014). */
  rules: StudioRules
  /** Artificial latency so loading states are visible in the demo. 0 in tests. */
  latencyMs?: number
  /** Who is signed in (MockAuth). Without it every write is `unauthenticated`. */
  currentUserId?: () => string | null
  /** Churn throttle (ADR-019); defaults mirror `studio_settings`. */
  throttle?: MockThrottle
}

/** Rolling 24 h limits of book_session (null = off). */
export interface MockThrottle {
  maxSelfCancellations24h: number | null
  maxSessionBookings24h: number | null
}

/** Same defaults as the migration (studio_settings.max_self_cancellations_24h / max_session_bookings_24h). */
export const MOCK_THROTTLE_DEFAULTS: MockThrottle = { maxSelfCancellations24h: 6, maxSessionBookings24h: 3 }

const DAY_MS = 24 * 60 * 60_000
/** Fictional attendee details, shown only to the demo student holding a booking. */
const DEMO_PRIVATE_DETAILS: Record<"online" | "in_person", SessionPrivateDetails> = {
  online: { meetingUrl: "https://meet.example.test/demo", address: null, instructions: "Link de demostración." },
  in_person: { meetingUrl: null, address: "Calle Falsa 123 (demo)", instructions: null },
}

/** Admin-only class type columns (`class_types.default_modality`, `is_published`, `sort_order`). */
export interface MockClassTypeSettings {
  defaultModality: Modality
  /** False = archived/draft: hidden from students, unbookable (mirrors class_type_is_published). */
  isPublished: boolean
  sortOrder: number
}

interface MockState extends DemoSeed {
  grants: CreditGrant[]
  /** (userId|key) → booking id, mirrors the bookings_idempotency unique key. */
  keys: Map<string, string>
  refunded: Set<string>
  classTypeSettings: Record<string, MockClassTypeSettings>
  /** Details entered by staff for sessions created in the demo; seeded sessions use DEMO_PRIVATE_DETAILS. */
  privateDetailsBySessionId: Record<string, SessionPrivateDetails>
  /** create_session request key → session ids (series replay). */
  seriesKeys: Map<string, string[]>
  /** Append-only credit ledger (Phase 4.3), mirrors credit_ledger. */
  ledger: MockLedgerEntry[]
  /** Pack note / author / key by grant id (Phase 4.3). */
  grantMeta: Record<string, MockGrantMeta>
  /** bookings.source; absent = "student". */
  bookingSources: Record<string, BookingSource>
  /** profiles.display_name by user id (absent = not set yet). */
  displayNames: Record<string, string>
  /** profiles.anonymized_at by user id (ADR-020; absent = not anonymized). */
  anonymizedAt: Record<string, IsoDateTime>
  /** Instants of cancellations a student made herself (bookings.cancelled_by = user), for the throttle. */
  selfCancellations: { userId: string; at: IsoDateTime }[]
}

/** The live in-memory studio shared with MockAdminRepository (mock only). */
export type MockStudio = Pick<
  MockState,
  | "sessions"
  | "classTypes"
  | "bookings"
  | "instructorBySessionId"
  | "grants"
  | "refunded"
  | "classTypeSettings"
  | "privateDetailsBySessionId"
  | "seriesKeys"
  | "keys"
  | "ledger"
  | "grantMeta"
  | "bookingSources"
  | "displayNames"
  | "anonymizedAt"
> & { rules: StudioRules }

/** Demo defaults for the seeded class types (all published). */
const DEMO_CLASS_TYPE_MODALITY: Record<string, Modality> = {
  "demo-individual": "in_person",
  "demo-grupal": "in_person",
  "demo-meditacion": "online",
}

export class MockBookingRepository implements BookingRepository {
  private state: MockState | null = null
  private sequence = 0

  constructor(private readonly options: MockBookingRepositoryOptions) {}

  async getStudioRules(): Promise<StudioRules> {
    await this.delay()
    return structuredClone(this.options.rules)
  }

  async listClassTypes(): Promise<ClassTypeView[]> {
    await this.delay()
    const { classTypes } = this.data()
    return structuredClone(classTypes.filter((ct) => this.isPublishedType(ct.id)))
  }

  async listSessions(range: InstantRange): Promise<SessionAvailability[]> {
    await this.delay()
    const fromMs = toEpochMs(range.from)
    const toMs = toEpochMs(range.to)
    return this.data()
      .sessions.filter((s) => {
        const start = toEpochMs(s.startsAt)
        return start >= fromMs && start < toMs
      })
      .map((s) => this.toAvailability(s.id))
      .filter((s): s is SessionAvailability => s !== null)
  }

  async getSession(id: string): Promise<SessionAvailability | null> {
    await this.delay()
    return this.toAvailability(id)
  }

  async getSessionPrivateDetails(sessionId: string): Promise<SessionPrivateDetails | null> {
    await this.delay()
    const userId = this.userId()
    const session = this.data().sessions.find((s) => s.id === sessionId)
    if (!userId || !session || !this.myConfirmedBooking(sessionId, userId)) return null
    return this.privateDetailsOf(session)
  }

  async listMyBookings(): Promise<MyBooking[]> {
    await this.delay()
    const userId = this.requireUser()
    const { bookings, sessions, classTypes, instructorBySessionId, refunded } = this.data()
    return bookings
      .filter((b) => b.userId === userId)
      .flatMap((booking): MyBooking[] => {
        const session = sessions.find((s) => s.id === booking.sessionId)
        const classType = session && classTypes.find((ct) => ct.id === session.classTypeId)
        if (!session || !classType) return []
        return [
          structuredClone({
            booking,
            session,
            classType,
            instructorName: instructorBySessionId[session.id] ?? null,
            refunded: refunded.has(booking.id),
            privateDetails: booking.status === "confirmed" ? this.privateDetailsOf(session) : null,
          }),
        ]
      })
  }

  async getMyCreditBalance(): Promise<CreditBalance> {
    await this.delay()
    const userId = this.requireUser()
    return this.balanceOf(userId)
  }

  async book(cmd: BookCommand): Promise<BookResult> {
    await this.delay()
    const userId = this.userId()
    if (!userId) return { ok: false, code: "unauthenticated" }
    const state = this.data()

    const priorId = state.keys.get(`${userId}|${cmd.idempotencyKey}`)
    if (priorId) {
      const prior = state.bookings.find((b) => b.id === priorId)
      if (!prior || prior.sessionId !== cmd.sessionId) return { ok: false, code: "invalid_input" }
      return { ok: true, bookingId: prior.id, replayed: true, remainingCredits: this.balanceOf(userId).available }
    }
    // An anonymized profile cannot book (book_session raises 42501).
    if (state.anonymizedAt[userId]) return { ok: false, code: "forbidden" }

    const session = state.sessions.find((s) => s.id === cmd.sessionId)
    // Sessions of an archived class type are not bookable (book_session → not_found).
    if (!session || !this.isPublishedType(session.classTypeId)) return { ok: false, code: "not_found" }
    const decision = evaluateBooking({
      session,
      userId,
      sessionBookings: state.bookings.filter((b) => b.sessionId === session.id),
      grants: state.grants.filter((g) => g.userId === userId),
      rules: this.options.rules,
      now: this.options.clock.now(),
    })
    // Same order as book_session: the throttle runs after every rule except the credit check.
    if ((decision.ok || decision.code === "no_valid_credit") && this.isThrottled(userId, session.id)) {
      return { ok: false, code: "too_many_changes" }
    }
    if (!decision.ok) return { ok: false, code: decision.code }

    const grant = state.grants.find((g) => g.id === decision.grantId)
    if (!grant) return { ok: false, code: "unknown" }
    grant.remaining -= this.options.rules.creditsPerBooking
    const booking: Booking = {
      id: `demo-booking-${++this.sequence}`,
      sessionId: session.id,
      userId,
      status: "confirmed",
      attendance: "unknown",
      idempotencyKey: cmd.idempotencyKey,
      creditGrantId: grant.id,
      createdAt: this.options.clock.now().toISOString(),
    }
    state.bookings.push(booking)
    state.keys.set(`${userId}|${cmd.idempotencyKey}`, booking.id)
    appendLedger(state.ledger, {
      userId,
      grantId: grant.id,
      bookingId: booking.id,
      reason: "booking_debit",
      delta: -this.options.rules.creditsPerBooking,
      actorId: userId,
      createdAt: booking.createdAt,
    })
    return { ok: true, bookingId: booking.id, replayed: false, remainingCredits: this.balanceOf(userId).available }
  }

  async cancel(cmd: CancelCommand): Promise<CancelResult> {
    await this.delay()
    const userId = this.userId()
    if (!userId) return { ok: false, code: "unauthenticated" }
    const state = this.data()
    const booking = state.bookings.find((b) => b.id === cmd.bookingId)
    if (!booking) return { ok: false, code: "not_found" }
    if (booking.userId !== userId) return { ok: false, code: "not_owner" }
    if (booking.status !== "confirmed") {
      // State-based replay, like cancel_booking.
      return { ok: true, bookingId: booking.id, status: booking.status, refunded: state.refunded.has(booking.id), replayed: true }
    }
    const session = state.sessions.find((s) => s.id === booking.sessionId)
    if (!session) return { ok: false, code: "not_found" }

    const now = this.options.clock.now()
    const decision = evaluateCancellation(booking, session, this.options.rules, now)
    if (decision.outcome === "denied") return { ok: false, code: decision.code }
    if (decision.outcome === "late" && !cmd.acceptLate) return { ok: false, code: decision.code }

    booking.status = decision.outcome === "refund" ? "cancelled" : "late_cancelled"
    state.selfCancellations.push({ userId, at: now.toISOString() })
    let refunded = false
    if (decision.outcome === "refund") {
      const grant = state.grants.find((g) => g.id === booking.creditGrantId)
      // No refund into an expired grant (DATA_MODEL §6.2).
      if (grant && toEpochMs(grant.expiresAt) > now.getTime()) {
        grant.remaining += this.options.rules.creditsPerBooking
        state.refunded.add(booking.id)
        refunded = true
        appendLedger(state.ledger, {
          userId,
          grantId: grant.id,
          bookingId: booking.id,
          reason: "cancel_refund",
          delta: this.options.rules.creditsPerBooking,
          actorId: userId,
          createdAt: now.toISOString(),
        })
      }
    }
    return { ok: true, bookingId: booking.id, status: booking.status, refunded, replayed: false }
  }

  async getMyProfile(): Promise<MyProfile> {
    await this.delay()
    const userId = this.requireUser()
    return { displayName: this.data().displayNames[userId] ?? null }
  }

  /** Mirrors the `profiles.display_name` CHECK (1–80 characters); the caller validates first. */
  async updateMyDisplayName(displayName: string): Promise<UpdateProfileResult> {
    await this.delay()
    const userId = this.userId()
    if (!userId) return { ok: false, code: "unauthenticated" }
    const length = Array.from(displayName).length
    if (length < 1 || length > 80) return { ok: false, code: "invalid_input" }
    this.data().displayNames[userId] = displayName
    return { ok: true, displayName }
  }

  /**
   * Mock-only: the live in-memory studio (sessions, bookings) shared with MockAdminRepository,
   * so a demo booking made on /reservas/ shows up in the /admin/ roster of the same page load.
   */
  sharedState(): MockStudio {
    const state = this.data()
    return {
      sessions: state.sessions,
      classTypes: state.classTypes,
      bookings: state.bookings,
      instructorBySessionId: state.instructorBySessionId,
      grants: state.grants,
      refunded: state.refunded,
      classTypeSettings: state.classTypeSettings,
      privateDetailsBySessionId: state.privateDetailsBySessionId,
      seriesKeys: state.seriesKeys,
      keys: state.keys,
      ledger: state.ledger,
      grantMeta: state.grantMeta,
      bookingSources: state.bookingSources,
      displayNames: state.displayNames,
      anonymizedAt: state.anonymizedAt,
      rules: this.options.rules,
    }
  }

  /**
   * Seeded once per instance from the clock, so ids stay stable while the page is open. Every read first
   * applies the credit-expiry job (mirrors pg_cron, D10), so Σ ledger = balance at any clock instant.
   */
  private data(): MockState {
    if (!this.state) this.state = this.createState()
    expireDueGrants(this.state.grants, this.state.ledger, this.options.clock.now())
    return this.state
  }

  private createState(): MockState {
    const now = this.options.clock.now()
    const seed = createDemoSeed(now, this.options.rules.timezone)
    const grant: CreditGrant = {
      id: "demo-grant-1",
      userId: DEMO_USER_ID,
      total: 8,
      remaining: 7,
      grantedAt: new Date(now.getTime() - 10 * DAY_MS).toISOString(),
      expiresAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
    }
    // History: the demo student attended the last session of the PREVIOUS week that had a free
    // spot. Anchored to the week (not to "now"), so any instant in the same week yields the same data.
    const weekStart = zonedTimeToInstant(startOfWeek(localDateOf(now, this.options.rules.timezone)), "00:00", this.options.rules.timezone)
    const past = [...seed.sessions]
      .filter((s) => s.status === "scheduled" && toEpochMs(s.endsAt) <= weekStart.getTime())
      .filter((s) => !availability(s, seed.bookings).isFull)
      .sort((a, b) => toEpochMs(b.startsAt) - toEpochMs(a.startsAt))[0]
    if (past) {
      seed.bookings.push({
        id: "demo-booking-history",
        sessionId: past.id,
        userId: DEMO_USER_ID,
        status: "confirmed",
        attendance: "attended",
        idempotencyKey: "demo-history-key",
        creditGrantId: grant.id,
        createdAt: new Date(toEpochMs(past.startsAt) - 2 * DAY_MS).toISOString(),
      })
    }
    // An older pack that expired with 2 classes unused: the expiry job (data()) records it, so the staff
    // ledger of the demo shows a "Vencimiento" row and Σ ledger still equals the balance.
    const expiredGrant: CreditGrant = {
      id: "demo-grant-0",
      userId: DEMO_USER_ID,
      total: 2,
      remaining: 2,
      grantedAt: new Date(now.getTime() - 70 * DAY_MS).toISOString(),
      expiresAt: new Date(now.getTime() - 40 * DAY_MS).toISOString(),
    }
    // The demo pack's ledger adds up to its remaining credits (8 granted, 1 used).
    const ledger: MockLedgerEntry[] = []
    appendLedger(ledger, {
      userId: DEMO_USER_ID,
      grantId: expiredGrant.id,
      reason: "grant",
      delta: expiredGrant.total,
      actorId: DEMO_STAFF_ID,
      note: "Pack 2 · vencido (demo)",
      createdAt: expiredGrant.grantedAt,
    })
    appendLedger(ledger, {
      userId: DEMO_USER_ID,
      grantId: grant.id,
      reason: "grant",
      delta: grant.total,
      actorId: DEMO_STAFF_ID,
      note: "Pack demo",
      createdAt: grant.grantedAt,
    })
    appendLedger(ledger, {
      userId: DEMO_USER_ID,
      grantId: grant.id,
      bookingId: past ? "demo-booking-history" : null,
      reason: past ? "booking_debit" : "admin_adjust",
      delta: -1,
      actorId: past ? DEMO_USER_ID : DEMO_STAFF_ID,
      note: past ? null : "Clase tomada antes de usar la app (demo)",
      createdAt: past ? new Date(toEpochMs(past.startsAt) - 2 * DAY_MS).toISOString() : grant.grantedAt,
    })
    const classTypeSettings = Object.fromEntries(
      seed.classTypes.map((ct, index): [string, MockClassTypeSettings] => [
        ct.id,
        { defaultModality: DEMO_CLASS_TYPE_MODALITY[ct.id] ?? "in_person", isPublished: true, sortOrder: index + 1 },
      ]),
    )
    return {
      ...seed,
      grants: [expiredGrant, grant],
      keys: new Map(),
      refunded: new Set(),
      classTypeSettings,
      privateDetailsBySessionId: {},
      seriesKeys: new Map(),
      ledger,
      grantMeta: {
        [expiredGrant.id]: {
          note: "Pack 2 · vencido (demo)",
          createdAt: expiredGrant.grantedAt,
          grantedBy: DEMO_STAFF_ID,
          requestKey: "demo-grant-key-0",
        },
        [grant.id]: { note: "Pack demo", createdAt: grant.grantedAt, grantedBy: DEMO_STAFF_ID, requestKey: "demo-grant-key" },
      },
      bookingSources: {},
      // The demo identities already have names, matching the /admin/ demo roster.
      displayNames: { [DEMO_USER_ID]: "Alumna demo", [DEMO_STAFF_ID]: "Lou (demo)" },
      anonymizedAt: {},
      selfCancellations: [],
    }
  }

  /** Mirrors book_session step (e): rows in the last 24 h, never idempotency keys; staff actions do not count. */
  private isThrottled(userId: string, sessionId: string): boolean {
    const limits = this.options.throttle ?? MOCK_THROTTLE_DEFAULTS
    const state = this.data()
    const since = this.options.clock.now().getTime() - DAY_MS
    const recent = (iso: IsoDateTime) => toEpochMs(iso) > since
    if (limits.maxSelfCancellations24h !== null) {
      const cancellations = state.selfCancellations.filter((c) => c.userId === userId && recent(c.at)).length
      if (cancellations >= limits.maxSelfCancellations24h) return true
    }
    if (limits.maxSessionBookings24h !== null) {
      const rebookings = state.bookings.filter(
        (b) => b.userId === userId && b.sessionId === sessionId && recent(b.createdAt) && (state.bookingSources[b.id] ?? "student") !== "staff",
      ).length
      if (rebookings >= limits.maxSessionBookings24h) return true
    }
    return false
  }

  private balanceOf(userId: string): CreditBalance {
    const now = this.options.clock.now()
    const grants = this.data().grants.filter((g) => g.userId === userId)
    const active = grants
      .filter((g) => isGrantUsableAt(g, now.getTime(), 1))
      .sort((a, b) => toEpochMs(a.expiresAt) - toEpochMs(b.expiresAt))
    return {
      available: creditBalance(grants, now),
      nextExpiry: active[0]?.expiresAt ?? null,
      activeGrants: active.map((g) => ({
        id: g.id,
        total: g.total,
        remaining: g.remaining,
        validFrom: g.grantedAt,
        expiresAt: g.expiresAt,
        note: this.data().grantMeta[g.id]?.note ?? null,
      })),
    }
  }

  private userId(): string | null {
    return this.options.currentUserId?.() ?? null
  }

  private requireUser(): string {
    const userId = this.userId()
    if (!userId) throw new RepositoryError("unauthenticated")
    return userId
  }

  private myConfirmedBooking(sessionId: string, userId: string): Booking | undefined {
    return this.data().bookings.find((b) => b.sessionId === sessionId && b.userId === userId && b.status === "confirmed")
  }

  private isPublishedType(classTypeId: string): boolean {
    return this.data().classTypeSettings[classTypeId]?.isPublished ?? false
  }

  private privateDetailsOf(session: { id: string; modality: Modality }): SessionPrivateDetails {
    return { ...(this.data().privateDetailsBySessionId[session.id] ?? DEMO_PRIVATE_DETAILS[session.modality]) }
  }

  private toAvailability(id: string): SessionAvailability | null {
    const { sessions, classTypes, bookings, instructorBySessionId } = this.data()
    const session = sessions.find((s) => s.id === id)
    const classType = session && classTypes.find((ct) => ct.id === session.classTypeId)
    if (!session || !classType) return null
    const userId = this.userId()
    // RLS mirror: sessions of an archived class type stay visible only to students who booked them.
    if (!this.isPublishedType(classType.id) && !(userId && bookings.some((b) => b.sessionId === id && b.userId === userId))) {
      return null
    }
    const mine = userId ? this.myConfirmedBooking(id, userId) : undefined
    return structuredClone({
      session,
      classType,
      // Occupancy comes from the domain rule (only confirmed bookings take a spot).
      confirmedCount: availability(session, bookings).booked,
      instructorName: instructorBySessionId[id] ?? null,
      myBookingId: mine?.id ?? null,
      myAttendance: mine ? mine.attendance : null,
      myWaitlistPosition: null,
    })
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
  }
}
