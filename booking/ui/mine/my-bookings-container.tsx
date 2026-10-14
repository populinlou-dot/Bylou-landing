"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RepositoryError, getMyAccount, type CancelResult, type MyBookingEntry } from "../../application"
import { useAuthState, useCopy, useReadyRuntime } from "../booking-context"
import { CancelSheet } from "./cancel-sheet"
import { MyBookingsView, type MyBookingsLoadState } from "./my-bookings-view"

/** `/reservas/mis-reservas/`: needs a signed-in user; RLS returns only their own rows. */
export function MyBookingsContainer() {
  const { repository, clock } = useReadyRuntime()
  const auth = useAuthState()
  const t = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<MyBookingsLoadState>({ status: "loading" })
  const [cancelling, setCancelling] = useState<MyBookingEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const silent = useRef(false)
  const userId = auth.status === "signed_in" ? auth.user.id : null

  useEffect(() => {
    if (auth.status === "loading") return
    if (auth.status === "signed_out") {
      setLoad({ status: "signed_out" })
      return
    }
    let active = true
    if (!silent.current) setLoad({ status: "loading" })
    silent.current = false
    getMyAccount({ repository, clock }).then(
      (account) => {
        if (active) setLoad({ status: "ready", account })
      },
      (error: unknown) => {
        if (!active) return
        if (error instanceof RepositoryError && error.code === "unauthenticated") {
          setLoad({ status: "signed_out" })
          return
        }
        console.error("[booking] my bookings load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [repository, clock, auth.status, userId, attempt])

  const onCancelled = useCallback(
    (result: Extract<CancelResult, { ok: true }>) => {
      setCancelling(null)
      setNotice(result.refunded ? t("cancel.done") : t("cancel.doneNoRefund"))
      silent.current = true
      setAttempt((n) => n + 1)
    },
    [t],
  )

  return (
    <>
      <MyBookingsView
        load={load}
        notice={notice}
        onRetry={() => setAttempt((n) => n + 1)}
        onCancel={(item) => {
          setNotice(null)
          setCancelling(item)
        }}
      />
      {cancelling && load.status === "ready" ? (
        <CancelSheet
          item={cancelling}
          timezone={load.account.timezone}
          hours={load.account.rules.cancellationWindowHours}
          onClose={() => setCancelling(null)}
          onCancelled={onCancelled}
        />
      ) : null}
    </>
  )
}
