"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { RepositoryError, reserveSession, sessionHref, signInHref, type AgendaEntry } from "../../application"
import type { StudioRules } from "../../domain"
import { useReadyRuntime } from "../booking-context"
import { newIdempotencyKey } from "../idempotency"
import { ConfirmSheetView, type BalanceState, type ConfirmPhase } from "./confirm-sheet-view"

/**
 * Confirm sheet container. Mounted once per opening, so the idempotency key is generated once
 * per sheet and reused on every retry (DATA_MODEL §5): a double tap or a retry after a timeout
 * replays the same booking. The disabled button is UX only; the key is what guarantees it.
 */
export function ConfirmSheet({
  entry,
  timezone,
  onClose,
  onBooked,
}: {
  entry: AgendaEntry
  timezone: string
  onClose: () => void
  onBooked: () => void
}) {
  const { repository } = useReadyRuntime()
  const router = useRouter()
  const [idempotencyKey] = useState(newIdempotencyKey)
  const [rules, setRules] = useState<StudioRules | null>(null)
  const [balance, setBalance] = useState<BalanceState>({ status: "loading" })
  const [phase, setPhase] = useState<ConfirmPhase>({ status: "idle" })
  const inFlight = useRef(false)
  const returnTo = sessionHref(entry.session.id, true)

  useEffect(() => {
    let active = true
    Promise.all([repository.getStudioRules(), repository.getMyCreditBalance()]).then(
      ([loadedRules, loadedBalance]) => {
        if (!active) return
        setRules(loadedRules)
        setBalance({ status: "ready", available: loadedBalance.available })
      },
      (error: unknown) => {
        if (!active) return
        if (error instanceof RepositoryError && error.code === "unauthenticated") {
          router.push(signInHref(returnTo))
          return
        }
        // Preview only: the RPC still decides, so the sheet stays usable.
        console.error("[booking] balance load failed", error)
        setBalance({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [repository, router, returnTo])

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true
    setPhase({ status: "pending" })
    const result = await reserveSession({ repository }, { sessionId: entry.session.id, idempotencyKey })
    inFlight.current = false
    if (result.ok) {
      setPhase({ status: "success" })
      onBooked()
      return
    }
    if (result.code === "unauthenticated") {
      router.push(signInHref(returnTo))
      return
    }
    if (result.code === "unknown") console.error("[booking] book_session returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  return (
    <ConfirmSheetView
      entry={entry}
      timezone={timezone}
      balance={balance}
      policyHours={rules?.cancellationWindowHours ?? null}
      creditsPerBooking={rules?.creditsPerBooking ?? 1}
      phase={phase}
      onConfirm={confirm}
      onClose={onClose}
    />
  )
}
