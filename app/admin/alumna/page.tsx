import type { Metadata } from "next"
import { Suspense } from "react"
import { StudentDetailFromSearchParams, StudentDetailSkeleton } from "@/booking/admin"

export const metadata: Metadata = {
  title: "Alumna",
}

/** A4 one student: balance, packs, bookings, ledger (`/admin/alumna/?id=…`). Suspense: the id is read on the client. */
export default function AdminStudentPage() {
  return (
    <Suspense fallback={<StudentDetailSkeleton />}>
      <StudentDetailFromSearchParams />
    </Suspense>
  )
}
