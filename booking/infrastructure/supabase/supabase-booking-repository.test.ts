import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"
import { RepositoryError } from "../../application"
import { SupabaseBookingRepository } from "./supabase-booking-repository"

type Canned = { data: unknown; error: unknown; status: number }

/**
 * Chainable stand-in for the supabase-js query builder with one canned response per table.
 * Records every call so the tests pin down WHAT the adapter asks the API for.
 */
function fakeClient(options: { userId: string | null; tables?: Record<string, Canned> }) {
  const log: string[] = []
  const from = (table: string) => {
    log.push(`from(${table})`)
    const response = options.tables?.[table] ?? { data: [], error: null, status: 200 }
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "eq", "gte", "lt", "in", "order", "limit", "update"]) {
      builder[method] = (...args: unknown[]) => {
        log.push(`${method}(${args.map((a) => JSON.stringify(a)).join(", ")})`)
        return builder
      }
    }
    builder.maybeSingle = () => {
      log.push("maybeSingle()")
      return Promise.resolve(response)
    }
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(response).then(resolve, reject)
    return builder
  }
  const client = {
    auth: { getSession: async () => ({ data: { session: options.userId ? { user: { id: options.userId } } : null } }) },
    from,
  }
  return { log, provider: () => client as unknown as SupabaseClient }
}

const clock = { now: () => new Date("2026-10-14T15:00:00.000Z") }
const ok = (data: unknown): Canned => ({ data, error: null, status: 200 })

describe("SupabaseBookingRepository — agenda carries my attendance", () => {
  it("reads id + attendance of my confirmed bookings in the range and maps them per session", async () => {
    const { log, provider } = fakeClient({
      userId: "u1",
      tables: {
        session_availability: ok([
          {
            id: "s1",
            class_type_id: "ct1",
            class_type_name: "Grupal",
            starts_at: "2026-10-13T13:00:00+00:00",
            ends_at: "2026-10-13T14:00:00+00:00",
            modality: "online",
            instructor_name: "Lou",
            capacity: 8,
            confirmed_count: 3,
            status: "scheduled",
          },
        ]),
        bookings: ok([{ id: "b1", session_id: "s1", attendance: "no_show" }]),
      },
    })
    const sessions = await new SupabaseBookingRepository(provider, clock).listSessions({ from: "a", to: "b" })
    expect(sessions[0]).toMatchObject({ myBookingId: "b1", myAttendance: "no_show" })
    expect(log).toContain('select("id, session_id, attendance, session:sessions!inner(starts_at)")')
    expect(log).toContain('eq("user_id", "u1")')
    expect(log).toContain('eq("status", "confirmed")')
  })
})

describe("SupabaseBookingRepository — own profile", () => {
  it("getMyProfile reads only the caller's display_name", async () => {
    const { log, provider } = fakeClient({ userId: "u1", tables: { profiles: ok({ display_name: null }) } })
    expect(await new SupabaseBookingRepository(provider, clock).getMyProfile()).toEqual({ displayName: null })
    expect(log).toEqual(["from(profiles)", 'select("display_name")', 'eq("id", "u1")', "maybeSingle()"])
  })

  it("getMyProfile throws unauthenticated when signed out", async () => {
    const { log, provider } = fakeClient({ userId: null })
    await expect(new SupabaseBookingRepository(provider, clock).getMyProfile()).rejects.toBeInstanceOf(RepositoryError)
    expect(log).toEqual([])
  })

  it("updateMyDisplayName updates only display_name on the caller's own row", async () => {
    const { log, provider } = fakeClient({ userId: "u1", tables: { profiles: ok({ display_name: "Ana" }) } })
    expect(await new SupabaseBookingRepository(provider, clock).updateMyDisplayName("Ana")).toEqual({ ok: true, displayName: "Ana" })
    expect(log).toEqual(["from(profiles)", 'update({"display_name":"Ana"})', 'eq("id", "u1")', 'select("display_name")', "maybeSingle()"])
  })

  it("updateMyDisplayName maps refusals: signed out, CHECK violation, RLS-filtered row, permission", async () => {
    const signedOut = fakeClient({ userId: null })
    expect(await new SupabaseBookingRepository(signedOut.provider, clock).updateMyDisplayName("Ana")).toEqual({
      ok: false,
      code: "unauthenticated",
    })
    const check = fakeClient({
      userId: "u1",
      tables: { profiles: { data: null, error: { code: "23514", message: "check constraint" }, status: 400 } },
    })
    expect(await new SupabaseBookingRepository(check.provider, clock).updateMyDisplayName("x")).toEqual({
      ok: false,
      code: "invalid_input",
    })
    const filtered = fakeClient({ userId: "u1", tables: { profiles: ok(null) } })
    expect(await new SupabaseBookingRepository(filtered.provider, clock).updateMyDisplayName("Ana")).toEqual({
      ok: false,
      code: "forbidden",
    })
    const denied = fakeClient({
      userId: "u1",
      tables: { profiles: { data: null, error: { code: "42501", message: "permission denied" }, status: 403 } },
    })
    expect(await new SupabaseBookingRepository(denied.provider, clock).updateMyDisplayName("Ana")).toEqual({
      ok: false,
      code: "forbidden",
    })
  })
})
