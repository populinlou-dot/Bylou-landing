"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getAgendaWeek, type ClassTypeView } from "../../application"
import { useAuthKey, useReadyRuntime } from "../booking-context"
import { DataRefreshContext } from "../reserve/refresh-context"
import { AgendaView, type AgendaLoadState } from "./agenda-view"

/** Container for /reservas/: owns week offset, practice filter and loading/error state. */
export function AgendaContainer() {
  const { repository, clock } = useReadyRuntime()
  const [weekOffset, setWeekOffset] = useState(0)
  const [classTypeId, setClassTypeId] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<AgendaLoadState>({ status: "loading" })
  const [classTypes, setClassTypes] = useState<ClassTypeView[]>([])
  // Reload when the signed-in user changes (myBookingId); wait until auth has resolved.
  const authKey = useAuthKey()
  const silent = useRef(false)
  const refresh = useCallback(() => {
    silent.current = true
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (authKey === null) return
    let active = true
    // A silent refresh (after a booking) keeps the cards mounted so focus is not lost.
    if (!silent.current) setLoad({ status: "loading" })
    silent.current = false
    getAgendaWeek({ repository, clock }, { weekOffset, classTypeId }).then(
      (week) => {
        if (!active) return
        setClassTypes(week.classTypes)
        setLoad({ status: "ready", week })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[booking] agenda load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [repository, clock, weekOffset, classTypeId, attempt, authKey])

  return (
    <DataRefreshContext.Provider value={refresh}>
      <AgendaView
        load={load}
        classTypes={classTypes}
        selectedClassTypeId={classTypeId}
        isCurrentWeek={weekOffset === 0}
        onSelectClassType={setClassTypeId}
        onPreviousWeek={() => setWeekOffset((w) => w - 1)}
        onNextWeek={() => setWeekOffset((w) => w + 1)}
        onToday={() => setWeekOffset(0)}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    </DataRefreshContext.Provider>
  )
}
