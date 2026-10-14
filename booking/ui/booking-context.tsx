"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { AuthPort, AuthUser, BookingRepository, BookingRuntime, Clock } from "../application"
import type { CopyKey, TermKey } from "../config"
import type { BrandConfig } from "../theme"
import { formatMessage } from "./format"

/** Signed-in state for UX only: RLS/RPC re-check identity on every call (ADR-005). */
export type AuthState = { status: "loading" } | { status: "signed_out" } | { status: "signed_in"; user: AuthUser }

interface BookingContextValue {
  brand: BrandConfig
  runtime: BookingRuntime
}

const BookingContext = createContext<BookingContextValue | null>(null)
const AuthStateContext = createContext<AuthState>({ status: "loading" })

/**
 * Provided by the composition root (app/reservas). booking/ui never imports brands or
 * infrastructure: the brand and the runtime (adapters) arrive here as props.
 */
export function BookingProvider({ brand, runtime, children }: BookingContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ brand, runtime }), [brand, runtime])
  const [auth, setAuth] = useState<AuthState>({ status: "loading" })

  useEffect(() => {
    if (runtime.status !== "ready") return
    return runtime.auth.onChange((user) => setAuth(user ? { status: "signed_in", user } : { status: "signed_out" }))
  }, [runtime])

  return (
    <BookingContext.Provider value={value}>
      <AuthStateContext.Provider value={auth}>{children}</AuthStateContext.Provider>
    </BookingContext.Provider>
  )
}

export function useAuthState(): AuthState {
  return useContext(AuthStateContext)
}

/** Stable key that changes when the signed-in user changes; null while auth is still resolving. */
export function useAuthKey(): string | null {
  const auth = useAuthState()
  if (auth.status === "loading") return null
  return auth.status === "signed_in" ? `user:${auth.user.id}` : "anonymous"
}

export function useBooking(): BookingContextValue {
  const value = useContext(BookingContext)
  if (!value) throw new Error("useBooking must be used inside <BookingProvider>")
  return value
}

/** Adapters for containers rendered behind <BookingRuntimeGate> (status "ready"). */
export function useReadyRuntime(): { repository: BookingRepository; clock: Clock; auth: AuthPort } {
  const { runtime } = useBooking()
  if (runtime.status !== "ready") throw new Error("Booking runtime is not ready; render inside <BookingRuntimeGate>")
  return { repository: runtime.repository, clock: runtime.clock, auth: runtime.auth }
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
