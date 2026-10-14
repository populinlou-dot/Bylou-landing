/**
 * In-memory AdminRepository for the `mock` data source. DEMO DATA ONLY: the admin shell shows
 * the "Datos de demostración" banner whenever this adapter is active (ADR-013).
 *
 * It reads and writes the same in-memory studio as MockBookingRepository and mirrors the
 * server contract: only the demo staff user (MockAuth, "staff@…") may read or write, attendance
 * follows the `mark_attendance` window (domain `attendanceWindow`), and the Phase 4.2 writes follow
 * `admin_upsert_class_type`, `create_session`, `admin_update_session` and `admin_cancel_session`
 * (same codes, same replay rules, all-or-nothing series). Phase 4.3 mirrors `admin_search_students`,
 * `admin_student_summary`, `grant_credits`, `admin_adjust_credits`, `admin_book_for` and
 * `admin_cancel_for`, writing the same append-only ledger rows (mock-ledger).
 */
import {
  attendanceWindow,
  availability,
  creditBalance,
  isGrantUsableAt,
  selectCreditGrant,
  toEpochMs,
  type CreditGrant,
  type Modality,
  type Session,
} from "../../domain"
import {
  RepositoryError,
  addDays,
  eraseConfirmationMatches,
  localDateOf,
  zonedTimeToInstant,
  type AdjustCreditsCommand,
  type AdjustCreditsResult,
  type AdminGrantView,
  type AdminLedgerEntry,
  type AnonymizeStudentCommand,
  type AnonymizeStudentResult,
  type BookForStudentCommand,
  type BookForStudentResult,
  type CancelForStudentCommand,
  type CancelForStudentResult,
  type GrantCreditsCommand,
  type GrantCreditsResult,
  type StudentBookingView,
  type StudentSummary,
  type AdminClassTypeView,
  type AdminRepository,
  type AdminSessionView,
  type CancelSessionCommand,
  type CancelSessionResult,
  type Clock,
  type CreateSessionsCommand,
  type CreateSessionsResult,
  type InstantRange,
  type MarkAttendanceCommand,
  type MarkAttendanceResult,
  type RosterEntry,
  type SaveClassTypeCommand,
  type SaveClassTypeResult,
  type StaffRole,
  type TransportCode,
  type UpdateSessionCapacityCommand,
  type UpdateSessionResult,
} from "../../application"
import { DEMO_STAFF_ID, DEMO_USER_ID } from "./mock-auth"
import type { MockBookingRepository } from "./mock-booking-repository"
import { appendLedger } from "./mock-ledger"

export interface MockAdminRepositoryOptions {
  clock: Clock
  /** Shared in-memory studio (same instance the student pages use). */
  store: Pick<MockBookingRepository, "sharedState">
  latencyMs?: number
  currentUserId?: () => string | null
}

/** Fictional first names for the fictional demo users (`demo-user-N`). */
const DEMO_NAMES = ["Ana", "Belén", "Carla", null, "Elena", "Flor", "Gina", "Inés", "Julia", "Lara", "Mora", "Nina"]

function demoProfile(userId: string): { displayName: string | null; email: string | null } {
  if (userId === DEMO_USER_ID) return { displayName: "Alumna demo", email: null }
  const n = Number(/^demo-user-(\d+)$/.exec(userId)?.[1] ?? 0)
  const name = n > 0 && n <= DEMO_NAMES.length ? DEMO_NAMES[n - 1] : `Alumna ${n}`
  // One unnamed user shows the email fallback in the roster.
  return name === null ? { displayName: null, email: `alumna${n}@demo.test` } : { displayName: `${name} (demo)`, email: null }
}

const MODALITIES: readonly Modality[] = ["in_person", "online"]
const STUDENT_ID = /^demo-user-\d+$/
const SEARCH_LIMIT = 50
/** Case- and accent-insensitive comparison key for the demo search. */
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max
const tooLong = (value: string | null, max: number) => value !== null && value.length > max

export class MockAdminRepository implements AdminRepository {
  private sequence = 0

  constructor(private readonly options: MockAdminRepositoryOptions) {}

  async getMyRole(): Promise<StaffRole | null> {
    await this.delay()
    const userId = this.userId()
    if (!userId) return null
    return userId === DEMO_STAFF_ID ? "staff" : "student"
  }

  async listSessions(range: InstantRange): Promise<AdminSessionView[]> {
    await this.delay()
    this.requireStaff()
    const fromMs = toEpochMs(range.from)
    const toMs = toEpochMs(range.to)
    return this.state()
      .sessions.filter((s) => {
        const start = toEpochMs(s.startsAt)
        return start >= fromMs && start < toMs
      })
      .map((s) => this.toView(s.id))
      .filter((v): v is AdminSessionView => v !== null)
  }

  async getSession(id: string): Promise<AdminSessionView | null> {
    await this.delay()
    this.requireStaff()
    return this.toView(id)
  }

  async getRoster(sessionId: string): Promise<RosterEntry[]> {
    await this.delay()
    this.requireStaff()
    return this.state()
      .bookings.filter((b) => b.sessionId === sessionId)
      .map((b) => ({
        bookingId: b.id,
        userId: b.userId,
        ...this.profileOf(b.userId),
        status: b.status,
        attendance: b.attendance,
        bookedAt: b.createdAt,
      }))
  }

  async markAttendance(cmd: MarkAttendanceCommand): Promise<MarkAttendanceResult> {
    await this.delay()
    const userId = this.userId()
    if (!userId) return { ok: false, code: "unauthenticated" }
    if (userId !== DEMO_STAFF_ID) return { ok: false, code: "forbidden" }
    const { bookings, sessions } = this.state()
    const booking = bookings.find((b) => b.id === cmd.bookingId)
    if (!booking || booking.status !== "confirmed") return { ok: false, code: "not_found" }
    const session = sessions.find((s) => s.id === booking.sessionId)
    if (!session) return { ok: false, code: "not_found" }
    if (attendanceWindow(session, this.options.clock.now()) !== "open") return { ok: false, code: "attendance_window_closed" }
    booking.attendance = cmd.attendance
    return { ok: true, bookingId: booking.id, attendance: cmd.attendance }
  }

  async listClassTypes(): Promise<AdminClassTypeView[]> {
    await this.delay()
    this.requireStaff()
    const { classTypes, classTypeSettings } = this.state()
    return classTypes.map((ct) => {
      const settings = classTypeSettings[ct.id]
      return {
        id: ct.id,
        name: ct.name,
        description: ct.description,
        durationMinutes: ct.durationMinutes,
        defaultCapacity: ct.defaultCapacity,
        defaultModality: settings?.defaultModality ?? "in_person",
        isPublished: settings?.isPublished ?? false,
        sortOrder: settings?.sortOrder ?? 0,
      }
    })
  }

  async saveClassType(cmd: SaveClassTypeCommand): Promise<SaveClassTypeResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const name = cmd.name.trim()
    const description = cmd.description?.trim() || null
    if (
      !cmd.id ||
      name.length < 1 ||
      name.length > 80 ||
      tooLong(description, 2000) ||
      !inRange(cmd.durationMinutes, 10, 480) ||
      !inRange(cmd.defaultCapacity, 1, 100) ||
      !MODALITIES.includes(cmd.defaultModality)
    ) {
      return { ok: false, code: "invalid_input" }
    }
    const { classTypes, classTypeSettings, sessions } = this.state()
    const existing = classTypes.find((ct) => ct.id === cmd.id)
    const fields = { name, description, durationMinutes: cmd.durationMinutes, defaultCapacity: cmd.defaultCapacity }
    if (existing) Object.assign(existing, fields)
    else classTypes.push({ id: cmd.id, ...fields })
    const sortOrder =
      classTypeSettings[cmd.id]?.sortOrder ?? Math.max(0, ...Object.values(classTypeSettings).map((x) => x.sortOrder)) + 1
    classTypeSettings[cmd.id] = { defaultModality: cmd.defaultModality, isPublished: cmd.isPublished, sortOrder }
    const nowMs = this.options.clock.now().getTime()
    const upcomingSessions = sessions.filter(
      (x) => x.classTypeId === cmd.id && x.status === "scheduled" && toEpochMs(x.startsAt) > nowMs,
    ).length
    return { ok: true, classTypeId: cmd.id, created: !existing, isPublished: cmd.isPublished, upcomingSessions }
  }

  async createSessions(cmd: CreateSessionsCommand): Promise<CreateSessionsResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const state = this.state()
    const replay = state.seriesKeys.get(cmd.requestKey)
    if (replay) return { ok: true, sessionIds: [...replay], replayed: true }

    const classType = state.classTypes.find((ct) => ct.id === cmd.classTypeId)
    if (!classType) return { ok: false, code: "not_found" }
    if (
      !state.classTypeSettings[classType.id]?.isPublished ||
      !inRange(cmd.repeatWeeks, 1, 12) ||
      !inRange(cmd.durationMinutes, 10, 480) ||
      !inRange(cmd.capacity, 1, 100) ||
      !MODALITIES.includes(cmd.modality) ||
      (cmd.meetingUrl !== null && !cmd.meetingUrl.startsWith("https://"))
    ) {
      return { ok: false, code: "invalid_input" }
    }
    // Build every occurrence first: one invalid start rejects the whole series (all or nothing).
    const nowMs = this.options.clock.now().getTime()
    const sessions: Session[] = []
    for (let week = 0; week < cmd.repeatWeeks; week++) {
      const start = zonedTimeToInstant(addDays(cmd.localDate, 7 * week), cmd.localStart, state.rules.timezone)
      if (start.getTime() <= nowMs) return { ok: false, code: "invalid_input" }
      sessions.push({
        id: `demo-new-${++this.sequence}`,
        classTypeId: classType.id,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + cmd.durationMinutes * 60_000).toISOString(),
        capacity: cmd.capacity,
        modality: cmd.modality,
        status: "scheduled",
      })
    }
    for (const session of sessions) {
      state.sessions.push(session)
      if (cmd.instructorName) state.instructorBySessionId[session.id] = cmd.instructorName
      if (cmd.meetingUrl || cmd.address) {
        state.privateDetailsBySessionId[session.id] = { meetingUrl: cmd.meetingUrl, address: cmd.address, instructions: null }
      }
    }
    const ids = sessions.map((x) => x.id)
    state.seriesKeys.set(cmd.requestKey, ids)
    return { ok: true, sessionIds: [...ids], replayed: false }
  }

  async updateSessionCapacity(cmd: UpdateSessionCapacityCommand): Promise<UpdateSessionResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    if (!inRange(cmd.capacity, 1, 100)) return { ok: false, code: "invalid_input" }
    const { sessions, bookings } = this.state()
    const session = sessions.find((x) => x.id === cmd.sessionId)
    if (!session) return { ok: false, code: "not_found" }
    if (session.status === "cancelled") return { ok: false, code: "session_cancelled" }
    if (this.options.clock.now().getTime() >= toEpochMs(session.startsAt)) return { ok: false, code: "session_started" }
    const confirmedCount = availability(session, bookings).booked
    if (cmd.capacity < confirmedCount) return { ok: false, code: "capacity_below_bookings", confirmedCount }
    const changed = session.capacity !== cmd.capacity
    session.capacity = cmd.capacity
    return { ok: true, sessionId: session.id, capacity: cmd.capacity, confirmedCount, changed }
  }

  async cancelSession(cmd: CancelSessionCommand): Promise<CancelSessionResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const { sessions, bookings, grants, refunded, rules } = this.state()
    const session = sessions.find((x) => x.id === cmd.sessionId)
    if (!session) return { ok: false, code: "not_found" }
    if (session.status === "cancelled") {
      return { ok: true, sessionId: session.id, cancelledBookings: 0, refunded: 0, refundsSkipped: [], replayed: true }
    }
    const nowMs = this.options.clock.now().getTime()
    let cancelledBookings = 0
    let refundedCount = 0
    const refundsSkipped: string[] = []
    for (const booking of bookings.filter((b) => b.sessionId === session.id && b.status === "confirmed")) {
      booking.status = "cancelled"
      cancelledBookings++
      if (booking.creditGrantId === null) continue
      // Refund regardless of the window, only into a grant that is still valid now.
      const grant = grants.find((g) => g.id === booking.creditGrantId)
      if (grant && toEpochMs(grant.expiresAt) > nowMs) {
        grant.remaining += rules.creditsPerBooking
        refunded.add(booking.id)
        refundedCount++
        appendLedger(this.state().ledger, {
          userId: booking.userId,
          grantId: grant.id,
          bookingId: booking.id,
          reason: "cancel_refund",
          delta: rules.creditsPerBooking,
          actorId: DEMO_STAFF_ID,
          createdAt: new Date(nowMs).toISOString(),
        })
      } else {
        refundsSkipped.push(booking.id)
      }
    }
    session.status = "cancelled"
    return { ok: true, sessionId: session.id, cancelledBookings, refunded: refundedCount, refundsSkipped, replayed: false }
  }

  /* ---------- Phase 4.3: students + credits ---------- */

  async searchStudents(query: string): Promise<StudentSummary[]> {
    await this.delay()
    this.requireStaff()
    const needle = fold(query.trim())
    return this.studentIds()
      .map((id) => this.summaryOf(id))
      // Anonymized students leave the list (admin_search_students), like the server.
      .filter((s) => s.anonymizedAt === null)
      .filter((s) => !needle || [s.displayName, s.email].some((text) => text !== null && fold(text).includes(needle)))
      .sort((a, b) => this.sortLabel(a).localeCompare(this.sortLabel(b), "es") || (a.userId < b.userId ? -1 : 1))
      .slice(0, SEARCH_LIMIT)
  }

  async getStudent(userId: string): Promise<StudentSummary | null> {
    await this.delay()
    this.requireStaff()
    return this.isStudent(userId) ? this.summaryOf(userId) : null
  }

  async listStudentGrants(userId: string): Promise<AdminGrantView[]> {
    await this.delay()
    this.requireStaff()
    const { grants, grantMeta } = this.state()
    return grants
      .filter((g) => g.userId === userId)
      .map((g) => ({
        id: g.id,
        total: g.total,
        remaining: g.remaining,
        validFrom: g.grantedAt,
        expiresAt: g.expiresAt,
        note: grantMeta[g.id]?.note ?? null,
        createdAt: grantMeta[g.id]?.createdAt ?? g.grantedAt,
      }))
  }

  async listStudentBookings(userId: string): Promise<StudentBookingView[]> {
    await this.delay()
    this.requireStaff()
    const { bookings, sessions, classTypes, refunded, bookingSources } = this.state()
    return bookings
      .filter((b) => b.userId === userId)
      .flatMap((b): StudentBookingView[] => {
        const session = sessions.find((s) => s.id === b.sessionId)
        if (!session) return []
        return [
          {
            bookingId: b.id,
            sessionId: session.id,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            classTypeName: classTypes.find((ct) => ct.id === session.classTypeId)?.name ?? "—",
            sessionStatus: session.status,
            status: b.status,
            attendance: b.attendance,
            refunded: refunded.has(b.id),
            source: bookingSources[b.id] ?? "student",
            bookedAt: b.createdAt,
          },
        ]
      })
  }

  async listStudentLedger(userId: string): Promise<AdminLedgerEntry[]> {
    await this.delay()
    this.requireStaff()
    return this.state()
      .ledger.filter((e) => e.userId === userId)
      .map((e): AdminLedgerEntry => ({
        id: e.id,
        grantId: e.grantId,
        bookingId: e.bookingId,
        reason: e.reason,
        delta: e.delta,
        note: e.note,
        actor: e.actorId === null ? "system" : e.actorId === e.userId ? "student" : "staff",
        createdAt: e.createdAt,
      }))
      .reverse()
  }

  async grantCredits(cmd: GrantCreditsCommand): Promise<GrantCreditsResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    if (!inRange(cmd.credits, 1, 100) || !inRange(cmd.validDays, 1, 365) || tooLong(cmd.note, 200)) {
      return { ok: false, code: "invalid_input" }
    }
    const state = this.state()
    const prior = Object.entries(state.grantMeta).find(([, meta]) => meta.requestKey === cmd.requestKey)
    if (prior) {
      const grant = state.grants.find((g) => g.id === prior[0])
      if (!grant || grant.userId !== cmd.userId || grant.total !== cmd.credits) return { ok: false, code: "invalid_input" }
      return { ok: true, grantId: grant.id, credits: grant.total, expiresAt: grant.expiresAt, replayed: true }
    }
    // An anonymized student gets no new pack (grant_credits → not_found), so no new note either.
    if (!this.isStudent(cmd.userId) || state.anonymizedAt[cmd.userId]) return { ok: false, code: "not_found" }
    const now = this.options.clock.now()
    const tz = state.rules.timezone
    const grant: CreditGrant = {
      id: `demo-grant-new-${++this.sequence}`,
      userId: cmd.userId,
      total: cmd.credits,
      remaining: cmd.credits,
      grantedAt: now.toISOString(),
      // Valid through local day today + validDays − 1, exactly like grant_credits.
      expiresAt: zonedTimeToInstant(addDays(localDateOf(now, tz), cmd.validDays), "00:00", tz).toISOString(),
    }
    state.grants.push(grant)
    state.grantMeta[grant.id] = { note: cmd.note, createdAt: grant.grantedAt, grantedBy: DEMO_STAFF_ID, requestKey: cmd.requestKey }
    appendLedger(state.ledger, {
      userId: cmd.userId,
      grantId: grant.id,
      reason: "grant",
      delta: cmd.credits,
      actorId: DEMO_STAFF_ID,
      note: cmd.note,
      createdAt: grant.grantedAt,
    })
    return { ok: true, grantId: grant.id, credits: grant.total, expiresAt: grant.expiresAt, replayed: false }
  }

  async adjustCredits(cmd: AdjustCreditsCommand): Promise<AdjustCreditsResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const reason = cmd.reason.trim()
    if (cmd.delta === 0 || !inRange(cmd.delta, -100, 100) || reason.length < 1 || reason.length > 200) {
      return { ok: false, code: "invalid_input" }
    }
    const state = this.state()
    const prior = state.ledger.find((e) => e.actorId === DEMO_STAFF_ID && e.requestKey === cmd.requestKey)
    if (prior) {
      if (prior.grantId !== cmd.grantId || prior.delta !== cmd.delta) return { ok: false, code: "invalid_input" }
      const grant = state.grants.find((g) => g.id === prior.grantId)
      return {
        ok: true,
        grantId: prior.grantId,
        delta: prior.delta,
        creditsRemaining: grant?.remaining ?? 0,
        balance: this.summaryOf(prior.userId).balance,
        replayed: true,
      }
    }
    const grant = state.grants.find((g) => g.id === cmd.grantId)
    if (!grant || state.anonymizedAt[grant.userId]) return { ok: false, code: "not_found" }
    const now = this.options.clock.now()
    if (toEpochMs(grant.expiresAt) <= now.getTime()) return { ok: false, code: "grant_expired" }
    if (grant.remaining + cmd.delta < 0) return { ok: false, code: "insufficient_balance", creditsRemaining: grant.remaining }
    // Room is kept for credits still held by confirmed bookings (a later refund must fit in the pack).
    const held = state.bookings.filter((b) => b.creditGrantId === grant.id && b.status === "confirmed").length * state.rules.creditsPerBooking
    if (grant.remaining + cmd.delta > grant.total - held) {
      return { ok: false, code: "adjust_exceeds_pack", creditsRemaining: grant.remaining }
    }
    grant.remaining += cmd.delta
    appendLedger(state.ledger, {
      userId: grant.userId,
      grantId: grant.id,
      reason: "admin_adjust",
      delta: cmd.delta,
      actorId: DEMO_STAFF_ID,
      note: reason,
      requestKey: cmd.requestKey,
      createdAt: now.toISOString(),
    })
    return {
      ok: true,
      grantId: grant.id,
      delta: cmd.delta,
      creditsRemaining: grant.remaining,
      balance: this.summaryOf(grant.userId).balance,
      replayed: false,
    }
  }

  async bookForStudent(cmd: BookForStudentCommand): Promise<BookForStudentResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const state = this.state()
    const priorId = state.keys.get(`${cmd.userId}|${cmd.requestKey}`)
    if (priorId) {
      const prior = state.bookings.find((b) => b.id === priorId)
      if (!prior || prior.sessionId !== cmd.sessionId) return { ok: false, code: "invalid_input" }
      return { ok: true, bookingId: prior.id, replayed: true, remainingCredits: this.summaryOf(cmd.userId).balance }
    }
    if (!this.isStudent(cmd.userId) || state.anonymizedAt[cmd.userId]) return { ok: false, code: "not_found" }
    const session = state.sessions.find((x) => x.id === cmd.sessionId)
    if (!session) return { ok: false, code: "not_found" }
    const now = this.options.clock.now()
    if (session.status === "cancelled") return { ok: false, code: "session_cancelled" }
    if (now.getTime() >= toEpochMs(session.startsAt)) return { ok: false, code: "session_started" }
    // AD-10: the booking window is deliberately not checked; capacity is.
    const sessionBookings = state.bookings.filter((b) => b.sessionId === session.id)
    if (sessionBookings.some((b) => b.userId === cmd.userId && b.status === "confirmed")) return { ok: false, code: "already_booked" }
    if (availability(session, state.bookings).isFull) return { ok: false, code: "session_full" }
    const perBooking = state.rules.creditsPerBooking
    const usableNow = state.grants.filter((g) => g.userId === cmd.userId && toEpochMs(g.grantedAt) <= now.getTime())
    const grant = selectCreditGrant(usableNow, session.startsAt, perBooking)
    if (!grant) return { ok: false, code: "no_valid_credit" }
    grant.remaining -= perBooking
    const booking = {
      id: `demo-booking-staff-${++this.sequence}`,
      sessionId: session.id,
      userId: cmd.userId,
      status: "confirmed" as const,
      attendance: "unknown" as const,
      idempotencyKey: cmd.requestKey,
      creditGrantId: grant.id,
      createdAt: now.toISOString(),
    }
    state.bookings.push(booking)
    state.keys.set(`${cmd.userId}|${cmd.requestKey}`, booking.id)
    state.bookingSources[booking.id] = "staff"
    appendLedger(state.ledger, {
      userId: cmd.userId,
      grantId: grant.id,
      bookingId: booking.id,
      reason: "booking_debit",
      delta: -perBooking,
      actorId: DEMO_STAFF_ID,
      createdAt: booking.createdAt,
    })
    return { ok: true, bookingId: booking.id, replayed: false, remainingCredits: this.summaryOf(cmd.userId).balance }
  }

  async cancelForStudent(cmd: CancelForStudentCommand): Promise<CancelForStudentResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const state = this.state()
    const booking = state.bookings.find((b) => b.id === cmd.bookingId)
    if (!booking) return { ok: false, code: "not_found" }
    if (booking.status !== "confirmed") {
      return { ok: true, bookingId: booking.id, refunded: state.refunded.has(booking.id), refundSkipped: false, replayed: true }
    }
    if (booking.attendance !== "unknown") return { ok: false, code: "cancellation_not_allowed" }
    booking.status = "cancelled"
    const now = this.options.clock.now()
    let refunded = false
    let refundSkipped = false
    if (cmd.refund && booking.creditGrantId !== null) {
      const grant = state.grants.find((g) => g.id === booking.creditGrantId)
      if (grant && toEpochMs(grant.expiresAt) > now.getTime()) {
        grant.remaining += state.rules.creditsPerBooking
        state.refunded.add(booking.id)
        refunded = true
        appendLedger(state.ledger, {
          userId: booking.userId,
          grantId: grant.id,
          bookingId: booking.id,
          reason: "cancel_refund",
          delta: state.rules.creditsPerBooking,
          actorId: DEMO_STAFF_ID,
          createdAt: now.toISOString(),
        })
      } else {
        refundSkipped = true
      }
    }
    return { ok: true, bookingId: booking.id, refunded, refundSkipped, replayed: false }
  }

  /**
   * Mirrors admin_anonymize_student (ADR-020): typo guard on the current email, refused while she has an
   * upcoming confirmed booking, then name/email gone and pack/ledger notes erased; history is kept.
   */
  async anonymizeStudent(cmd: AnonymizeStudentCommand): Promise<AnonymizeStudentResult> {
    await this.delay()
    const denied = this.writeDenied()
    if (denied) return { ok: false, code: denied }
    const confirm = cmd.confirmEmail.trim().toLowerCase()
    if (!confirm || confirm.length > 320) return { ok: false, code: "invalid_input" }
    if (!this.isStudent(cmd.userId)) return { ok: false, code: "not_found" }
    const state = this.state()
    const prior = state.anonymizedAt[cmd.userId]
    if (prior) return { ok: true, userId: cmd.userId, anonymizedAt: prior, replayed: true }
    // Her email; without one, her exact name or her id (same rule as the RPC).
    if (!eraseConfirmationMatches(cmd.confirmEmail, { userId: cmd.userId, ...this.profileOf(cmd.userId) })) {
      return { ok: false, code: "email_mismatch" }
    }
    const summary = this.summaryOf(cmd.userId)
    if (summary.nextBooking) {
      const now = this.options.clock.now().getTime()
      const upcoming = state.bookings.filter((b) => {
        const session = state.sessions.find((s) => s.id === b.sessionId)
        return b.userId === cmd.userId && b.status === "confirmed" && session?.status === "scheduled" && toEpochMs(session.endsAt) > now
      }).length
      return { ok: false, code: "has_upcoming_bookings", upcoming }
    }
    for (const grant of state.grants) {
      const meta = state.grantMeta[grant.id]
      if (grant.userId === cmd.userId && meta) meta.note = null
    }
    for (const entry of state.ledger) if (entry.userId === cmd.userId) entry.note = null
    delete state.displayNames[cmd.userId]
    const anonymizedAt = this.options.clock.now().toISOString()
    state.anonymizedAt[cmd.userId] = anonymizedAt
    return { ok: true, userId: cmd.userId, anonymizedAt, replayed: false }
  }

  /** Demo students: the demo student, every fictional booker and anyone holding a pack (never staff). */
  private studentIds(): string[] {
    const { bookings, grants } = this.state()
    const ids = new Set<string>([DEMO_USER_ID])
    for (const b of bookings) if (STUDENT_ID.test(b.userId)) ids.add(b.userId)
    for (const g of grants) if (g.userId !== DEMO_STAFF_ID) ids.add(g.userId)
    return [...ids]
  }

  private isStudent(userId: string): boolean {
    return this.studentIds().includes(userId)
  }

  private sortLabel(summary: StudentSummary): string {
    return (summary.displayName?.trim() || summary.email || "\uffff").toLowerCase()
  }

  /** Same definitions as private.student_summary: usable balance now, next expiry, next booking. */
  private summaryOf(userId: string): StudentSummary {
    const { grants, bookings, sessions, classTypes } = this.state()
    const now = this.options.clock.now()
    const own = grants.filter((g) => g.userId === userId && toEpochMs(g.grantedAt) <= now.getTime())
    const active = own.filter((g) => isGrantUsableAt(g, now.getTime(), 1)).sort((a, b) => toEpochMs(a.expiresAt) - toEpochMs(b.expiresAt))
    const next = bookings
      .filter((b) => b.userId === userId && b.status === "confirmed")
      .map((b) => ({ booking: b, session: sessions.find((s) => s.id === b.sessionId) }))
      .filter((x): x is { booking: (typeof bookings)[number]; session: Session } =>
        Boolean(x.session && x.session.status === "scheduled" && toEpochMs(x.session.endsAt) > now.getTime()),
      )
      .sort((a, b) => toEpochMs(a.session.startsAt) - toEpochMs(b.session.startsAt))[0]
    return {
      userId,
      ...this.profileOf(userId),
      balance: creditBalance(own, now),
      nextExpiry: active[0]?.expiresAt ?? null,
      nextBooking: next
        ? {
            bookingId: next.booking.id,
            sessionId: next.session.id,
            startsAt: next.session.startsAt,
            classTypeName: classTypes.find((ct) => ct.id === next.session.classTypeId)?.name ?? "—",
          }
        : null,
      anonymizedAt: this.state().anonymizedAt[userId] ?? null,
    }
  }

  private state() {
    return this.options.store.sharedState()
  }

  /** Demo profile, with any name the student saved through the profile step (shared state). */
  private profileOf(userId: string): { displayName: string | null; email: string | null } {
    if (this.state().anonymizedAt[userId]) return { displayName: null, email: null }
    const saved = this.state().displayNames[userId]
    return saved === undefined ? demoProfile(userId) : { ...demoProfile(userId), displayName: saved }
  }

  /** Write-side auth mirror: anonymous → unauthenticated, students → forbidden. */
  private writeDenied(): Extract<TransportCode, "unauthenticated" | "forbidden"> | null {
    const userId = this.userId()
    if (!userId) return "unauthenticated"
    return userId === DEMO_STAFF_ID ? null : "forbidden"
  }

  private toView(id: string): AdminSessionView | null {
    const { sessions, classTypes, bookings, instructorBySessionId } = this.state()
    const session = sessions.find((s) => s.id === id)
    const classType = session && classTypes.find((ct) => ct.id === session.classTypeId)
    if (!session || !classType) return null
    return structuredClone({
      session,
      classTypeName: classType.name,
      instructorName: instructorBySessionId[id] ?? null,
      isPublished: true,
      confirmedCount: availability(session, bookings).booked,
    })
  }

  private userId(): string | null {
    return this.options.currentUserId?.() ?? null
  }

  /** Mirrors the server: anonymous → unauthenticated, students → forbidden. */
  private requireStaff(): void {
    const userId = this.userId()
    if (!userId) throw new RepositoryError("unauthenticated")
    if (userId !== DEMO_STAFF_ID) throw new RepositoryError("forbidden")
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
  }
}
