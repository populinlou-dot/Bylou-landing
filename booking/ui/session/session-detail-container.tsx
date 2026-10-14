"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { getSessionDetail, isValidSessionId } from "../../application"
import { useAuthKey, useReadyRuntime } from "../booking-context"
import { DataRefreshContext } from "../reserve/refresh-context"
import { SessionDetailView, type SessionDetailLoadState } from "./session-detail-view"

/** Loads one session by id. Invalid/unknown ids resolve to the not-found state (ST-02). */
export function SessionDetailContainer({ id, reopenSheet = false }: { id: string | null; reopenSheet?: boolean }) {
  const { repository, clock } = useReadyRuntime()
  const authKey = useAuthKey()
  const [attempt, setAttempt] = useState(0)
  const silent = useRef(false)
  const [load, setLoad] = useState<SessionDetailLoadState>(() =>
    isValidSessionId(id) ? { status: "loading" } : { status: "not_found" },
  )
  const refresh = useCallback(() => {
    silent.current = true
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!isValidSessionId(id)) {
      setLoad({ status: "not_found" })
      return
    }
    // myBookingId and private details depend on who is signed in: wait for auth to resolve.
    if (authKey === null) return
    let active = true
    if (!silent.current) setLoad({ status: "loading" })
    silent.current = false
    getSessionDetail({ repository, clock }, { id }).then(
      (detail) => {
        if (active) setLoad(detail ? { status: "ready", detail } : { status: "not_found" })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[booking] session load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [repository, clock, id, attempt, authKey])

  return (
    <DataRefreshContext.Provider value={refresh}>
      <SessionDetailView load={load} onRetry={() => setAttempt((n) => n + 1)} reopenSheet={reopenSheet} />
    </DataRefreshContext.Provider>
  )
}

/**
 * Route adapter: reads `?id=` (and `reservar=1` after sign-in) on the client. Must render
 * inside <Suspense> or the static export build fails (ARCHITECTURE §6).
 */
export function SessionDetailFromSearchParams() {
  const params = useSearchParams()
  const id = params.get("id")
  return <SessionDetailContainer key={id ?? ""} id={id} reopenSheet={params.get("reservar") === "1"} />
}
