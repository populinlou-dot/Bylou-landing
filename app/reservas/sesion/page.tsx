import type { Metadata } from "next"
import { Suspense } from "react"
import { SessionDetailFromSearchParams, SessionDetailSkeleton } from "@/booking/ui"
import { routeCopy } from "../../_booking/route-copy"

export const metadata: Metadata = {
  title: routeCopy("meta.session"),
}

/** `/reservas/sesion/?id=…` — the id is read on the client, so the page needs Suspense for static export. */
export default function SessionPage() {
  return (
    <Suspense fallback={<SessionDetailSkeleton />}>
      <SessionDetailFromSearchParams />
    </Suspense>
  )
}
