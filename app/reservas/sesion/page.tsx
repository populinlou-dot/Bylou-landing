import type { Metadata } from "next"
import { Suspense } from "react"
import { SessionDetailFromSearchParams, SessionDetailSkeleton } from "@/booking/ui"

export const metadata: Metadata = {
  title: "Detalle",
}

/** `/reservas/sesion/?id=…` — the id is read on the client, so the page needs Suspense for static export. */
export default function SessionPage() {
  return (
    <Suspense fallback={<SessionDetailSkeleton />}>
      <SessionDetailFromSearchParams />
    </Suspense>
  )
}
