"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
  RepositoryError,
  needsDisplayName,
  reserveSession,
  saveDisplayName,
  sessionHref,
  signInHref,
  type AgendaEntry,
} from "../../application"
import type { StudioRules } from "../../domain"
import { useReadyRuntime } from "../booking-context"
import { newIdempotencyKey } from "../idempotency"
import type { ProfileNameError } from "../sign-in/profile-name-view"
import { ConfirmSheetView, type BalanceState, type ConfirmPhase } from "./confirm-sheet-view"

/**
 * Confirm sheet container. Mounted once per opening, so the idempotency key is generated once
 * per sheet and reused on every retry (DATA_MODEL §5): a double tap or a retry after a timeout
 * replays the same booking. The disabled button is UX only; the key is what guarantees it.
 * A student without a display name (required, owner decision 2026-10-14) gets the name form inside the
 * sheet first; the server refuses with `profile_incomplete` anyway, which brings the form back.
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
  const [needsName, setNeedsName] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<ProfileNameError | null>(null)
  const [savingName, setSavingName] = useState(false)
  const inFlight = useRef(false)
  const returnTo = sessionHref(entry.session.id, true)

  useEffect(() => {
    let active = true
    Promise.all([repository.getStudioRules(), repository.getMyCreditBalance(), needsDisplayName({ repository })]).then(
      ([loadedRules, loadedBalance, missingName]) => {
        if (!active) return
        setRules(loadedRules)
        setBalance({ status: "ready", available: loadedBalance.available })
        setNeedsName(missingName)
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
    if (result.code === "profile_incomplete") {
      setNeedsName(true)
      setPhase({ status: "idle" })
      return
    }
    if (result.code === "unknown") console.error("[booking] book_session returned an unmapped result")
    setPhase({ status: "failed", code: result.code })
  }

  async function saveName() {
    setSavingName(true)
    setNameError(null)
    const result = await saveDisplayName({ repository }, name)
    setSavingName(false)
    if (result.ok) {
      setNeedsName(false)
      return
    }
    if (result.code === "empty" || result.code === "too_long" || result.code === "invalid_chars") {
      setNameError(result.code)
      return
    }
    if (result.code === "unauthenticated") {
      router.push(signInHref(returnTo))
      return
    }
    console.error("[booking] display name save failed", result.code)
    setNameError("save")
  }

  return (
    <ConfirmSheetView
      entry={entry}
      timezone={timezone}
      balance={balance}
      policyHours={rules?.cancellationWindowHours ?? null}
      creditsPerBooking={rules?.creditsPerBooking ?? 1}
      phase={phase}
      nameStep={
        needsName
          ? {
              name,
              pending: savingName,
              error: nameError,
              onNameChange: (value) => {
                setName(value)
                if (nameError) setNameError(null)
              },
              onSubmit: () => void saveName(),
            }
          : null
      }
      onConfirm={confirm}
      onClose={onClose}
    />
  )
}
