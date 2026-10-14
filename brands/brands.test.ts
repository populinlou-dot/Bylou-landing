import { describe, expect, it } from "vitest"
import { REASON_COPY_KEYS, validateBrandConfig } from "../booking/config"
import {
  DOMAIN_REASON_CODES,
  evaluateBooking,
  evaluateCancellation,
  type Booking,
  type CreditGrant,
  type Session,
  type StudioRules,
} from "../booking/domain"
import { RULES, atOffset, makeBooking, makeGrant, makeSession } from "../booking/domain/test-fixtures"
import { HOUR_MS, MINUTE_MS } from "../booking/domain/time"
import { themeToCssVars } from "../booking/theme"
import { bylouBrand } from "./bylou"
import { demoStudioBrand } from "./demo-studio"

const brands = [bylouBrand, demoStudioBrand]

interface Scenario {
  name: string
  session: Session
  bookings: Booking[]
  grants: CreditGrant[]
  now: Date
}

const scenarios: Scenario[] = [
  { name: "bookable", session: makeSession(), bookings: [], grants: [makeGrant()], now: atOffset(-48 * HOUR_MS) },
  { name: "last spot", session: makeSession(), bookings: [makeBooking()], grants: [makeGrant()], now: atOffset(-HOUR_MS) },
  {
    name: "full",
    session: makeSession({ capacity: 1 }),
    bookings: [makeBooking()],
    grants: [makeGrant()],
    now: atOffset(-HOUR_MS),
  },
  {
    name: "already booked",
    session: makeSession(),
    bookings: [makeBooking({ userId: "u1" })],
    grants: [makeGrant()],
    now: atOffset(-HOUR_MS),
  },
  { name: "no credit", session: makeSession(), bookings: [], grants: [], now: atOffset(-HOUR_MS) },
  { name: "not open", session: makeSession(), bookings: [], grants: [makeGrant()], now: atOffset(-40 * 24 * HOUR_MS) },
  { name: "started", session: makeSession(), bookings: [], grants: [makeGrant()], now: atOffset(MINUTE_MS) },
  {
    name: "cancelled session",
    session: makeSession({ status: "cancelled" }),
    bookings: [],
    grants: [makeGrant()],
    now: atOffset(-HOUR_MS),
  },
]

const cancellationTimes = [-48 * HOUR_MS, -24 * HOUR_MS, -24 * HOUR_MS + 1, -HOUR_MS, 0]

function runJourney(rules: StudioRules) {
  const bookings = scenarios.map((s) =>
    evaluateBooking({ session: s.session, userId: "u1", sessionBookings: s.bookings, grants: s.grants, rules, now: s.now }),
  )
  const own = makeBooking({ userId: "u1" })
  const cancellations = cancellationTimes.map((ms) => evaluateCancellation(own, makeSession(), rules, atOffset(ms)))
  return { bookings, cancellations }
}

describe("Journey G — white-label decoupling", () => {
  it("both brands use rules-equal configs", () => {
    expect(demoStudioBrand.rules).toEqual(bylouBrand.rules)
  })

  it("same inputs under bylou and demo-studio yield identical domain results", () => {
    const bylou = runJourney(bylouBrand.rules)
    const demo = runJourney(demoStudioBrand.rules)
    expect(demo).toEqual(bylou)
    // Sanity: the journey exercises distinct outcomes, not a trivial all-ok run.
    expect(bylou.bookings.map((r) => (r.ok ? "ok" : r.code))).toEqual([
      "ok",
      "ok",
      "session_full",
      "already_booked",
      "no_valid_credit",
      "booking_not_open",
      "session_started",
      "session_cancelled",
    ])
    expect(bylou.cancellations.map((r) => r.outcome)).toEqual(["refund", "refund", "late", "late", "denied"])
  })

  it("rules, not brand, drive outcomes: changing a rule changes the result", () => {
    const stricter = { ...RULES, cancellationWindowHours: 48 }
    expect(runJourney(stricter).cancellations[1]).toEqual({ outcome: "late", code: "cancellation_too_late" })
  })

  it("brands differ in theme, terminology and copy", () => {
    expect(demoStudioBrand.theme.palette.primary).not.toBe(bylouBrand.theme.palette.primary)
    expect(demoStudioBrand.terminology.session.singular).not.toBe(bylouBrand.terminology.session.singular)
    expect(demoStudioBrand.copy["agenda.title"]).not.toBe(bylouBrand.copy["agenda.title"])
  })
})

describe.each(brands)("brand $id", (brand) => {
  it("passes validation", () => {
    expect(validateBrandConfig(brand)).toEqual([])
  })

  it("has copy for every domain reason code", () => {
    expect(REASON_COPY_KEYS).toHaveLength(DOMAIN_REASON_CODES.length)
    for (const code of DOMAIN_REASON_CODES) {
      expect(brand.copy[`reason.${code}`]?.trim()).toBeTruthy()
    }
  })

  it("uses the fixed primary CTA verb", () => {
    expect(brand.copy["session.cta"]).toBe("Reservar")
  })

  it("maps to the shadcn variables the booking wrapper needs", () => {
    const vars = themeToCssVars(brand.theme)
    for (const name of ["--background", "--foreground", "--primary", "--primary-foreground", "--muted", "--border", "--input", "--ring", "--radius"]) {
      expect(vars[name], name).toBeTruthy()
    }
  })
})

describe("bylou brand fidelity", () => {
  it("uses the real landing tokens, not the v0 globals.css defaults", () => {
    const vars = themeToCssVars(bylouBrand.theme)
    expect(vars["--primary"]).toBe("#A41D2D")
    expect(vars["--foreground"]).toBe("#4A0000")
    expect(vars["--muted-foreground"]).toBe("#6B0505")
    expect(vars["--radius"]).toBe("0.6875rem")
    expect(vars["--accent-expressive"]).toBe("#D75B86")
  })

  it("omits the decorative accent for a brand without one", () => {
    expect(themeToCssVars(demoStudioBrand.theme)).not.toHaveProperty("--accent-expressive")
  })

  it("avoids clinical/accounting terms in Bylou copy", () => {
    const text = Object.values(bylouBrand.copy).join(" ").toLowerCase()
    expect(text).not.toMatch(/\bturnos?\b/)
    expect(text).not.toMatch(/\bcréditos?\b/)
  })
})
