"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { getAdminDay } from "../../application"
import { useReadyRuntime } from "../../ui/booking-context"
import { useAdminRepository } from "../admin-context"
import { AdminDayView, type AdminDayLoadState } from "./admin-day-view"

/** Loads one studio-local day for staff (render behind <StaffGuard>). */
export function AdminDayContainer({ date }: { date: string | null }) {
  const { repository, clock } = useReadyRuntime()
  const admin = useAdminRepository()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<AdminDayLoadState>({ status: "loading" })

  useEffect(() => {
    let active = true
    setLoad({ status: "loading" })
    getAdminDay({ admin, repository, clock }, { date }).then(
      (day) => {
        if (active) setLoad({ status: "ready", day })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] day load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, repository, clock, date, attempt])

  return <AdminDayView load={load} onRetry={() => setAttempt((n) => n + 1)} />
}

/** Route adapter: reads `?dia=YYYY-MM-DD` on the client. Render inside <Suspense> (static export). */
export function AdminDayFromSearchParams() {
  const date = useSearchParams().get("dia")
  return <AdminDayContainer key={date ?? ""} date={date} />
}
