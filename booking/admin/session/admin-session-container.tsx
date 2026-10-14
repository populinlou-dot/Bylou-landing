"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  getAdminSessionDetail,
  isValidSessionId,
  markAttendance,
  type AttendanceCode,
  type AttendanceMark,
  type RosterEntry,
} from "../../application"
import { ATTENDANCE_EDITABLE_DAYS, ATTENDANCE_OPENS_MINUTES_BEFORE } from "../../domain"
import { useCopy, useReadyRuntime, type Translate } from "../../ui/booking-context"
import { useAdminRepository } from "../admin-context"
import { AdminSessionView, type AdminSessionLoadState } from "./admin-session-view"
import type { RowAttendanceState } from "./roster-list"

function attendanceErrorMessage(code: AttendanceCode, upcoming: boolean, t: Translate): string {
  switch (code) {
    case "attendance_window_closed":
      return upcoming
        ? t("admin.attendance.notYet", { min: ATTENDANCE_OPENS_MINUTES_BEFORE })
        : t("admin.attendance.closed", { days: ATTENDANCE_EDITABLE_DAYS })
    case "forbidden":
      return t("error.forbidden")
    case "not_found":
      return t("error.notFound")
    case "unauthenticated":
      return t("admin.guard.signIn")
    default:
      return t("admin.attendance.error")
  }
}

/** Roster + attendance of one session for staff (render behind <StaffGuard>). */
export function AdminSessionContainer({ id }: { id: string | null }) {
  const { repository, clock } = useReadyRuntime()
  const admin = useAdminRepository()
  const t = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<AdminSessionLoadState>(() =>
    isValidSessionId(id) ? { status: "loading" } : { status: "not_found" },
  )
  const [rows, setRows] = useState<Record<string, RowAttendanceState>>({})
  const [notice, setNotice] = useState<string | null>(null)
  // Synchronous double-submit guard (state updates are async).
  const inFlight = useRef(new Set<string>())
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    if (!isValidSessionId(id)) {
      setLoad({ status: "not_found" })
      return
    }
    let active = true
    setLoad({ status: "loading" })
    getAdminSessionDetail({ admin, repository, clock }, { id }).then(
      (detail) => {
        if (active) setLoad(detail ? { status: "ready", detail } : { status: "not_found" })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] roster load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, repository, clock, id, attempt])

  const onMark = useCallback(
    async (entry: RosterEntry, mark: AttendanceMark) => {
      if (inFlight.current.has(entry.bookingId)) return
      inFlight.current.add(entry.bookingId)
      setNotice(null)
      setRows((prev) => ({ ...prev, [entry.bookingId]: { pending: mark, error: null } }))
      const result = await markAttendance({ admin }, { bookingId: entry.bookingId, attendance: mark })
      inFlight.current.delete(entry.bookingId)
      if (result.ok) {
        // Apply the server-confirmed value only (never optimistic).
        setLoad((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                detail: {
                  ...prev.detail,
                  roster: prev.detail.roster.map((r) =>
                    r.bookingId === result.bookingId ? { ...r, attendance: result.attendance } : r,
                  ),
                },
              }
            : prev,
        )
        setRows((prev) => ({ ...prev, [entry.bookingId]: { pending: null, error: null } }))
        setNotice(t("admin.attendance.saved"))
        return
      }
      const current = loadRef.current
      const upcoming = current.status === "ready" && current.detail.entry.state === "upcoming"
      setRows((prev) => ({
        ...prev,
        [entry.bookingId]: { pending: null, error: attendanceErrorMessage(result.code, upcoming, t) },
      }))
    },
    [admin, t],
  )

  return (
    <AdminSessionView
      load={load}
      rows={rows}
      notice={notice}
      onRetry={() => setAttempt((n) => n + 1)}
      onMark={(entry, mark) => void onMark(entry, mark)}
    />
  )
}

/** Route adapter: reads `?id=` on the client. Render inside <Suspense> (static export). */
export function AdminSessionFromSearchParams() {
  const id = useSearchParams().get("id")
  return <AdminSessionContainer key={id ?? ""} id={id} />
}
