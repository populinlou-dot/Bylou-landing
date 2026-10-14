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
})
