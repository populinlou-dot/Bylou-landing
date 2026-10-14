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
