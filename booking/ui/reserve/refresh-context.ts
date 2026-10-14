"use client"

import { createContext, useContext } from "react"

/**
 * Lets a booking/cancel action ask the page container to re-read the affected session from the
 * repository (silently, keeping the cards mounted). Containers may reload more than that one.
 */
export type RefreshSession = (sessionId: string) => void

export const DataRefreshContext = createContext<RefreshSession>(() => {})

export function useDataRefresh(): RefreshSession {
  return useContext(DataRefreshContext)
}
