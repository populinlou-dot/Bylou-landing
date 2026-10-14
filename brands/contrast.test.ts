import { describe, expect, it } from "vitest"
import type { BookingTheme } from "../booking/theme"
import { BRANDS } from "."

/**
 * WCAG 2.x contrast of every text/background (4.5:1) and non-text (3:1) token pair the booking and
 * admin surfaces actually combine (UX_DESIGN.md §5.1/§5.2), for every registered brand. axe cannot
 * measure text inside an open sheet (the overlay hides the background), so the tokens are checked here.
 */
type Palette = BookingTheme["palette"]
type Token = Exclude<keyof Palette, "decorative">

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const TEXT = 4.5
const NON_TEXT = 3

/** [foreground, background, minimum]. Mirrors the Tailwind classes used in booking/ and the sheets. */
const PAIRS: ReadonlyArray<[Token, Token, number]> = [
  ["text", "canvas", TEXT],
  ["surfaceText", "surface", TEXT],
  ["text", "subtle", TEXT], // alerts and chips (bg-secondary text-foreground)
  ["text", "highlight", TEXT],
  ["text", "muted", TEXT], // inactive cards (bg-muted)
  ["textSecondary", "canvas", TEXT],
  ["textSecondary", "surface", TEXT],
  ["textSecondary", "subtle", TEXT],
  ["textSecondary", "muted", TEXT],
  ["primary", "canvas", TEXT], // links, nav
  ["primary", "surface", TEXT],
  ["primary", "subtle", TEXT], // selected chip / radio label
  ["onPrimary", "primary", TEXT],
  ["onPrimary", "primaryHover", TEXT],
  ["subtleText", "subtle", TEXT],
  ["highlightText", "highlight", TEXT], // demo banner
  ["danger", "surface", TEXT], // field errors, cancel links
  ["danger", "canvas", TEXT],
  ["danger", "subtle", TEXT],
  ["onDanger", "danger", TEXT], // destructive buttons
  ["success", "surface", TEXT],
  ["success", "canvas", TEXT],
  ["onInverse", "inverseSurface", TEXT], // skip link
  ["warning", "highlight", NON_TEXT], // demo banner icon
  ["controlBorder", "surface", NON_TEXT], // input borders
  ["controlBorder", "canvas", NON_TEXT],
  ["focus", "canvas", NON_TEXT], // :focus-visible outline
  ["focus", "surface", NON_TEXT],
  ["focus", "subtle", NON_TEXT],
]

describe("brand token contrast (WCAG AA)", () => {
  for (const brand of Object.values(BRANDS)) {
    it(`${brand.id}: every booking text/background pair ≥ 4.5:1 and non-text ≥ 3:1`, () => {
      const p = brand.theme.palette
      const failures = PAIRS.map(([fg, bg, min]) => ({ pair: `${fg}/${bg}`, ratio: contrastRatio(p[fg], p[bg]), min }))
        .filter(({ ratio, min }) => ratio < min)
        .map(({ pair, ratio, min }) => `${pair} ${ratio.toFixed(2)} < ${min}`)
      expect(failures).toEqual([])
    })
  }

  it("computes the documented Bylou ratios (UX_DESIGN.md §6)", () => {
    expect(contrastRatio("#4A0000", "#FFF8F8")).toBeCloseTo(15.52, 1)
    expect(contrastRatio("#A86B74", "#FFF8F8")).toBeCloseTo(3.99, 1)
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1)
  })
})
