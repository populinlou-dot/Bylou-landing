"use client"

import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { getStudentDetail, isValidSessionId, lastValidDay, type AdminGrantView, type StudentBookingView } from "../../application"
import { useBooking, useCopy, useReadyRuntime } from "../../ui/booking-context"
import { formatDayMonth } from "../../ui/format"
import { useAdminRepository } from "../admin-context"
import { AdjustCreditsSheet, GrantPackSheet } from "./credit-sheets"
import { BookForSheet, CancelForSheet } from "./on-behalf-sheets"
import { StudentDetailView, type StudentDetailLoadState } from "./student-detail-view"
import { studentName } from "./student-format"

type OpenSheet =
  | { kind: "grant"; n: number }
  | { kind: "adjust"; grant: AdminGrantView }
  | { kind: "bookFor"; n: number }
  | { kind: "cancelFor"; booking: StudentBookingView }
  | null

/**
 * One student for staff (render behind <StaffGuard>). Every write is server-confirmed (no optimistic
 * state), then the whole detail is reloaded in the background so balance, packs and ledger agree.
 */
export function StudentDetailContainer({ id }: { id: string | null }) {
  const { repository, clock } = useReadyRuntime()
  const { brand } = useBooking()
  const admin = useAdminRepository()
  const t = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<StudentDetailLoadState>(() => (isValidSessionId(id) ? { status: "loading" } : { status: "not_found" }))
  const [sheet, setSheet] = useState<OpenSheet>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Each opening of the grant / book-for sheet is a new form with a new request key.
  const [opened, setOpened] = useState(0)

  useEffect(() => {
    if (!isValidSessionId(id)) {
      setLoad({ status: "not_found" })
      return
    }
    let active = true
    setLoad({ status: "loading" })
    getStudentDetail({ admin, repository, clock }, { id }).then(
      (detail) => {
        if (active) setLoad(detail ? { status: "ready", detail } : { status: "not_found" })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] student load failed", error)
        setLoad({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, repository, clock, id, attempt])

  /** Background reload after a write: keeps the page on screen; a failure keeps the old data. */
  const refresh = useCallback(() => {
    if (!isValidSessionId(id)) return
    getStudentDetail({ admin, repository, clock }, { id }).then(
      (detail) => {
        if (detail) setLoad({ status: "ready", detail })
      },
      (error: unknown) => console.error("[admin] student refresh failed", error),
    )
  }, [admin, repository, clock, id])

  function done(message: string) {
    setSheet(null)
    setNotice(message)
    refresh()
  }

  const detail = load.status === "ready" ? load.detail : null
  const name = detail ? studentName(detail.student, t) : ""

  return (
    <>
      <StudentDetailView
        load={load}
        notice={notice}
        onRetry={() => setAttempt((n) => n + 1)}
        actions={{
          onGrant: () => {
            setNotice(null)
            setOpened((n) => n + 1)
            setSheet({ kind: "grant", n: opened + 1 })
          },
          onAdjust: (grant) => {
            setNotice(null)
            setSheet({ kind: "adjust", grant })
          },
          onBookFor: () => {
            setNotice(null)
            setOpened((n) => n + 1)
            setSheet({ kind: "bookFor", n: opened + 1 })
          },
          onCancelFor: (booking) => {
            setNotice(null)
            setSheet({ kind: "cancelFor", booking })
          },
        }}
      />
      {detail && sheet?.kind === "grant" ? (
        <GrantPackSheet
          key={`grant-${sheet.n}`}
          userId={detail.student.userId}
          studentName={name}
          timezone={detail.timezone}
          today={detail.today}
          onClose={() => setSheet(null)}
          onGranted={(result) =>
            done(
              result.replayed
                ? t("admin.grant.replayed")
                : t("admin.grant.done", {
                    n: result.credits,
                    date: formatDayMonth(lastValidDay(result.expiresAt, detail.timezone), brand.locale),
                  }),
            )
          }
        />
      ) : null}
      {detail && sheet?.kind === "adjust" ? (
        <AdjustCreditsSheet
          key={`adjust-${sheet.grant.id}`}
          grant={sheet.grant}
          timezone={detail.timezone}
          onClose={() => setSheet(null)}
          onAdjusted={(result) => done(result.replayed ? t("admin.adjust.replayed") : t("admin.adjust.done", { n: result.balance }))}
        />
      ) : null}
      {detail && sheet?.kind === "bookFor" ? (
        <BookForSheet
          key={`book-${sheet.n}`}
          userId={detail.student.userId}
          studentName={name}
          onClose={() => setSheet(null)}
          onBooked={(result) =>
            done(result.replayed ? t("admin.bookFor.replayed") : t("admin.bookFor.done", { n: result.remainingCredits ?? 0 }))
          }
        />
      ) : null}
      {detail && sheet?.kind === "cancelFor" ? (
        <CancelForSheet
          key={`cancel-${sheet.booking.bookingId}`}
          booking={sheet.booking}
          studentName={name}
          timezone={detail.timezone}
          onClose={() => setSheet(null)}
          onCancelled={(result) =>
            done(
              result.refunded
                ? t("admin.cancelFor.refunded")
                : result.refundSkipped
                  ? t("admin.cancelFor.skipped")
                  : t("admin.cancelFor.noRefund"),
            )
          }
        />
      ) : null}
    </>
  )
}

/** Route adapter: reads `?id=` on the client. Render inside <Suspense> (static export). */
export function StudentDetailFromSearchParams() {
  const id = useSearchParams().get("id")
  return <StudentDetailContainer key={id ?? ""} id={id} />
}
