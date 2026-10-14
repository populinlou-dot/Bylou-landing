import type { CSSProperties, ReactNode } from "react"
import { themeToCssVars, type BrandConfig } from "../theme"
import "./booking-theme.css"

/**
 * Applies the brand theme as CSS variables on a `[data-booking-theme]` wrapper (ADR-008).
 * The wrapper acts as the "body" of the booking subtree: canvas, text color, body font.
 */
export function BookingThemeScope({ brand, children }: { brand: BrandConfig; children: ReactNode }) {
  const style = themeToCssVars(brand.theme) as CSSProperties
  return (
    <div data-booking-theme={brand.id} style={style} className="relative flex flex-col">
      {children}
    </div>
  )
}
