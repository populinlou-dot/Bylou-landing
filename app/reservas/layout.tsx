import type { Metadata } from "next"
import type { ReactNode } from "react"
import { resolveBrand } from "@/brands"
import { BookingRoot } from "./booking-root"

const brandResolution = resolveBrand(process.env.NEXT_PUBLIC_BOOKING_BRAND)
const brandName = brandResolution.ok ? brandResolution.brand.name : brandResolution.fallback.name

/** noindex until release (ADR-003, ADR-013): the landing does not link here yet. */
export const metadata: Metadata = {
  title: { default: `Reservas · ${brandName}`, template: `%s · Reservas · ${brandName}` },
  description: "Agenda de clases y reservas.",
  robots: { index: false, follow: false },
}

export default function ReservasLayout({ children }: { children: ReactNode }) {
  return <BookingRoot>{children}</BookingRoot>
}
