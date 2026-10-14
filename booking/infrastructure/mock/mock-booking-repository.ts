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
  type ClassTypeView,
  type Clock,
  type CreditBalance,
  type InstantRange,
  type MyBooking,
  type SessionAvailability,
  type SessionPrivateDetails,
} from "../../application"
import { DEMO_USER_ID } from "./mock-auth"
import { createDemoSeed, type DemoSeed } from "./demo-seed"

export interface MockBookingRepositoryOptions {
  clock: Clock
  /** Studio rules from the active brand defaults (ADR-014). */
  rules: StudioRules
  /** Artificial latency so loading states are visible in the demo. 0 in tests. */
  latencyMs?: number
  /** Who is signed in (MockAuth). Without it every write is `unauthenticated`. */
  currentUserId?: () => string | null
}

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
    let refunded = false
    if (decision.outcome === "refund") {
      const grant = state.grants.find((g) => g.id === booking.creditGrantId)
      // No refund into an expired grant (DATA_MODEL §6.2).
      if (grant && toEpochMs(grant.expiresAt) > now.getTime()) {
        grant.remaining += this.options.rules.creditsPerBooking
        state.refunded.add(booking.id)
        refunded = true
      }
    }
    return { ok: true, bookingId: booking.id, status: booking.status, refunded, replayed: false }
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
      rules: this.options.rules,
    }
  }

  /** Seeded once per instance from the clock, so ids stay stable while the page is open. */
  private data(): MockState {
    if (!this.state) this.state = this.createState()
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
    const classTypeSettings = Object.fromEntries(
      seed.classTypes.map((ct, index): [string, MockClassTypeSettings] => [
        ct.id,
        { defaultModality: DEMO_CLASS_TYPE_MODALITY[ct.id] ?? "in_person", isPublished: true, sortOrder: index + 1 },
      ]),
    )
    return {
      ...seed,
      grants: [grant],
      keys: new Map(),
      refunded: new Set(),
      classTypeSettings,
      privateDetailsBySessionId: {},
      seriesKeys: new Map(),
    }
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
        note: "Pack demo",
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
    return structuredClone({
      session,
      classType,
      // Occupancy comes from the domain rule (only confirmed bookings take a spot).
      confirmedCount: availability(session, bookings).booked,
      instructorName: instructorBySessionId[id] ?? null,
      myBookingId: userId ? (this.myConfirmedBooking(id, userId)?.id ?? null) : null,
      myWaitlistPosition: null,
    })
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
  }
}
