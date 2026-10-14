"use client"

import { useEffect, useState } from "react"
import { getAgendaWeek, type ClassTypeView } from "../../application"
import { useReadyRuntime } from "../booking-context"
import { AgendaView, type AgendaLoadState } from "./agenda-view"

/** Container for /reservas/: owns week offset, practice filter and loading/error state. */
export function AgendaContainer() {
  const { repository, clock } = useReadyRuntime()
  const [weekOffset, setWeekOffset] = useState(0)
  const [classTypeId, setClassTypeId] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<AgendaLoadState>({ status: "loading" })
  const [classTypes, setClassTypes] = useState<ClassTypeView[]>([])

  useEffect(() => {
    let active = true
    setLoad({ status: "loading" })
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
  }, [repository, clock, weekOffset, classTypeId, attempt])

  return (
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
  )
}
