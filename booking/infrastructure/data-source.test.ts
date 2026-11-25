import { describe, expect, it } from "vitest"
import { DEFAULT_STUDIO_RULES } from "../config"
import { createBookingAdapters, createBookingRuntime, resolveDataSource } from "./data-source"
import { MockAdminRepository, MockAuth, MockBookingRepository } from "./mock"
import { SupabaseAdminRepository, SupabaseAuth, SupabaseBookingRepository, resolveCaptchaConfig } from "./supabase"

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

  it("wires the mock auth with the mock repository", () => {
    const runtime = createBookingRuntime("mock", options)
    expect(runtime.status === "ready" && runtime.auth).toBeInstanceOf(MockAuth)
  })
})

// Fake, locally built tokens: header.payload.signature with the given role claim.
const jwtWithRole = (role: string) =>
  ["e30", btoa(JSON.stringify({ role })).replace(/=+$/, ""), "sig"].join(".")
const ANON_KEY = jwtWithRole("anon")
const LOCAL_URL = "http://127.0.0.1:54321"

describe("createBookingRuntime — supabase (ADR-013: never falls back to mock)", () => {
  it("builds Supabase adapters when URL and anon key are present", () => {
    const runtime = createBookingRuntime("supabase", { ...options, supabase: { url: LOCAL_URL, anonKey: ANON_KEY } })
    expect(runtime.status).toBe("ready")
    if (runtime.status !== "ready") return
    expect(runtime.isDemo).toBe(false)
    expect(runtime.repository).toBeInstanceOf(SupabaseBookingRepository)
    expect(runtime.auth).toBeInstanceOf(SupabaseAuth)
  })

  it("accepts new-style publishable keys", () => {
    const runtime = createBookingRuntime("supabase", {
      ...options,
      supabase: { url: LOCAL_URL, anonKey: "sb_publishable_example" },
    })
    expect(runtime.status).toBe("ready")
  })

  it.each([
    [{}, "missing", "NEXT_PUBLIC_SUPABASE_URL", null],
    [{ url: "  " , anonKey: ANON_KEY }, "missing", "NEXT_PUBLIC_SUPABASE_URL", null],
    [{ url: "not a url", anonKey: ANON_KEY }, "invalid", "NEXT_PUBLIC_SUPABASE_URL", "not a url"],
    [{ url: "ftp://example.test", anonKey: ANON_KEY }, "invalid", "NEXT_PUBLIC_SUPABASE_URL", "ftp://example.test"],
    [{ url: LOCAL_URL }, "missing", "NEXT_PUBLIC_SUPABASE_ANON_KEY", null],
  ] as const)("returns a config error for %j", (supabase, reason, variable, received) => {
    expect(createBookingRuntime("supabase", { ...options, supabase })).toEqual({
      status: "config_error",
      reason,
      variable,
      received,
    })
  })

  it.each([
    ["a secret key", "sb_secret_example"],
    ["a privileged JWT", jwtWithRole("service" + "_role")],
    ["an authenticated-user JWT", jwtWithRole("authenticated")],
  ])("refuses %s as the browser key and never echoes it", (_label, anonKey) => {
    expect(createBookingRuntime("supabase", { ...options, supabase: { url: LOCAL_URL, anonKey } })).toEqual({
      status: "config_error",
      reason: "invalid",
      variable: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      received: null,
    })
  })
})

describe("createBookingAdapters — admin side (Phase 4.1)", () => {
  it("has no admin adapter unless the runtime is ready", () => {
    expect(createBookingAdapters(undefined, options).admin).toBeNull()
    expect(createBookingAdapters("supabase", { ...options, supabase: {} }).admin).toBeNull()
  })

  it("pairs the mock admin with the mock runtime", () => {
    const { runtime, admin } = createBookingAdapters("mock", options)
    expect(runtime.status === "ready" && runtime.isDemo).toBe(true)
    expect(admin).toBeInstanceOf(MockAdminRepository)
  })

  it("pairs the Supabase admin with the Supabase runtime", () => {
    const { runtime, admin } = createBookingAdapters("supabase", { ...options, supabase: { url: LOCAL_URL, anonKey: ANON_KEY } })
    expect(runtime.status === "ready" && runtime.isDemo).toBe(false)
    expect(admin).toBeInstanceOf(SupabaseAdminRepository)
  })
})

/** Cloudflare's official, public test keys (developers.cloudflare.com/turnstile/troubleshooting/testing/). */
const TEST_SITE_KEY = "1x00000000000000000000AA"
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"

describe("resolveCaptchaConfig — NEXT_PUBLIC_TURNSTILE_SITE_KEY (ADR-024)", () => {
  it.each([undefined, null, "", "   "])("treats %j as captcha off", (raw) => {
    expect(resolveCaptchaConfig(raw)).toEqual({ ok: true, captcha: null })
  })

  it.each([TEST_SITE_KEY, "2x00000000000000000000AB", "3x00000000000000000000FF", "0x4AAAAAAAB_c-1234567890"])(
    "accepts the site key %j",
    (siteKey) => {
      expect(resolveCaptchaConfig(` ${siteKey} `)).toEqual({ ok: true, captcha: { provider: "turnstile", siteKey } })
    },
  )

  it.each([
    ["a Turnstile secret key", TEST_SECRET_KEY],
    ["a Supabase secret key", "sb_" + "secret_example"],
    ["a JWT", jwtWithRole("anon")],
    ["a URL", "https://challenges.cloudflare.com"],
    ["a too short key", "0x4AAA"],
    ["a key with spaces", "0x4AAAAAAA AAAAAAAAAAAAA"],
  ])("refuses %s and never echoes it", (_label, raw) => {
    expect(resolveCaptchaConfig(raw)).toEqual({
      ok: false,
      reason: "invalid",
      variable: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      received: null,
    })
  })
})

describe("createBookingAdapters — captcha (ADR-024)", () => {
  const supabase = { url: LOCAL_URL, anonKey: ANON_KEY }

  it("is off without a site key", () => {
    const { runtime, captcha } = createBookingAdapters("supabase", { ...options, supabase })
    expect(runtime.status).toBe("ready")
    expect(captcha).toBeNull()
  })

  it("turns on for the Supabase source with a site key", () => {
    const { runtime, captcha } = createBookingAdapters("supabase", { ...options, supabase: { ...supabase, turnstileSiteKey: TEST_SITE_KEY } })
    expect(runtime.status).toBe("ready")
    expect(captcha).toEqual({ provider: "turnstile", siteKey: TEST_SITE_KEY })
  })

  it("is never on for the mock source, even with a site key (or an invalid one)", () => {
    expect(createBookingAdapters("mock", { ...options, supabase: { turnstileSiteKey: TEST_SITE_KEY } }).captcha).toBeNull()
    const invalid = createBookingAdapters("mock", { ...options, supabase: { turnstileSiteKey: TEST_SECRET_KEY } })
    expect(invalid.runtime.status).toBe("ready")
    expect(invalid.captcha).toBeNull()
  })

  it("makes an invalid site key a config error for the Supabase source, without echoing it", () => {
    const { runtime, admin, captcha } = createBookingAdapters("supabase", {
      ...options,
      supabase: { ...supabase, turnstileSiteKey: TEST_SECRET_KEY },
    })
    expect(runtime).toEqual({ status: "config_error", reason: "invalid", variable: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", received: null })
    expect(admin).toBeNull()
    expect(captcha).toBeNull()
  })
})
