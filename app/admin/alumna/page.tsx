import type { Metadata } from "next"
import { Suspense } from "react"
import { StudentDetailFromSearchParams, StudentDetailSkeleton } from "@/booking/admin"
import { routeCopy } from "../../_booking/route-copy"

export const metadata: Metadata = {
  title: routeCopy("meta.admin.student"),
}

/** A4 one student: balance, packs, bookings, ledger (`/admin/alumna/?id=…`). Suspense: the id is read on the client. */
export default function AdminStudentPage() {
  return (
    <Suspense fallback={<StudentDetailSkeleton />}>
      <StudentDetailFromSearchParams />
    </Suspense>
  )
}
