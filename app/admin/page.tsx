import { Suspense } from "react"
import { AdminDayFromSearchParams } from "@/booking/admin"

/**
 * A1 "Hoy" (`/admin/?dia=YYYY-MM-DD`). Title and robots come from app/admin/layout.tsx.
 * Suspense: the day is read from the query on the client (static export).
 */
export default function AdminTodayPage() {
  return (
    <Suspense fallback={null}>
      <AdminDayFromSearchParams />
    </Suspense>
  )
}
