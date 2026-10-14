/**
 * In-memory AdminRepository for the `mock` data source. DEMO DATA ONLY: the admin shell shows
 * the "Datos de demostración" banner whenever this adapter is active (ADR-013).
 *
 * It reads and writes the same in-memory studio as MockBookingRepository and mirrors the
 * server contract: only the demo staff user (MockAuth, "staff@…") may read or write, attendance
 * follows the `mark_attendance` window (domain `attendanceWindow`), and the Phase 4.2 writes follow
 * `admin_upsert_class_type`, `create_session`, `admin_update_session` and `admin_cancel_session`
 * (same codes, same replay rules, all-or-nothing series).
 */
import { attendanceWindow, availability, toEpochMs, type Modality, type Session } from "../../domain"
import {
  RepositoryError,
  addDays,
  zonedTimeToInstant,
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
        ...demoProfile(b.userId),
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
      } else {
        refundsSkipped.push(booking.id)
      }
    }
    session.status = "cancelled"
    return { ok: true, sessionId: session.id, cancelledBookings, refunded: refundedCount, refundsSkipped, replayed: false }
  }

  private state() {
    return this.options.store.sharedState()
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
