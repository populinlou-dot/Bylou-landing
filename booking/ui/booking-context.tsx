"use client"

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"
import type { BookingRuntime, Clock, BookingRepository } from "../application"
import type { CopyKey, TermKey } from "../config"
import type { BrandConfig } from "../theme"
import { formatMessage } from "./format"

interface BookingContextValue {
  brand: BrandConfig
  runtime: BookingRuntime
}

const BookingContext = createContext<BookingContextValue | null>(null)

/**
 * Provided by the composition root (app/reservas). booking/ui never imports brands or
 * infrastructure: the brand and the runtime (adapters) arrive here as props.
 */
export function BookingProvider({ brand, runtime, children }: BookingContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ brand, runtime }), [brand, runtime])
  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>
}

export function useBooking(): BookingContextValue {
  const value = useContext(BookingContext)
  if (!value) throw new Error("useBooking must be used inside <BookingProvider>")
  return value
}

/** Adapters for containers rendered behind <BookingRuntimeGate> (status "ready"). */
export function useReadyRuntime(): { repository: BookingRepository; clock: Clock } {
  const { runtime } = useBooking()
  if (runtime.status !== "ready") throw new Error("Booking runtime is not ready; render inside <BookingRuntimeGate>")
  return { repository: runtime.repository, clock: runtime.clock }
}

export type Translate = (key: CopyKey, vars?: Record<string, string | number>) => string

export function useCopy(): Translate {
  const { brand } = useBooking()
  return useCallback((key, vars) => formatMessage(brand.copy[key], vars), [brand])
}

export function useTerm(key: TermKey, plural = false): string {
  const { brand } = useBooking()
  const term = brand.terminology[key]
  return plural ? term.plural : term.singular
}
