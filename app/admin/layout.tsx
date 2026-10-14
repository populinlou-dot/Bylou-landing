import type { Metadata } from "next"
import type { ReactNode } from "react"
import { routeBrand, routeCopy } from "../_booking/route-copy"
import { AdminRoot } from "./admin-root"

const section = routeCopy("admin.label")

/** Staff panel (ADR-003): public static shell, never indexed, not linked from the student UI. */
export const metadata: Metadata = {
  title: { default: `${section} · ${routeBrand.name}`, template: `%s · ${section} · ${routeBrand.name}` },
  description: routeCopy("meta.admin.description"),
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminRoot>{children}</AdminRoot>
}
