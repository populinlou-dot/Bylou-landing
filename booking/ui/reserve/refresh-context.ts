"use client"

import { createContext, useContext } from "react"

/** Lets a booking/cancel action ask the page container to reload its data silently. */
export const DataRefreshContext = createContext<() => void>(() => {})

export function useDataRefresh(): () => void {
  return useContext(DataRefreshContext)
}
