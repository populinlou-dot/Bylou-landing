"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { getSessionDetail, isValidSessionId } from "../../application"
import { useReadyRuntime } from "../booking-context"
import { SessionDetailView, type SessionDetailLoadState } from "./session-detail-view"

/** Loads one session by id. Invalid/unknown ids resolve to the not-found state (ST-02). */
export function SessionDetailContainer({ id }: { id: string | null }) {
  const { repository, clock } = useReadyRuntime()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<SessionDetailLoadState>(() =>
    isValidSessionId(id) ? { status: "loading" } : { status: "not_found" },
  )

  useEffect(() => {
    if (!isValidSessionId(id)) {
      setLoad({ status: "not_found" })
      return
    }
    let active = true
    setLoad({ status: "loading" })
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
  }, [repository, clock, id, attempt])

  return <SessionDetailView load={load} onRetry={() => setAttempt((n) => n + 1)} />
}

/**
 * Route adapter: reads `?id=` on the client. Must render inside <Suspense> or the static
 * export build fails (ARCHITECTURE §6).
 */
export function SessionDetailFromSearchParams() {
  const id = useSearchParams().get("id")
  return <SessionDetailContainer key={id ?? ""} id={id} />
}
