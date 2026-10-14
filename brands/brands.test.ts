import { describe, expect, it } from "vitest"
import { COPY_KEYS, REASON_COPY_KEYS, TERM_KEYS, validateBrandConfig } from "../booking/config"
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
import { BRANDS } from "."

// Every registered brand, so a brand added to the registry is checked without editing this file.
const brands = Object.values(BRANDS)

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
  it("swapping theme/copy/terminology onto the same rules keeps the config valid", () => {
    const reskinned = { ...demoStudioBrand, rules: bylouBrand.rules }
    expect(validateBrandConfig(reskinned)).toEqual([])
  })

  it("same rules under bylou and demo-studio presentation yield identical domain results", () => {
    // Domain outcomes are a function of rules only; the brand's look and language must not matter.
    const bylou = runJourney(bylouBrand.rules)
    const reskinned = runJourney({ ...demoStudioBrand, rules: bylouBrand.rules }.rules)
    expect(reskinned).toEqual(bylou)
  })

  it("the shared journey exercises distinct outcomes, not a trivial all-ok run", () => {
    const fixture = runJourney(RULES)
    expect(fixture.bookings.map((r) => (r.ok ? "ok" : r.code))).toEqual([
      "ok",
      "ok",
      "session_full",
      "already_booked",
      "no_valid_credit",
      "booking_not_open",
      "session_started",
      "session_cancelled",
    ])
    expect(fixture.cancellations.map((r) => r.outcome)).toEqual(["refund", "refund", "late", "late", "denied"])
  })

  it("bylou blocks late cancellation (owner decision: 24 h, then contact the studio)", () => {
    const outcomes = runJourney(bylouBrand.rules).cancellations
    expect(outcomes[1]).toEqual({ outcome: "refund" })
    expect(outcomes[2]).toEqual({ outcome: "denied", code: "cancellation_too_late" })
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

  it("has a non-empty message for every copy key, and no extra keys", () => {
    const missing = COPY_KEYS.filter((key) => !(typeof brand.copy[key] === "string" && brand.copy[key].trim() !== ""))
    expect(missing).toEqual([])
    expect(Object.keys(brand.copy).sort()).toEqual([...COPY_KEYS].sort())
  })

  it("has singular and plural for every term", () => {
    for (const key of TERM_KEYS) {
      expect(brand.terminology[key].singular.trim(), key).toBeTruthy()
      expect(brand.terminology[key].plural.trim(), key).toBeTruthy()
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

describe("demo-studio voice (PL-01)", () => {
  it("covers both registered brands", () => {
    expect(Object.keys(BRANDS).sort()).toEqual(["bylou", "demo-studio"])
  })

  it("never leaks Bylou names or vocabulary into demo-studio copy or terminology", () => {
    const text = [...Object.values(demoStudioBrand.copy), JSON.stringify(demoStudioBrand.terminology)].join(" ")
    expect(text).not.toMatch(/\bby ?lou\b|\blou\b|\balumnas?\b|\bprácticas?\b|\bpacks?\b|\bprofes?\b/i)
  })

  it("speaks a neutral tú register, not Rioplatense voseo", () => {
    // Unicode-aware word edges: \b treats "á" as a non-word character.
    const voseo = /(?<!\p{L})(entrá|elegí|podés|tenés|escribile|probá|revisá|buscá|dejalo|registrá)(?!\p{L})/iu
    expect(Object.values(bylouBrand.copy).join(" ")).toMatch(voseo) // the check can fail
    expect(Object.values(demoStudioBrand.copy).join(" ")).not.toMatch(voseo)
  })

  it("translates every message that names the studio's vocabulary differently from Bylou", () => {
    const same = COPY_KEYS.filter(
      (key) => demoStudioBrand.copy[key] === bylouBrand.copy[key] && /clase|pack|práctica|alumna/i.test(bylouBrand.copy[key]),
    )
    expect(same).toEqual([])
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
