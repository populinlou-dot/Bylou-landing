/**
 * Concurrency proofs against the local Supabase DB (DATA_MODEL §7, §12 B2/B3/B5, C2/C5, C6, D).
 * Run: `supabase start && supabase db reset && pnpm run test:db`. Never part of `pnpm test`.
 */
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Actor, Admin, LOCK_GRANT, LOCK_SESSION, type RpcResult } from "./harness"

const ITERATIONS = 20

let admin: Admin
const actors: Actor[] = []

async function actorsFor(n: number, credits = 100): Promise<Actor[]> {
  const created: Actor[] = []
  for (let i = 0; i < n; i++) {
    const userId = await admin.createUser()
    if (credits > 0) await admin.grant(userId, credits)
    created.push(await Actor.connect(userId))
  }
  actors.push(...created)
  return created
}

const codes = (results: RpcResult[]) => results.map((r) => (r.ok ? "ok" : r.code))
const count = (results: RpcResult[], code: string) => codes(results).filter((c) => c === code).length

beforeAll(async () => {
  admin = await Admin.connect()
})

afterAll(async () => {
  await Promise.all(actors.map((a) => a.end()))
  await admin?.end()
})

describe.sequential("journey B — last spot", () => {
  it(`B2: 8 students race for the last spot → exactly one confirmed (×${ITERATIONS})`, async () => {
    const [fillerA, fillerB, ...racers] = await actorsFor(10)
    for (let i = 0; i < ITERATIONS; i++) {
      const session = await admin.session(3)
      expect((await fillerA.book(session)).ok).toBe(true)
      expect((await fillerB.book(session)).ok).toBe(true)

      const results = await admin.race(LOCK_SESSION, [session], racers, (a) => a.book(session))

      expect(count(results, "ok")).toBe(1)
      expect(count(results, "session_full")).toBe(racers.length - 1)
      const row = await admin.one<{ confirmed_count: number; confirmed: number; debits: number }>(
        `select s.confirmed_count,
                (select count(*)::int from public.bookings b where b.session_id = s.id and b.status = 'confirmed') as confirmed,
                (select count(*)::int from public.credit_ledger l join public.bookings b on b.id = l.booking_id
                  where b.session_id = s.id and l.reason = 'booking_debit') as debits
           from public.sessions s where s.id = $1`,
        [session],
      )
      expect(row).toEqual({ confirmed_count: 3, confirmed: 3, debits: 3 })
      expect(await admin.invariantViolations([session], [fillerA, fillerB, ...racers].map((a) => a.userId))).toEqual([])
    }
  })

  it("B3: 20 parallel bookings, capacity 5 → exactly 5 confirmed (×10)", async () => {
    const racers = await actorsFor(20)
    for (let i = 0; i < 10; i++) {
      const session = await admin.session(5)
      const results = await admin.race(LOCK_SESSION, [session], racers, (a) => a.book(session))
      expect(count(results, "ok")).toBe(5)
      expect(count(results, "session_full")).toBe(15)
      const { confirmed_count } = await admin.one<{ confirmed_count: number }>(
        "select confirmed_count from public.sessions where id = $1",
        [session],
      )
      expect(confirmed_count).toBe(5)
      expect(await admin.invariantViolations([session], racers.map((a) => a.userId))).toEqual([])
    }
  })
})

describe.sequential("journey C — retries and double taps", () => {
  it(`C2: same student + same key on 6 connections → one booking, one debit (×${ITERATIONS})`, async () => {
    const [student] = await actorsFor(1)
    const twins = [student]
    for (let i = 0; i < 5; i++) {
      const twin = await Actor.connect(student.userId)
      actors.push(twin)
      twins.push(twin)
    }
    for (let i = 0; i < ITERATIONS; i++) {
      const session = await admin.session(5)
      const key = randomUUID()
      const results = await admin.race(LOCK_SESSION, [session], twins, (a) => a.book(session, key))

      expect(results.every((r) => r.ok)).toBe(true)
      expect(new Set(results.map((r) => r.booking_id)).size).toBe(1)
      expect(results.filter((r) => r.replayed === false)).toHaveLength(1)
      const row = await admin.one<{ bookings: number; debits: number }>(
        `select (select count(*)::int from public.bookings where session_id = $1) as bookings,
                (select count(*)::int from public.credit_ledger l join public.bookings b on b.id = l.booking_id
                  where b.session_id = $1 and l.reason = 'booking_debit') as debits`,
        [session],
      )
      expect(row).toEqual({ bookings: 1, debits: 1 })
      expect(await admin.invariantViolations([session], [student.userId])).toEqual([])
    }
    const { remaining } = await admin.one<{ remaining: number }>(
      "select sum(credits_remaining)::int as remaining from public.credit_grants where user_id = $1",
      [student.userId],
    )
    expect(remaining).toBe(100 - ITERATIONS)
  })

  it(`C5: one credit, two sessions, two connections → one ok, one no_valid_credit (×${ITERATIONS})`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const userId = await admin.createUser()
      const grant = await admin.grant(userId, 1)
      const a = await Actor.connect(userId)
      const b = await Actor.connect(userId)
      actors.push(a, b)
      const [s1, s2] = [await admin.session(5), await admin.session(5)]

      // Different session locks; both contend on the student's single grant (LOCK 4).
      const [r1, r2] = await admin.race(LOCK_GRANT, [grant], [a, b], (x) => x.book(x === a ? s1 : s2))

      expect(codes([r1, r2]).sort()).toEqual(["no_valid_credit", "ok"])
      const { remaining } = await admin.one<{ remaining: number }>(
        "select credits_remaining as remaining from public.credit_grants where id = $1",
        [grant],
      )
      expect(remaining).toBe(0)
      expect(await admin.invariantViolations([s1, s2], [userId])).toEqual([])
    }
  })
})

describe.sequential("journey D — cancel vs book", () => {
  it(`B5/D: cancel + book on a full session stay consistent (×${ITERATIONS})`, async () => {
    const [canceller, holder, booker] = await actorsFor(3)
    const outcomes = { bookerWon: 0, bookerFull: 0 }
    for (let i = 0; i < ITERATIONS; i++) {
      const session = await admin.session(2) // 72 h ahead → outside the 24 h window → refund
      const booking = await canceller.book(session)
      expect((await holder.book(session)).ok).toBe(true)

      const [cancel, book] = await admin.race(LOCK_SESSION, [session], [canceller, booker], (a) =>
        a === canceller ? a.cancel(String(booking.booking_id)) : a.book(session),
      )

      expect(cancel).toMatchObject({ ok: true, status: "cancelled", refunded: true, replayed: false })
      expect(["ok", "session_full"]).toContain(book.ok ? "ok" : book.code)
      if (book.ok) outcomes.bookerWon++
      else outcomes.bookerFull++

      const { confirmed_count } = await admin.one<{ confirmed_count: number }>(
        "select confirmed_count from public.sessions where id = $1",
        [session],
      )
      expect(confirmed_count).toBe(book.ok ? 2 : 1)
      expect(await admin.invariantViolations([session], [canceller, holder, booker].map((a) => a.userId))).toEqual([])
    }
    expect(outcomes.bookerWon + outcomes.bookerFull).toBe(ITERATIONS)
  })

  it(`C6: the same booking cancelled on 4 connections → exactly one refund (×${ITERATIONS})`, async () => {
    const [student] = await actorsFor(1)
    const twins = [student]
    for (let i = 0; i < 3; i++) {
      const twin = await Actor.connect(student.userId)
      actors.push(twin)
      twins.push(twin)
    }
    for (let i = 0; i < ITERATIONS; i++) {
      const session = await admin.session(5)
      const booking = String((await student.book(session)).booking_id)
      const results = await admin.race(LOCK_SESSION, [session], twins, (a) => a.cancel(booking))

      expect(results.every((r) => r.ok && r.status === "cancelled" && r.refunded === true)).toBe(true)
      expect(results.filter((r) => r.replayed === false)).toHaveLength(1)
      const { refunds } = await admin.one<{ refunds: number }>(
        "select count(*)::int as refunds from public.credit_ledger where booking_id = $1 and reason = 'cancel_refund'",
        [booking],
      )
      expect(refunds).toBe(1)
      expect(await admin.invariantViolations([session], [student.userId])).toEqual([])
    }
  })
})

describe.sequential("journey AD-05.1 — capacity edit vs book", () => {
  it(`3 bookings race a capacity decrease to 2 → never more confirmed than capacity (×${ITERATIONS})`, async () => {
    const [filler, ...bookers] = await actorsFor(4)
    const staff = await Actor.connect(await admin.staffId())
    actors.push(staff)
    const outcomes = { reduced: 0, refused: 0 }
    for (let i = 0; i < ITERATIONS; i++) {
      const session = await admin.session(4)
      expect((await filler.book(session)).ok).toBe(true)

      const racers = [staff, ...bookers]
      const results = await admin.race(LOCK_SESSION, [session], racers, (a) =>
        a === staff ? a.updateCapacity(session, 2) : a.book(session),
      )
      const [update, ...books] = results
      const booked = count(books, "ok")
      const row = await admin.one<{ capacity: number; confirmed_count: number }>(
        "select capacity, confirmed_count from public.sessions where id = $1",
        [session],
      )

      expect(row.confirmed_count).toBe(1 + booked)
      expect(row.confirmed_count).toBeLessThanOrEqual(row.capacity)
      if (update.ok) {
        outcomes.reduced++
        expect(row.capacity).toBe(2)
        expect(booked).toBeLessThanOrEqual(1)
      } else {
        outcomes.refused++
        expect(update.code).toBe("capacity_below_bookings")
        expect(row.capacity).toBe(4)
        expect(booked).toBeGreaterThanOrEqual(2)
      }
      expect(codes(books).every((c) => c === "ok" || c === "session_full")).toBe(true)
      expect(await admin.invariantViolations([session], [filler, ...bookers].map((a) => a.userId))).toEqual([])
    }
    expect(outcomes.reduced + outcomes.refused).toBe(ITERATIONS)
  })
})

describe.sequential("journey AD-10 — staff books for a student vs a student booking", () => {
  it(`admin_book_for and book_session race for the last spot → never over capacity (×${ITERATIONS})`, async () => {
    const [filler, student, onBehalf] = await actorsFor(3)
    const staff = await Actor.connect(await admin.staffId())
    actors.push(staff)
    const outcomes = { staff: 0, student: 0 }
    for (let i = 0; i < ITERATIONS; i++) {
      const session = await admin.session(2)
      expect((await filler.book(session)).ok).toBe(true)

      const [byStaff, byStudent] = await admin.race(LOCK_SESSION, [session], [staff, student], (a) =>
        a === staff ? a.bookFor(onBehalf.userId, session) : a.book(session),
      )

      expect(codes([byStaff, byStudent]).sort()).toEqual(["ok", "session_full"])
      if (byStaff.ok) outcomes.staff++
      else outcomes.student++
      const { confirmed_count, capacity } = await admin.one<{ confirmed_count: number; capacity: number }>(
        "select confirmed_count, capacity from public.sessions where id = $1",
        [session],
      )
      expect(confirmed_count).toBe(2)
      expect(confirmed_count).toBeLessThanOrEqual(capacity)
      expect(await admin.invariantViolations([session], [filler, student, onBehalf].map((a) => a.userId))).toEqual([])
    }
    expect(outcomes.staff + outcomes.student).toBe(ITERATIONS)
  })
})

describe.sequential("journey AD-08.2 — credit adjustment vs booking", () => {
  it(`admin_adjust_credits(-1) and book_session race for the last credit → one wins, never negative (×${ITERATIONS})`, async () => {
    const staff = await Actor.connect(await admin.staffId())
    actors.push(staff)
    for (let i = 0; i < ITERATIONS; i++) {
      const userId = await admin.createUser()
      const grant = await admin.grant(userId, 1)
      const student = await Actor.connect(userId)
      const session = await admin.session(5)

      // book_session locks the session, then the grant; the adjustment locks only the grant.
      const [adjust, book] = await admin.race(LOCK_GRANT, [grant], [staff, student], (a) =>
        a === staff ? a.adjust(grant, -1) : a.book(session),
      )

      expect(codes([adjust, book]).sort()).toEqual(adjust.ok ? ["no_valid_credit", "ok"] : ["insufficient_balance", "ok"])
      const { remaining } = await admin.one<{ remaining: number }>(
        "select credits_remaining as remaining from public.credit_grants where id = $1",
        [grant],
      )
      expect(remaining).toBe(0)
      expect(await admin.invariantViolations([session], [userId])).toEqual([])
      await student.end() // one connection per iteration would exhaust the local pool
    }
  })
})

describe.sequential("journey D10 — credit-expiry job", () => {
  const expiryRows = async (grantId: string) =>
    (
      await admin.one<{ n: number }>(
        "select count(*)::int as n from public.credit_ledger where grant_id = $1 and reason = 'expiry'",
        [grantId],
      )
    ).n

  it("a pack locked by an in-flight transaction is skipped (never waits), then expired on the next run", async () => {
    const userId = await admin.createUser()
    const grant = await admin.expiredGrant(userId, 3)
    const gate = await Admin.connect()
    try {
      await gate.client.query("begin")
      await gate.client.query(LOCK_GRANT, [grant])
      await admin.expireCredits() // returns at once: SKIP LOCKED
      expect(await expiryRows(grant)).toBe(0)
      await gate.client.query("rollback")
    } finally {
      await gate.end()
    }
    await admin.expireCredits()
    expect(await expiryRows(grant)).toBe(1)
    expect(await admin.invariantViolations([], [userId])).toEqual([])
  })

  it(`3 job runs in parallel → exactly one expiry row per pack (×${ITERATIONS})`, async () => {
    // The owner connection + 2 more: earlier journeys keep their actors open until afterAll (pool limit).
    const runners = [admin, ...(await Promise.all([Admin.connect(), Admin.connect()]))]
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        const userId = await admin.createUser()
        const grants: string[] = []
        for (const credits of [1, 2, 3]) grants.push(await admin.expiredGrant(userId, credits)) // one client: sequential
        await Promise.all(runners.map((r) => r.expireCredits()))
        for (const grant of grants) expect(await expiryRows(grant)).toBe(1)
        const { sum, balance } = await admin.one<{ sum: number; balance: number }>(
          `select (select sum(delta)::int from public.credit_ledger where user_id = $1) as sum,
                  private.usable_balance($1) as balance`,
          [userId],
        )
        expect(sum).toBe(balance)
        expect(await admin.invariantViolations([], [userId])).toEqual([])
      }
    } finally {
      await Promise.all(runners.slice(1).map((r) => r.end()))
    }
  })
})
