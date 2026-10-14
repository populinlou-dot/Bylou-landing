import { describe, expect, it } from "vitest"
import { bylouBrand } from "../../brands/bylou"
import type { BrandConfig } from "../theme"
import { validateBrandConfig } from "./brand-validation"
import { DEFAULT_STUDIO_RULES, validateStudioRules } from "./rules"

const paths = (errors: { path: string }[]) => errors.map((e) => e.path)

describe("validateStudioRules", () => {
  it("accepts the ADR-011 defaults", () => {
    expect(validateStudioRules(DEFAULT_STUDIO_RULES)).toEqual([])
  })

  it("rejects non-objects", () => {
    expect(paths(validateStudioRules(null))).toEqual(["rules"])
  })

  it("reports every invalid field", () => {
    const errors = validateStudioRules({
      timezone: "Mars/Olympus",
      bookingWindow: { opensDaysBefore: 0, closesMinutesBefore: -1 },
      cancellationWindowHours: 1.5,
      lateCancelPolicy: "refund_anyway",
      creditsPerBooking: 0,
    })
    expect(paths(errors)).toEqual([
      "rules.timezone",
      "rules.bookingWindow.opensDaysBefore",
      "rules.bookingWindow.closesMinutesBefore",
      "rules.cancellationWindowHours",
      "rules.creditsPerBooking",
      "rules.lateCancelPolicy",
    ])
  })

  it("rejects a window that closes before it opens", () => {
    const errors = validateStudioRules({ ...DEFAULT_STUDIO_RULES, bookingWindow: { opensDaysBefore: 1, closesMinutesBefore: 1440 } })
    expect(paths(errors)).toEqual(["rules.bookingWindow"])
  })
})

describe("validateBrandConfig", () => {
  const broken = (patch: (b: BrandConfig) => void): BrandConfig => {
    const copy = structuredClone(bylouBrand)
    patch(copy)
    return copy
  }

  it("flags a missing reason copy", () => {
    const brand = broken((b) => {
      delete (b.copy as Partial<BrandConfig["copy"]>)["reason.session_full"]
    })
    expect(paths(validateBrandConfig(brand))).toEqual(["copy.reason.session_full"])
  })

  it("flags a dropped placeholder and an unknown message id", () => {
    const brand = broken((b) => {
      b.copy["sheet.policy"] = "Podés cancelar hasta un día antes."
      ;(b.copy as Record<string, string>)["typo.key"] = "x"
    })
    expect(validateBrandConfig(brand)).toEqual([
      { path: "copy.sheet.policy", message: "must keep placeholder {h}" },
      { path: "copy.typo.key", message: "unknown message id" },
    ])
  })

  it("flags empty terms, missing contact, bad slug and invalid rules", () => {
    const brand = broken((b) => {
      b.id = "Bad Slug"
      b.contact = { instagramDm: null, email: null }
      b.terminology.session.plural = " "
      b.theme.palette.primary = ""
      b.rules.creditsPerBooking = 0
    })
    expect(paths(validateBrandConfig(brand))).toEqual([
      "id",
      "contact",
      "theme.palette.primary",
      "terminology.session",
      "rules.creditsPerBooking",
    ])
  })
})
