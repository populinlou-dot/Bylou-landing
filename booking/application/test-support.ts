/** Test helpers for application use cases (no test-runner imports, no adapters). */
import type { Session, StudioRules } from "../domain"
import type {
  AdminClassTypeView,
  AdminRepository,
  AdminSessionView,
  AuthPort,
  AuthUser,
  BookingRepository,
  ClassTypeView,
  Clock,
  CreditBalance,
  MyBooking,
  RosterEntry,
  SessionAvailability,
  SessionPrivateDetails,
  StaffRole,
} from "./ports"

export const BA_RULES: StudioRules = {
  timezone: "America/Argentina/Buenos_Aires",
  bookingWindow: { opensDaysBefore: 30, closesMinutesBefore: 0 },
  cancellationWindowHours: 24,
  lateCancelPolicy: "allow_without_refund",
  creditsPerBooking: 1,
}

export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) })

export const CLASS_TYPES: ClassTypeView[] = [
  { id: "ct-individual", name: "Clase individual", durationMinutes: 60, defaultCapacity: 1, description: null },
  { id: "ct-grupal", name: "Clase grupal", durationMinutes: 60, defaultCapacity: 8, description: "Grupo reducido" },
]

export function availabilityAt(
  startsAt: string,
  overrides: { id?: string; classTypeId?: string; capacity?: number; confirmed?: number; status?: Session["status"]; minutes?: number } = {},
): SessionAvailability {
  const classTypeId = overrides.classTypeId ?? "ct-grupal"
  const classType = CLASS_TYPES.find((ct) => ct.id === classTypeId) ?? CLASS_TYPES[1]
  const minutes = overrides.minutes ?? 60
  return {
    session: {
      id: overrides.id ?? `s-${startsAt}`,
      classTypeId,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
      capacity: overrides.capacity ?? 8,
      modality: "online",
      status: overrides.status ?? "scheduled",
    },
    classType,
    confirmedCount: overrides.confirmed ?? 0,
    instructorName: "Lou",
    myBookingId: null,
    myWaitlistPosition: null,
  }
}

/** In-memory fake that records calls. `leakRange` returns every session regardless of range. */
export const DEFAULT_BALANCE: CreditBalance = {
  available: 3,
  nextExpiry: "2026-11-12T03:00:00.000Z",
  activeGrants: [
    {
      id: "g-1",
      total: 4,
      remaining: 3,
      validFrom: "2026-10-01T03:00:00.000Z",
      expiresAt: "2026-11-12T03:00:00.000Z",
      note: null,
    },
  ],
}

export interface FakeRepositoryOptions {
  rules?: StudioRules
  leakRange?: boolean
  myBookings?: MyBooking[]
  balance?: CreditBalance
  privateDetails?: Record<string, SessionPrivateDetails>
}

/**
 * In-memory fake that records calls. `leakRange` returns every session regardless of range.
 * Write methods succeed by default; tests override them with vi.spyOn.
 */
export function fakeRepository(
  sessions: SessionAvailability[],
  options: FakeRepositoryOptions = {},
): BookingRepository & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getStudioRules() {
      calls.push("getStudioRules")
      return options.rules ?? BA_RULES
    },
    async listClassTypes() {
      calls.push("listClassTypes")
      return CLASS_TYPES
    },
    async listSessions(range) {
      calls.push(`listSessions ${range.from} ${range.to}`)
      if (options.leakRange) return sessions
      return sessions.filter((s) => s.session.startsAt >= range.from && s.session.startsAt < range.to)
    },
    async getSession(id) {
      calls.push(`getSession ${id}`)
      return sessions.find((s) => s.session.id === id) ?? null
    },
    async getSessionPrivateDetails(sessionId) {
      calls.push(`getSessionPrivateDetails ${sessionId}`)
      return options.privateDetails?.[sessionId] ?? null
    },
    async listMyBookings() {
      calls.push("listMyBookings")
      return options.myBookings ?? []
    },
    async getMyCreditBalance() {
      calls.push("getMyCreditBalance")
      return options.balance ?? DEFAULT_BALANCE
    },
    async book(cmd) {
      calls.push(`book ${cmd.sessionId} ${cmd.idempotencyKey}`)
      return { ok: true, bookingId: `b-${cmd.sessionId}`, replayed: false, remainingCredits: 2 }
    },
    async cancel(cmd) {
      calls.push(`cancel ${cmd.bookingId} ${cmd.idempotencyKey}`)
      return { ok: true, bookingId: cmd.bookingId, status: "cancelled", refunded: true, replayed: false }
    },
  }
}

export const TEST_USER: AuthUser = { id: "user-1", email: "alumna@example.test" }

/** Auth fake: `setUser` simulates sign-in/out and notifies subscribers. */
export function fakeAuth(initial: AuthUser | null = TEST_USER): AuthPort & { setUser(user: AuthUser | null): void } {
  let user = initial
  const listeners = new Set<(user: AuthUser | null) => void>()
  return {
    async getUser() {
      return user
    },
    onChange(listener) {
      listeners.add(listener)
      listener(user)
      return () => listeners.delete(listener)
    },
    async requestCode() {
      return { ok: true }
    },
    async verifyCode(email) {
      user = { id: "user-1", email }
      listeners.forEach((l) => l(user))
      return { ok: true, user }
    },
    async signOut() {
      user = null
      listeners.forEach((l) => l(null))
    },
    setUser(next) {
      user = next
      listeners.forEach((l) => l(user))
    },
  }
}

/** Admin view of a session (any status/publication) for admin use-case and UI tests. */
export function adminSessionAt(
  startsAt: string,
  overrides: { id?: string; confirmed?: number; capacity?: number; status?: Session["status"]; minutes?: number; name?: string; published?: boolean } = {},
): AdminSessionView {
  const minutes = overrides.minutes ?? 60
  return {
    session: {
      id: overrides.id ?? `s-${startsAt}`,
      classTypeId: "ct-grupal",
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
      capacity: overrides.capacity ?? 8,
      modality: "in_person",
      status: overrides.status ?? "scheduled",
    },
    classTypeName: overrides.name ?? "Clase grupal",
    instructorName: "Lou",
    isPublished: overrides.published ?? true,
    confirmedCount: overrides.confirmed ?? 0,
  }
}

export function rosterEntry(id: string, overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    bookingId: id,
    userId: `u-${id}`,
    displayName: `Alumna ${id}`,
    email: `${id}@example.test`,
    status: "confirmed",
    attendance: "unknown",
    bookedAt: "2026-10-10T12:00:00.000Z",
    ...overrides,
  }
}

export const ADMIN_CLASS_TYPES: AdminClassTypeView[] = [
  {
    id: "ct-individual",
    name: "Clase individual",
    description: null,
    durationMinutes: 60,
    defaultCapacity: 1,
    defaultModality: "online",
    isPublished: true,
    sortOrder: 1,
  },
  {
    id: "ct-grupal",
    name: "Clase grupal",
    description: "Grupo reducido",
    durationMinutes: 75,
    defaultCapacity: 8,
    defaultModality: "in_person",
    isPublished: true,
    sortOrder: 2,
  },
  {
    id: "ct-archivada",
    name: "Práctica archivada",
    description: null,
    durationMinutes: 60,
    defaultCapacity: 6,
    defaultModality: "in_person",
    isPublished: false,
    sortOrder: 3,
  },
]

export interface FakeAdminOptions {
  role?: StaffRole | null
  sessions?: AdminSessionView[]
  roster?: Record<string, RosterEntry[]>
  classTypes?: AdminClassTypeView[]
}

/**
 * In-memory admin fake that records calls. Write methods succeed by default (echoing the
 * requested mark); tests override them with vi.spyOn.
 */
export function fakeAdminRepository(options: FakeAdminOptions = {}): AdminRepository & { calls: string[] } {
  const calls: string[] = []
  const sessions = options.sessions ?? []
  return {
    calls,
    async getMyRole() {
      calls.push("getMyRole")
      return options.role === undefined ? "staff" : options.role
    },
    async listSessions(range) {
      calls.push(`listSessions ${range.from} ${range.to}`)
      return sessions.filter((s) => s.session.startsAt >= range.from && s.session.startsAt < range.to)
    },
    async getSession(id) {
      calls.push(`getSession ${id}`)
      return sessions.find((s) => s.session.id === id) ?? null
    },
    async getRoster(sessionId) {
      calls.push(`getRoster ${sessionId}`)
      return options.roster?.[sessionId] ?? []
    },
    async markAttendance(cmd) {
      calls.push(`markAttendance ${cmd.bookingId} ${cmd.attendance}`)
      return { ok: true, bookingId: cmd.bookingId, attendance: cmd.attendance }
    },
    async listClassTypes() {
      calls.push("listClassTypes")
      return options.classTypes ?? ADMIN_CLASS_TYPES
    },
    async saveClassType(cmd) {
      calls.push(`saveClassType ${cmd.id}`)
      return { ok: true, classTypeId: cmd.id, created: true, isPublished: cmd.isPublished, upcomingSessions: 0 }
    },
    async createSessions(cmd) {
      calls.push(`createSessions ${cmd.requestKey} ${cmd.repeatWeeks}`)
      return { ok: true, sessionIds: Array.from({ length: cmd.repeatWeeks }, (_, i) => `new-${i + 1}`), replayed: false }
    },
    async updateSessionCapacity(cmd) {
      calls.push(`updateSessionCapacity ${cmd.sessionId} ${cmd.capacity}`)
      const confirmedCount = sessions.find((s) => s.session.id === cmd.sessionId)?.confirmedCount ?? 0
      return { ok: true, sessionId: cmd.sessionId, capacity: cmd.capacity, confirmedCount, changed: true }
    },
    async cancelSession(cmd) {
      calls.push(`cancelSession ${cmd.sessionId}`)
      const cancelledBookings = sessions.find((s) => s.session.id === cmd.sessionId)?.confirmedCount ?? 0
      return { ok: true, sessionId: cmd.sessionId, cancelledBookings, refunded: cancelledBookings, refundsSkipped: [], replayed: false }
    },
  }
}
