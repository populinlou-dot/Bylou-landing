/**
 * Brand registry. Only composition roots (app/reservas/**, tests) import it;
 * booking/ui receives the selected BrandConfig through props/context.
 */
import type { BrandConfig } from "../booking/theme"
import { bylouBrand } from "./bylou"
import { demoStudioBrand } from "./demo-studio"

export const BRANDS = {
  bylou: bylouBrand,
  "demo-studio": demoStudioBrand,
} as const satisfies Record<string, BrandConfig>

export type BrandId = keyof typeof BRANDS

export const DEFAULT_BRAND_ID: BrandId = "bylou"

export type BrandResolution =
  | { ok: true; brand: BrandConfig }
  /** Unknown id: callers render a config error, using `fallback` only for its copy and theme. */
  | { ok: false; received: string; fallback: BrandConfig }

/** `NEXT_PUBLIC_BOOKING_BRAND`: missing/empty → default brand; unknown → error. */
export function resolveBrand(raw: string | null | undefined): BrandResolution {
  const value = raw?.trim() ?? ""
  if (value === "") return { ok: true, brand: BRANDS[DEFAULT_BRAND_ID] }
  if (Object.hasOwn(BRANDS, value)) return { ok: true, brand: BRANDS[value as BrandId] }
  return { ok: false, received: value, fallback: BRANDS[DEFAULT_BRAND_ID] }
}
