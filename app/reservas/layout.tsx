import type { Metadata } from "next"
import type { ReactNode } from "react"
import { routeBrand, routeCopy } from "../_booking/route-copy"
import { BookingRoot } from "./booking-root"

const section = routeCopy("meta.booking.title")

/** noindex until release (ADR-003, ADR-013): the landing does not link here yet. */
export const metadata: Metadata = {
  title: { default: `${section} · ${routeBrand.name}`, template: `%s · ${section} · ${routeBrand.name}` },
  description: routeCopy("meta.booking.description"),
  robots: { index: false, follow: false },
}

export default function ReservasLayout({ children }: { children: ReactNode }) {
  return <BookingRoot>{children}</BookingRoot>
}
