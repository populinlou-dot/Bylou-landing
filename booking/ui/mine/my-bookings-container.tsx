"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  RepositoryError,
  getMyAccount,
  leaveWaitlist,
  type CancelResult,
  type MyBookingEntry,
  type MyWaitlistItem,
} from "../../application"
import { useAuthState, useBooking, useCopy, useReadyRuntime } from "../booking-context"
import { waitlistFailureMessage } from "../reserve/waitlist-action"
import { CancelSheet } from "./cancel-sheet"
import { MyBookingsView, type MyBookingsLoadState } from "./my-bookings-view"

/** `/reservas/mis-reservas/`: needs a signed-in user; RLS returns only their own rows. */
export function MyBookingsContainer() {
  const { repository, clock } = useReadyRuntime()
  const waitlist = useBooking().brand.features.waitlist
  const auth = useAuthState()
  const t = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<MyBookingsLoadState>({ status: "loading" })
  const [cancelling, setCancelling] = useState<MyBookingEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<{ entryId: string; message: string } | null>(null)
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
    getMyAccount({ repository, clock, waitlist }).then(
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
  }, [repository, clock, waitlist, auth.status, userId, attempt])

  const onCancelled = useCallback(
    (result: Extract<CancelResult, { ok: true }>) => {
      setCancelling(null)
      setNotice(result.refunded ? t("cancel.done") : t("cancel.doneNoRefund"))
      silent.current = true
      setAttempt((n) => n + 1)
    },
    [t],
  )

  async function onLeave(item: MyWaitlistItem) {
    if (leaving) return
    setLeaving(item.entryId)
    setNotice(null)
    setLeaveError(null)
    const result = await leaveWaitlist({ repository }, item.session.id)
    setLeaving(null)
    if (!result.ok) {
      setLeaveError({ entryId: item.entryId, message: waitlistFailureMessage(result.code, t, null) })
      return
    }
    setNotice(result.status === "promoted" ? t("waitlist.promoted") : t("waitlist.left"))
    silent.current = true
    setAttempt((n) => n + 1)
  }

  return (
    <>
      <MyBookingsView
        load={load}
        notice={notice}
        leaving={leaving}
        leaveError={leaveError}
        onLeave={(item) => void onLeave(item)}
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
