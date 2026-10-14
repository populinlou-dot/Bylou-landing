import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"
import { RepositoryError } from "../../application"
import { SupabaseAdminRepository } from "./supabase-admin-repository"

/**
 * Minimal chainable stand-in for the supabase-js query builder: records every call and
 * resolves with a canned response. Enough to pin down WHAT the adapter asks the API for.
 */
function fakeClient(options: { userId: string | null; response?: unknown; rpc?: unknown }) {
  const log: string[] = []
  const response = options.response ?? { data: [], error: null, status: 200 }
  const builder: Record<string, unknown> = {}
  for (const method of ["select", "eq", "gte", "lt", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      log.push(`${method}(${args.map((a) => JSON.stringify(a)).join(", ")})`)
      return builder
    }
  }
  builder.maybeSingle = () => {
    log.push("maybeSingle()")
    return Promise.resolve(response)
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(response).then(resolve, reject)
  const client = {
    auth: {
      getSession: async () => ({ data: { session: options.userId ? { user: { id: options.userId } } : null } }),
    },
    from: (table: string) => {
      log.push(`from(${table})`)
      return builder
    },
    rpc: async (fn: string, args: unknown) => {
      log.push(`rpc(${fn}, ${JSON.stringify(args)})`)
      return options.rpc ?? { data: null, error: null, status: 200 }
    },
  }
  return { log, provider: () => client as unknown as SupabaseClient }
}

describe("SupabaseAdminRepository", () => {
  it("getMyRole: signed out → null without any query", async () => {
    const { log, provider } = fakeClient({ userId: null })
    expect(await new SupabaseAdminRepository(provider).getMyRole()).toBeNull()
    expect(log).toEqual([])
  })

  it("getMyRole: reads only the caller's own role column", async () => {
    const { log, provider } = fakeClient({ userId: "u1", response: { data: { role: "staff" }, error: null, status: 200 } })
    expect(await new SupabaseAdminRepository(provider).getMyRole()).toBe("staff")
    expect(log).toEqual(["from(profiles)", 'select("role")', 'eq("id", "u1")', "maybeSingle()"])
  })

  it("getMyRole: missing profile row → student", async () => {
    const { provider } = fakeClient({ userId: "u1", response: { data: null, error: null, status: 200 } })
    expect(await new SupabaseAdminRepository(provider).getMyRole()).toBe("student")
  })

  it("listSessions: one bounded range query on sessions", async () => {
    const { log, provider } = fakeClient({ userId: "u1" })
    await new SupabaseAdminRepository(provider).listSessions({ from: "2026-10-14T03:00:00.000Z", to: "2026-10-15T03:00:00.000Z" })
    expect(log[0]).toBe("from(sessions)")
    expect(log).toContain('gte("starts_at", "2026-10-14T03:00:00.000Z")')
    expect(log).toContain('lt("starts_at", "2026-10-15T03:00:00.000Z")')
  })

  it("getRoster: explicit columns through the user_id FK embed", async () => {
    const { log, provider } = fakeClient({ userId: "u1" })
    await new SupabaseAdminRepository(provider).getRoster("s1")
    expect(log[0]).toBe("from(bookings)")
    expect(log[1]).toContain("profile:profiles!bookings_user_id_fkey(display_name, email)")
    expect(log[1]).not.toContain("*")
    expect(log).toContain('eq("session_id", "s1")')
  })

  it("reads throw unauthenticated when signed out; RLS/permission errors map to codes", async () => {
    const signedOut = fakeClient({ userId: null })
    await expect(new SupabaseAdminRepository(signedOut.provider).getRoster("s1")).rejects.toBeInstanceOf(RepositoryError)
    const denied = fakeClient({ userId: "u1", response: { data: null, error: { code: "42501", message: "permission denied" }, status: 403 } })
    await expect(new SupabaseAdminRepository(denied.provider).listSessions({ from: "a", to: "b" })).rejects.toMatchObject({
      code: "forbidden",
    })
  })

  it("getSession: malformed id → null", async () => {
    const { provider } = fakeClient({ userId: "u1", response: { data: null, error: { code: "22P02", message: "bad uuid" }, status: 400 } })
    expect(await new SupabaseAdminRepository(provider).getSession("x")).toBeNull()
  })

  it("markAttendance: calls the RPC and maps forbidden", async () => {
    const ok = fakeClient({ userId: "u1", rpc: { data: { ok: true, booking_id: "b1", attendance: "attended" }, error: null, status: 200 } })
    expect(await new SupabaseAdminRepository(ok.provider).markAttendance({ bookingId: "b1", attendance: "attended" })).toEqual({
      ok: true,
      bookingId: "b1",
      attendance: "attended",
    })
    expect(ok.log).toEqual(['rpc(mark_attendance, {"p_booking_id":"b1","p_attendance":"attended"})'])
    const denied = fakeClient({ userId: "u1", rpc: { data: null, error: { code: "42501", message: "forbidden" }, status: 403 } })
    expect(await new SupabaseAdminRepository(denied.provider).markAttendance({ bookingId: "b1", attendance: "attended" })).toEqual({
      ok: false,
      code: "forbidden",
    })
    const anon = fakeClient({ userId: null })
    expect(await new SupabaseAdminRepository(anon.provider).markAttendance({ bookingId: "b1", attendance: "attended" })).toEqual({
      ok: false,
      code: "unauthenticated",
    })
  })

  it("listClassTypes: explicit admin columns, every row (RLS lets staff read drafts/archived)", async () => {
    const { log, provider } = fakeClient({ userId: "u1" })
    await new SupabaseAdminRepository(provider).listClassTypes()
    expect(log[0]).toBe("from(class_types)")
    expect(log[1]).toBe('select("id, name, description, default_duration_minutes, default_capacity, default_modality, is_published, sort_order")')
    expect(log.some((l) => l.startsWith("eq("))).toBe(false)
  })

  it("saveClassType: admin_upsert_class_type with snake_case args", async () => {
    const { log, provider } = fakeClient({
      userId: "u1",
      rpc: { data: { ok: true, class_type_id: "c1", created: true, is_published: true, upcoming_sessions: 0 }, error: null, status: 200 },
    })
    const result = await new SupabaseAdminRepository(provider).saveClassType({
      id: "c1",
      name: "Hatha",
      description: null,
      durationMinutes: 60,
      defaultCapacity: 8,
      defaultModality: "online",
      isPublished: true,
    })
    expect(result).toMatchObject({ ok: true, created: true })
    expect(log).toEqual([
      'rpc(admin_upsert_class_type, {"p_id":"c1","p_name":"Hatha","p_description":null,"p_default_duration_minutes":60,' +
        '"p_default_capacity":8,"p_default_modality":"online","p_is_published":true})',
    ])
  })

  it("createSessions: one create_session call carrying the request key and repeat weeks", async () => {
    const { log, provider } = fakeClient({
      userId: "u1",
      rpc: { data: { ok: true, session_ids: ["s1", "s2"], replayed: false }, error: null, status: 200 },
    })
    const result = await new SupabaseAdminRepository(provider).createSessions({
      requestKey: "k1",
      classTypeId: "c1",
      localDate: "2026-10-15",
      localStart: "18:00",
      durationMinutes: 60,
      capacity: 8,
      modality: "online",
      locationLabel: null,
      address: null,
      meetingUrl: "https://meet.example.test/x",
      instructorName: "Lou",
      repeatWeeks: 2,
    })
    expect(result).toEqual({ ok: true, sessionIds: ["s1", "s2"], replayed: false })
    expect(log).toEqual([
      'rpc(create_session, {"p_request_key":"k1","p_class_type_id":"c1","p_local_date":"2026-10-15","p_local_start":"18:00",' +
        '"p_duration_minutes":60,"p_capacity":8,"p_modality":"online","p_instructor_name":"Lou","p_location_label":null,' +
        '"p_meeting_url":"https://meet.example.test/x","p_address":null,"p_repeat_weeks":2,"p_is_published":true})',
    ])
  })

  it("createSessions: SQLSTATE 22023 (past start, archived type) → invalid_input", async () => {
    const { provider } = fakeClient({ userId: "u1", rpc: { data: null, error: { code: "22023", message: "invalid_input" }, status: 400 } })
    const result = await new SupabaseAdminRepository(provider).createSessions({
      requestKey: "k1",
      classTypeId: "c1",
      localDate: "2026-10-15",
      localStart: "18:00",
      durationMinutes: 60,
      capacity: 8,
      modality: "in_person",
      locationLabel: null,
      address: "x",
      meetingUrl: null,
      instructorName: null,
      repeatWeeks: 1,
    })
    expect(result).toEqual({ ok: false, code: "invalid_input" })
  })

  it("updateSessionCapacity and cancelSession call their RPCs; cancel sends no reason", async () => {
    const update = fakeClient({
      userId: "u1",
      rpc: { data: { ok: false, code: "capacity_below_bookings", confirmed_count: 3 }, error: null, status: 200 },
    })
    expect(await new SupabaseAdminRepository(update.provider).updateSessionCapacity({ sessionId: "s1", capacity: 2 })).toEqual({
      ok: false,
      code: "capacity_below_bookings",
      confirmedCount: 3,
    })
    expect(update.log).toEqual(['rpc(admin_update_session, {"p_session_id":"s1","p_capacity":2})'])

    const cancel = fakeClient({
      userId: "u1",
      rpc: {
        data: { ok: true, session_id: "s1", cancelled_bookings: 1, refunded: 1, refunds_skipped: [], replayed: false },
        error: null,
        status: 200,
      },
    })
    expect(await new SupabaseAdminRepository(cancel.provider).cancelSession({ sessionId: "s1" })).toMatchObject({ ok: true, refunded: 1 })
    expect(cancel.log).toEqual(['rpc(admin_cancel_session, {"p_session_id":"s1"})'])
  })

  it("writes are unauthenticated without a session and make no call", async () => {
    const anon = fakeClient({ userId: null })
    const repo = new SupabaseAdminRepository(anon.provider)
    expect(await repo.updateSessionCapacity({ sessionId: "s1", capacity: 2 })).toEqual({ ok: false, code: "unauthenticated" })
    expect(await repo.cancelSession({ sessionId: "s1" })).toEqual({ ok: false, code: "unauthenticated" })
    await expect(repo.listClassTypes()).rejects.toMatchObject({ code: "unauthenticated" })
    expect(anon.log).toEqual([])
  })

  /* ---------- Phase 4.3: students + credits ---------- */

  it("searchStudents: staff read RPC (server-computed balance); blank query → null", async () => {
    const student = { user_id: "u2", display_name: "Ana", email: null, balance: 2, next_expiry: null, next_booking: null }
    const { log, provider } = fakeClient({ userId: "u1", rpc: { data: { ok: true, students: [student] }, error: null, status: 200 } })
    const repo = new SupabaseAdminRepository(provider)
    expect(await repo.searchStudents("ana")).toEqual([
      { userId: "u2", displayName: "Ana", email: null, balance: 2, nextExpiry: null, nextBooking: null, anonymizedAt: null },
    ])
    await repo.searchStudents("")
    expect(log).toEqual([
      'rpc(admin_search_students, {"p_query":"ana","p_limit":50})',
      'rpc(admin_search_students, {"p_query":null,"p_limit":50})',
    ])
  })

  it("searchStudents: forbidden and unrecognised envelopes throw", async () => {
    const denied = fakeClient({ userId: "u1", rpc: { data: null, error: { code: "42501", message: "forbidden" }, status: 403 } })
    await expect(new SupabaseAdminRepository(denied.provider).searchStudents("x")).rejects.toMatchObject({ code: "forbidden" })
    const junk = fakeClient({ userId: "u1", rpc: { data: { ok: true }, error: null, status: 200 } })
    await expect(new SupabaseAdminRepository(junk.provider).searchStudents("x")).rejects.toMatchObject({ code: "unknown" })
  })

  it("getStudent: not_found and a malformed id → null", async () => {
    const missing = fakeClient({ userId: "u1", rpc: { data: { ok: false, code: "not_found" }, error: null, status: 200 } })
    expect(await new SupabaseAdminRepository(missing.provider).getStudent("u2")).toBeNull()
    expect(missing.log).toEqual(['rpc(admin_student_summary, {"p_user_id":"u2"})'])
    const malformed = fakeClient({ userId: "u1", rpc: { data: null, error: { code: "22P02", message: "bad uuid" }, status: 400 } })
    expect(await new SupabaseAdminRepository(malformed.provider).getStudent("x")).toBeNull()
  })

  it("packs, bookings and ledger: RLS table reads scoped to the student, explicit columns", async () => {
    const { log, provider } = fakeClient({ userId: "u1" })
    const repo = new SupabaseAdminRepository(provider)
    await repo.listStudentGrants("u2")
    await repo.listStudentBookings("u2")
    await repo.listStudentLedger("u2")
    expect(log.filter((l) => l.startsWith("from("))).toEqual(["from(credit_grants)", "from(bookings)", "from(credit_ledger)"])
    expect(log.filter((l) => l === 'eq("user_id", "u2")')).toHaveLength(3)
    expect(log.filter((l) => l.startsWith("select(")).every((l) => !l.includes("*"))).toBe(true)
    expect(log).toContain('select("id, user_id, grant_id, booking_id, reason, delta, note, actor_id, created_at")')
  })

  it("write RPCs carry snake_case args and the request key", async () => {
    const grant = fakeClient({
      userId: "u1",
      rpc: { data: { ok: true, grant_id: "g", credits: 4, expires_at: "2026-11-13T03:00:00+00:00", replayed: false }, error: null, status: 200 },
    })
    await new SupabaseAdminRepository(grant.provider).grantCredits({ userId: "u2", credits: 4, validDays: 30, note: null, requestKey: "k" })
    expect(grant.log).toEqual(['rpc(grant_credits, {"p_user_id":"u2","p_credits":4,"p_valid_days":30,"p_note":null,"p_idempotency_key":"k"})'])

    const adjust = fakeClient({ userId: "u1", rpc: { data: { ok: false, code: "insufficient_balance", credits_remaining: 0 }, error: null, status: 200 } })
    expect(await new SupabaseAdminRepository(adjust.provider).adjustCredits({ grantId: "g", delta: -1, reason: "x", requestKey: "k" })).toEqual({
      ok: false,
      code: "insufficient_balance",
      creditsRemaining: 0,
    })
    expect(adjust.log).toEqual(['rpc(admin_adjust_credits, {"p_grant_id":"g","p_delta":-1,"p_reason":"x","p_request_key":"k"})'])

    const book = fakeClient({ userId: "u1", rpc: { data: { ok: false, code: "session_full" }, error: null, status: 200 } })
    expect(await new SupabaseAdminRepository(book.provider).bookForStudent({ userId: "u2", sessionId: "s", requestKey: "k" })).toEqual({
      ok: false,
      code: "session_full",
    })
    expect(book.log).toEqual(['rpc(admin_book_for, {"p_user_id":"u2","p_session_id":"s","p_request_key":"k"})'])

    const cancel = fakeClient({
      userId: "u1",
      rpc: { data: { ok: true, booking_id: "b", refunded: true, refund_skipped: false, replayed: false }, error: null, status: 200 },
    })
    expect(await new SupabaseAdminRepository(cancel.provider).cancelForStudent({ bookingId: "b", refund: true })).toMatchObject({ ok: true })
    expect(cancel.log).toEqual(['rpc(admin_cancel_for, {"p_booking_id":"b","p_refund":true})'])
  })

  it("anonymizeStudent: admin_anonymize_student with the typed email; 42501 → forbidden (ADR-020)", async () => {
    const ok = fakeClient({
      userId: "u1",
      rpc: { data: { ok: true, user_id: "u2", anonymized_at: "2026-10-14T15:00:00+00:00", replayed: false }, error: null, status: 200 },
    })
    expect(await new SupabaseAdminRepository(ok.provider).anonymizeStudent({ userId: "u2", confirmEmail: "Ana@Example.test" })).toEqual({
      ok: true,
      userId: "u2",
      anonymizedAt: "2026-10-14T15:00:00.000Z",
      replayed: false,
    })
    expect(ok.log).toEqual(['rpc(admin_anonymize_student, {"p_user_id":"u2","p_confirm_email":"Ana@Example.test"})'])
    const denied = fakeClient({ userId: "u1", rpc: { data: null, error: { code: "42501", message: "forbidden" }, status: 403 } })
    expect(await new SupabaseAdminRepository(denied.provider).anonymizeStudent({ userId: "u2", confirmEmail: "a@b.c" })).toEqual({
      ok: false,
      code: "forbidden",
    })
    const anon = fakeClient({ userId: null })
    expect(await new SupabaseAdminRepository(anon.provider).anonymizeStudent({ userId: "u2", confirmEmail: "a@b.c" })).toEqual({
      ok: false,
      code: "unauthenticated",
    })
    expect(anon.log).toEqual([])
  })

  it("Phase 4.3 writes are unauthenticated without a session and make no call", async () => {
    const anon = fakeClient({ userId: null })
    const repo = new SupabaseAdminRepository(anon.provider)
    expect(await repo.adjustCredits({ grantId: "g", delta: 1, reason: "x", requestKey: "k" })).toEqual({ ok: false, code: "unauthenticated" })
    expect(await repo.bookForStudent({ userId: "u", sessionId: "s", requestKey: "k" })).toEqual({ ok: false, code: "unauthenticated" })
    await expect(repo.searchStudents("x")).rejects.toMatchObject({ code: "unauthenticated" })
    expect(anon.log).toEqual([])
  })
})
