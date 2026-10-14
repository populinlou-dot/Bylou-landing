import type { Metadata } from "next"
import { Suspense } from "react"
import { StudentsFromSearchParams } from "@/booking/admin"

export const metadata: Metadata = {
  title: "Alumnas",
}

/** A4 student search (`/admin/alumnas/?q=`). Suspense: the query is read on the client. */
export default function AdminStudentsPage() {
  return (
    <Suspense fallback={null}>
      <StudentsFromSearchParams />
    </Suspense>
  )
}
