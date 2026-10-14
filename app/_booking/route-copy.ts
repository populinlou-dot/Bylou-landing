import type { CopyKey } from "@/booking/config"
import type { BrandConfig } from "@/booking/theme"
import { resolveBrand } from "@/brands"

/**
 * Brand copy for build-time route metadata (document titles and descriptions), so tab titles
 * speak the selected brand's voice too (PL-01). Server-only: imported from layout/page
 * `metadata` exports. An unknown brand id falls back to the default brand's copy here; the
 * pages themselves render the config-error state (ADR-013).
 */
const resolution = resolveBrand(process.env.NEXT_PUBLIC_BOOKING_BRAND)

export const routeBrand: BrandConfig = resolution.ok ? resolution.brand : resolution.fallback

export function routeCopy(key: CopyKey): string {
  return routeBrand.copy[key]
}
