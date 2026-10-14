import { describe, expect, it } from "vitest"
import { DEFAULT_STUDIO_RULES } from "../config"
import { createBookingRuntime, resolveDataSource } from "./data-source"
import { MockBookingRepository } from "./mock"

const options = { rules: DEFAULT_STUDIO_RULES }

describe("resolveDataSource (ADR-013)", () => {
  it.each([undefined, null, "", "   "])("treats %j as missing", (raw) => {
    expect(resolveDataSource(raw)).toEqual({ ok: false, reason: "missing", received: null })
  })

  it.each(["Mock", "MOCK", "demo", "supabase-local", "true"])("rejects %j as invalid", (raw) => {
    expect(resolveDataSource(raw)).toEqual({ ok: false, reason: "invalid", received: raw })
  })

  it("accepts the two explicit sources", () => {
    expect(resolveDataSource("mock")).toEqual({ ok: true, source: "mock" })
    expect(resolveDataSource(" supabase ")).toEqual({ ok: true, source: "supabase" })
  })
})

describe("createBookingRuntime", () => {
  it("returns a config error for a missing source and never falls back to mock", () => {
    expect(createBookingRuntime(undefined, options)).toEqual({
      status: "config_error",
      reason: "missing",
      variable: "NEXT_PUBLIC_BOOKING_DATA_SOURCE",
      received: null,
    })
  })

  it("returns a config error carrying the invalid value", () => {
    expect(createBookingRuntime("prod", options)).toMatchObject({ status: "config_error", reason: "invalid", received: "prod" })
  })

  it("builds the demo runtime for mock", () => {
    const runtime = createBookingRuntime("mock", options)
    expect(runtime.status).toBe("ready")
    if (runtime.status !== "ready") return
    expect(runtime.isDemo).toBe(true)
    expect(runtime.repository).toBeInstanceOf(MockBookingRepository)
    expect(runtime.clock.now()).toBeInstanceOf(Date)
  })

  it("reports supabase as not available yet instead of using another adapter", () => {
    expect(createBookingRuntime("supabase", options)).toEqual({ status: "unavailable", source: "supabase" })
  })
})
