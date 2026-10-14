"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  NO_AGENDA_FILTERS,
  getAgendaEntry,
  getAgendaWeek,
  reconcileAgendaFilters,
  replaceAgendaEntry,
  type AgendaFilters,
  type ClassTypeView,
} from "../../application"
import type { Modality } from "../../domain"
import { useAuthKey, useBooking, useReadyRuntime } from "../booking-context"
import { DataRefreshContext } from "../reserve/refresh-context"
import { AgendaView, type AgendaLoadState } from "./agenda-view"
import { loadAgendaFilters, saveAgendaFilters } from "./filter-storage"

/** Container for /reservas/: owns week offset, practice + modality filters and loading/error state. */
export function AgendaContainer() {
  const { repository, clock } = useReadyRuntime()
  const { brand } = useBooking()
  const waitlist = brand.features.waitlist
  const [weekOffset, setWeekOffset] = useState(0)
  // Null until the remembered filters are read after mount, so the first render matches the static HTML.
  const [filters, setFilters] = useState<AgendaFilters | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<AgendaLoadState>({ status: "loading" })
  const [classTypes, setClassTypes] = useState<ClassTypeView[]>([])
  // Reload when the signed-in user changes (myBookingId); wait until auth has resolved.
  const authKey = useAuthKey()
  const silent = useRef(false)

  useEffect(() => {
    setFilters(loadAgendaFilters(brand.id))
  }, [brand.id])

  const changeFilters = useCallback(
    (patch: Partial<AgendaFilters>) => {
      const next = { ...(filters ?? NO_AGENDA_FILTERS), ...patch }
      setFilters(next)
      saveAgendaFilters(brand.id, next)
    },
    [brand.id, filters],
  )

  /** After a booking: re-read only that session; a failed re-read falls back to a silent full reload. */
  const refresh = useCallback(
    (sessionId: string) => {
      getAgendaEntry({ repository, clock, waitlist }, sessionId).then(
        (entry) =>
          setLoad((current) =>
            current.status === "ready" ? { status: "ready", week: replaceAgendaEntry(current.week, sessionId, entry) } : current,
          ),
        (error: unknown) => {
          console.error("[booking] session refresh failed", error)
          silent.current = true
          setAttempt((n) => n + 1)
        },
      )
    },
    [repository, clock, waitlist],
  )

  useEffect(() => {
    if (authKey === null || filters === null) return
    let active = true
    // A silent refresh keeps the cards mounted so focus is not lost.
    if (!silent.current) setLoad({ status: "loading" })
    silent.current = false
    getAgendaWeek({ repository, clock, waitlist }, { weekOffset, classTypeId: filters.classTypeId, modality: filters.modality }).then(
      (week) => {
        if (!active) return
        const reconciled = reconcileAgendaFilters(filters, week.classTypes)
        if (reconciled !== filters) {
          // The remembered practice is gone: forget it and load "all" instead.
          setFilters(reconciled)
          saveAgendaFilters(brand.id, reconciled)
          return
        }
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
  }, [repository, clock, waitlist, weekOffset, filters, attempt, authKey, brand.id])

  return (
    <DataRefreshContext.Provider value={refresh}>
      <AgendaView
        load={load}
        classTypes={classTypes}
        selectedClassTypeId={filters?.classTypeId ?? null}
        selectedModality={filters?.modality ?? null}
        isCurrentWeek={weekOffset === 0}
        onSelectClassType={(classTypeId) => changeFilters({ classTypeId })}
        onSelectModality={(modality: Modality | null) => changeFilters({ modality })}
        onPreviousWeek={() => setWeekOffset((w) => w - 1)}
        onNextWeek={() => setWeekOffset((w) => w + 1)}
        onToday={() => setWeekOffset(0)}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    </DataRefreshContext.Provider>
  )
}
