import type { Metadata } from "next"
import { Suspense } from "react"
import { AdminSessionFromSearchParams, AdminSessionSkeleton } from "@/booking/admin"
import { routeCopy } from "../../_booking/route-copy"

export const metadata: Metadata = {
  title: routeCopy("meta.admin.session"),
}

/** A3 roster + attendance (`/admin/clase/?id=…`). Suspense: the id is read on the client. */
export default function AdminSessionPage() {
  return (
    <Suspense fallback={<AdminSessionSkeleton />}>
      <AdminSessionFromSearchParams />
    </Suspense>
  )
}
