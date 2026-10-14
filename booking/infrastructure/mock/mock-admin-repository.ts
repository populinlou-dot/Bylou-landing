/**
 * In-memory AdminRepository for the `mock` data source. DEMO DATA ONLY: the admin shell shows
 * the "Datos de demostración" banner whenever this adapter is active (ADR-013).
 *
 * It reads and writes the same in-memory studio as MockBookingRepository and mirrors the
 * server contract: only the demo staff user (MockAuth, "staff@…") may read or write, and
 * attendance follows the `mark_attendance` window (domain `attendanceWindow`).
 */
import { attendanceWindow, availability, toEpochMs } from "../../domain"
import {
  RepositoryError,
  type AdminRepository,
  type AdminSessionView,
  type Clock,
  type InstantRange,
  type MarkAttendanceCommand,
  type MarkAttendanceResult,
  type RosterEntry,
  type StaffRole,
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

export class MockAdminRepository implements AdminRepository {
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

  private state() {
    return this.options.store.sharedState()
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
