import type { CSSProperties, ReactNode } from "react"
import { themeToCssVars, type BrandConfig } from "../theme"
import "./booking-theme.css"

/**
 * Applies the brand theme as CSS variables on a `[data-booking-theme]` wrapper (ADR-008).
 * The wrapper acts as the "body" of the booking subtree: canvas, text color, body font, and the
 * brand language (`lang`, e.g. es-AR): the root <html lang> belongs to the landing and stays as is.
 * Sheets are portalled inside this wrapper, so they inherit both.
 */
export function BookingThemeScope({ brand, children }: { brand: BrandConfig; children: ReactNode }) {
  const style = themeToCssVars(brand.theme) as CSSProperties
  return (
    <div data-booking-theme={brand.id} lang={brand.locale} style={style} className="relative flex flex-col">
      {children}
    </div>
  )
}
