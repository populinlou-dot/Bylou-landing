import type { Metadata } from "next"
import type { ReactNode } from "react"
import { resolveBrand } from "@/brands"
import { AdminRoot } from "./admin-root"

const brandResolution = resolveBrand(process.env.NEXT_PUBLIC_BOOKING_BRAND)
const brandName = brandResolution.ok ? brandResolution.brand.name : brandResolution.fallback.name

/** Staff panel (ADR-003): public static shell, never indexed, not linked from the student UI. */
export const metadata: Metadata = {
  title: { default: `Panel · ${brandName}`, template: `%s · Panel · ${brandName}` },
  description: "Panel del estudio.",
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminRoot>{children}</AdminRoot>
}
