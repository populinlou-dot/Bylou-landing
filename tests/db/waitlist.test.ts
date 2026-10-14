/**
 * Waitlist promotion races (Phase 4.4, ADR-021, DATA_MODEL §7 journey D, test D9) against the local Supabase DB.
 * Run: `supabase start && supabase db reset && pnpm run test:db`. Never part of `pnpm test`.
 *
 * Every journey opens its own connections and closes them at the end (the local pool has few free slots).
 * The churn throttle is off here: the same students book, cancel and join many sessions on purpose.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Actor, Admin, LOCK_GRANT, LOCK_SESSION, LOCK_WAITLIST_ENTRY, type RpcResult, type ThrottleLimits } from "./harness"

const ITERATIONS = 20

let admin: Admin
let savedThrottle: ThrottleLimits

beforeAll(async () => {
  admin = await Admin.connect()
  savedThrottle = await admin.throttle({ cancellations: null, perSession: null })
})

afterAll(async () => {
  if (savedThrottle) await admin.throttle(savedThrottle)
  await admin?.end()
})

async function students(n: number, credits = 100): Promise<Actor[]> {
  const created: Actor[] = []
  for (let i = 0; i < n; i++) {
    const userId = await admin.createUser()
    if (credits > 0) await admin.grant(userId, credits)
    created.push(await Actor.connect(userId))
  }
  return created
}

const closeAll = (actors: Actor[]) => Promise.all(actors.map((a) => a.end()))

interface SessionState {
  capacity: number
  confirmed_count: number
}

const sessionState = (sessionId: string) =>
  admin.one<SessionState>("select capacity, confirmed_count from public.sessions where id = $1", [sessionId])

/** Confirmed bookings + debit rows of one student on one session. */
async function holdings(sessionId: string, userId: string): Promise<{ bookings: number; waitlist: number; debits: number }> {
  return admin.one(
    `select (select count(*)::int from public.bookings b
              where b.session_id = $1 and b.user_id = $2 and b.status = 'confirmed') as bookings,
            (select count(*)::int from public.bookings b
              where b.session_id = $1 and b.user_id = $2 and b.status = 'confirmed' and b.source = 'waitlist') as waitlist,
            (select count(*)::int from public.credit_ledger l join public.bookings b on b.id = l.booking_id
              where b.session_id = $1 and b.user_id = $2 and l.reason = 'booking_debit') as debits`,
    [sessionId, userId],
  )
}

const entryStatus = async (entryId: string) =>
  (await admin.one<{ status: string }>("select status from public.waitlist_entries where id = $1", [entryId])).status

describe.sequential("journey D — waitlist promotion races", () => {
  it(`a cancellation and a new booking race for the freed spot → the waiting student gets it (×${ITERATIONS})`, async () => {
    const [holderA, holderB, waiter, booker] = await students(4)
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const session = await admin.session(2) // 72 h ahead → outside the 24 h window
        const booking = await holderA.book(session)
        expect(booking.ok).toBe(true)
        expect((await holderB.book(session)).ok).toBe(true)
        const joined = await waiter.joinWaitlist(session)
        expect(joined.ok).toBe(true)

        const [cancel, book] = await admin.race(LOCK_SESSION, [session], [holderA, booker], (a) =>
          a === holderA ? a.cancel(booking.booking_id as string) : a.book(session),
        )

        expect(cancel.ok).toBe(true)
        // Whatever the lock order, the spot never reaches the newcomer: before the cancel the class is full,
        // after it the spot already belongs to the waiting student (same transaction).
        expect(book.code).toBe("session_full")
        expect(await entryStatus(joined.entry_id as string)).toBe("promoted")
        expect(await holdings(session, waiter.userId)).toEqual({ bookings: 1, waitlist: 1, debits: 1 })
        expect(await sessionState(session)).toEqual({ capacity: 2, confirmed_count: 2 })
        expect(
          await admin.invariantViolations([session], [holderA, holderB, waiter, booker].map((a) => a.userId)),
        ).toEqual([])
      }
    } finally {
      await closeAll([holderA, holderB, waiter, booker])
    }
  })

  it(`two cancellations at once with one waiting student → promoted exactly once (×${ITERATIONS})`, async () => {
    const [holderA, holderB, waiter] = await students(3)
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const session = await admin.session(2)
        const a = await holderA.book(session)
        const b = await holderB.book(session)
        const joined = await waiter.joinWaitlist(session)
        expect([a.ok, b.ok, joined.ok]).toEqual([true, true, true])

        const results = await admin.race(LOCK_SESSION, [session], [holderA, holderB], (x) =>
          x.cancel((x === holderA ? a : b).booking_id as string),
        )

        expect(results.every((r) => r.ok)).toBe(true)
        expect(await holdings(session, waiter.userId)).toEqual({ bookings: 1, waitlist: 1, debits: 1 })
        // One spot refilled from the list, the other stays open for normal booking.
        expect(await sessionState(session)).toEqual({ capacity: 2, confirmed_count: 1 })
        expect(await admin.invariantViolations([session], [holderA, holderB, waiter].map((x) => x.userId))).toEqual([])
      }
    } finally {
      await closeAll([holderA, holderB, waiter])
    }
  })

  it(`a cancellation and a capacity increase at once → each waiting student promoted once, never over capacity (×${ITERATIONS})`, async () => {
    const [holder, first, second, third] = await students(4)
    const staff = await Actor.connect(await admin.staffId())
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const session = await admin.session(1)
        const booking = await holder.book(session)
        const joins: RpcResult[] = []
        for (const w of [first, second, third]) joins.push(await w.joinWaitlist(session))
        expect([booking.ok, ...joins.map((j) => j.ok)]).toEqual([true, true, true, true])

        const [cancel, grow] = await admin.race(LOCK_SESSION, [session], [holder, staff], (x) =>
          x === holder ? x.cancel(booking.booking_id as string) : x.updateCapacity(session, 2),
        )

        expect([cancel.ok, grow.ok]).toEqual([true, true])
        // Capacity 2, the holder left: the first two in line hold the two spots, the third keeps waiting.
        expect(await sessionState(session)).toEqual({ capacity: 2, confirmed_count: 2 })
        expect(await holdings(session, first.userId)).toEqual({ bookings: 1, waitlist: 1, debits: 1 })
        expect(await holdings(session, second.userId)).toEqual({ bookings: 1, waitlist: 1, debits: 1 })
        expect(await entryStatus(joins[2].entry_id as string)).toBe("waiting")
        // She leaves, so the 10-open-entries cap (too_many_waitlists) never trips across iterations.
        expect((await third.leaveWaitlist(session)).status).toBe("left")
        expect(
          await admin.invariantViolations([session], [holder, first, second, third].map((x) => x.userId)),
        ).toEqual([])
      }
    } finally {
      await closeAll([holder, first, second, third, staff])
    }
  })

  it(`D9: A cancels S1 where B waits while B cancels S2 where A waits → both commit, no deadlock (×${ITERATIONS})`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const userA = await admin.createUser()
      const userB = await admin.createUser()
      const grantA = await admin.grant(userA, 10)
      await admin.grant(userB, 10)
      const a = await Actor.connect(userA)
      const b = await Actor.connect(userB)
      try {
        const [s1, s2] = [await admin.session(1), await admin.session(1)]
        const bookingA = await a.book(s1)
        const bookingB = await b.book(s2)
        const joinB = await b.joinWaitlist(s1)
        const joinA = await a.joinWaitlist(s2)
        expect([bookingA.ok, bookingB.ok, joinA.ok, joinB.ok]).toEqual([true, true, true, true])

        // Both transactions need A's pack: the refund of A on S1 and the promotion of A on S2.
        const [ra, rb] = await admin.race(LOCK_GRANT, [grantA], [a, b], (x) =>
          x === a ? x.cancel(bookingA.booking_id as string) : x.cancel(bookingB.booking_id as string),
        )

        expect([ra.ok, rb.ok]).toEqual([true, true])
        expect(await holdings(s2, userA)).toEqual({ bookings: 1, waitlist: 1, debits: 1 })
        expect(await holdings(s1, userB)).toEqual({ bookings: 1, waitlist: 1, debits: 1 })
        expect(await admin.invariantViolations([s1, s2], [userA, userB])).toEqual([])
      } finally {
        await closeAll([a, b])
      }
    }
  })

  it(`erasure of a waiting student and a cancellation race → never an erased student with an upcoming booking (×${ITERATIONS})`, async () => {
    const [holder] = await students(1)
    const staff = await Actor.connect(await admin.staffId())
    const outcomes = { promoted: 0, erased: 0 }
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const userId = await admin.createUser()
        await admin.grant(userId, 5)
        const waiter = await Actor.connect(userId)
        try {
          const session = await admin.session(1)
          const booking = await holder.book(session)
          const joined = await waiter.joinWaitlist(session)
          expect([booking.ok, joined.ok]).toEqual([true, true])

          // Both the promotion (LOCK 3: waiting entries) and the erasure (her waiting entries) lock the entry.
          const [cancel, erase] = await admin.race(LOCK_WAITLIST_ENTRY, [joined.entry_id], [holder, staff], (x) =>
            x === holder ? x.cancel(booking.booking_id as string) : x.anonymize(userId, `race-${userId}@example.test`),
          )

          expect(cancel.ok).toBe(true)
          const status = await entryStatus(joined.entry_id as string)
          if (erase.ok) {
            expect(status).toBe("closed")
            expect(await sessionState(session)).toEqual({ capacity: 1, confirmed_count: 0 })
            outcomes.erased++
          } else {
            expect(erase.code).toBe("has_upcoming_bookings")
            expect(status).toBe("promoted")
            outcomes.promoted++
          }
          const { anonymized, upcoming } = await admin.one<{ anonymized: boolean; upcoming: number }>(
            `select p.anonymized_at is not null as anonymized,
                    (select count(*)::int from public.bookings b where b.user_id = p.id and b.status = 'confirmed') as upcoming
               from public.profiles p where p.id = $1`,
            [userId],
          )
          expect(anonymized && upcoming > 0).toBe(false)
          expect(await admin.invariantViolations([session], [holder.userId, userId])).toEqual([])
        } finally {
          await waiter.end()
        }
      }
    } finally {
      await closeAll([holder, staff])
    }
    expect(outcomes.promoted + outcomes.erased).toBe(ITERATIONS)
  })
})
