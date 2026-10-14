import type { Metadata } from "next"
import { Suspense } from "react"
import { AdminSessionFromSearchParams, AdminSessionSkeleton } from "@/booking/admin"

export const metadata: Metadata = {
  title: "Clase",
}

/** A3 roster + attendance (`/admin/clase/?id=…`). Suspense: the id is read on the client. */
export default function AdminSessionPage() {
  return (
    <Suspense fallback={<AdminSessionSkeleton />}>
      <AdminSessionFromSearchParams />
    </Suspense>
  )
}
