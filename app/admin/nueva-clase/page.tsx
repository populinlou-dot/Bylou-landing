import type { Metadata } from "next"
import { Suspense } from "react"
import { NewSessionFromSearchParams } from "@/booking/admin"

export const metadata: Metadata = {
  title: "Nueva clase",
}

/** A2 create one session or a weekly series (`/admin/nueva-clase/?dia=`). Suspense: the day is read on the client. */
export default function AdminNewSessionPage() {
  return (
    <Suspense fallback={null}>
      <NewSessionFromSearchParams />
    </Suspense>
  )
}
