import { describe, expect, it } from "vitest"
import { BRANDS, DEFAULT_BRAND_ID, resolveBrand } from "."

describe("brand registry", () => {
  it("registers every brand under its own id", () => {
    for (const [id, brand] of Object.entries(BRANDS)) expect(brand.id).toBe(id)
  })

  it.each([undefined, null, "", "  "])("defaults to bylou for %j", (raw) => {
    expect(DEFAULT_BRAND_ID).toBe("bylou")
    expect(resolveBrand(raw)).toEqual({ ok: true, brand: BRANDS.bylou })
  })

  it("selects demo-studio explicitly", () => {
    expect(resolveBrand("demo-studio")).toEqual({ ok: true, brand: BRANDS["demo-studio"] })
  })

  it.each(["Bylou", "acme", "toString", "__proto__"])("rejects unknown id %j", (raw) => {
    expect(resolveBrand(raw)).toEqual({ ok: false, received: raw, fallback: BRANDS.bylou })
  })
})
