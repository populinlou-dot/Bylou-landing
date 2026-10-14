/**
 * In-memory BookingRepository for the `mock` data source (ADR-013). DEMO DATA ONLY:
 * the UI must show the "Datos de demostración" banner whenever this adapter is active.
 */
import { availability, toEpochMs, type StudioRules } from "../../domain"
import type {
  BookingRepository,
  ClassTypeView,
  Clock,
  InstantRange,
  SessionAvailability,
} from "../../application"
import { createDemoSeed, type DemoSeed } from "./demo-seed"

export interface MockBookingRepositoryOptions {
  clock: Clock
  /** Studio rules from the active brand defaults (ADR-014). */
  rules: StudioRules
  /** Artificial latency so loading states are visible in the demo. 0 in tests. */
  latencyMs?: number
}

export class MockBookingRepository implements BookingRepository {
  private seed: DemoSeed | null = null

  constructor(private readonly options: MockBookingRepositoryOptions) {}

  async getStudioRules(): Promise<StudioRules> {
    await this.delay()
    return structuredClone(this.options.rules)
  }

  async listClassTypes(): Promise<ClassTypeView[]> {
    await this.delay()
    return structuredClone(this.data().classTypes)
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

  /** Seeded once per instance from the clock, so ids stay stable while the page is open. */
  private data(): DemoSeed {
    if (!this.seed) this.seed = createDemoSeed(this.options.clock.now(), this.options.rules.timezone)
    return this.seed
  }

  private toAvailability(id: string): SessionAvailability | null {
    const { sessions, classTypes, bookings, instructorBySessionId } = this.data()
    const session = sessions.find((s) => s.id === id)
    const classType = session && classTypes.find((ct) => ct.id === session.classTypeId)
    if (!session || !classType) return null
    return structuredClone({
      session,
      classType,
      // Occupancy comes from the domain rule (only confirmed bookings take a spot).
      confirmedCount: availability(session, bookings).booked,
      instructorName: instructorBySessionId[id] ?? null,
      myBookingId: null,
      myWaitlistPosition: null,
    })
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
  }
}
