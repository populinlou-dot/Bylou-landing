"use client"

import { CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { MY_BOOKINGS_PATH, sessionHref, signInHref, type AgendaEntry } from "../../application"
import { useAuthState, useCopy } from "../booking-context"
import { cx } from "../format"
import { buttonClass } from "../primitives"
import { ConfirmSheet } from "./confirm-sheet"
import { useDataRefresh } from "./refresh-context"

/**
 * "Reservar" for one session. Signed out → sign-in with the intent preserved
 * (returnTo = session detail with `reservar=1`). Signed in → confirm sheet.
 * Already booked → note + link to "Mis reservas". Not bookable → nothing (the card says why).
 */
export function ReserveAction({
  entry,
  timezone,
  describedBy,
  fullWidth = false,
  autoOpen = false,
}: {
  entry: AgendaEntry
  timezone: string
  describedBy?: string
  fullWidth?: boolean
  /** Re-open the sheet after returning from sign-in. */
  autoOpen?: boolean
}) {
  const t = useCopy()
  const auth = useAuthState()
  const router = useRouter()
  const refresh = useDataRefresh()
  const [open, setOpen] = useState(false)
  const booked = useRef(false)
  const autoOpened = useRef(false)
  const bookable = entry.state === "available" && entry.myBookingId === null

  useEffect(() => {
    if (!autoOpen || autoOpened.current || auth.status !== "signed_in" || !bookable) return
    autoOpened.current = true
    setOpen(true)
  }, [autoOpen, auth.status, bookable])

  function start(event: MouseEvent<HTMLButtonElement>) {
    if (auth.status === "loading") return
    // Safari does not focus buttons on click; the sheet returns focus to the opener.
    event.currentTarget.focus()
    if (auth.status === "signed_out") {
      router.push(signInHref(sessionHref(entry.session.id, true)))
      return
    }
    setOpen(true)
  }

  function close() {
    setOpen(false)
    if (booked.current) {
      booked.current = false
      refresh()
    }
  }

  return (
    <>
      {entry.myBookingId ? (
        <div className={cx("flex flex-col gap-1", !fullWidth && "sm:flex-row sm:items-center sm:gap-3")}>
          <p className="flex items-center gap-1.5 text-[14.5px] font-semibold text-[color:var(--success)]">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
            {t("reason.already_booked")}
          </p>
          <Link href={MY_BOOKINGS_PATH} className={buttonClass.link}>
            {t("success.mine")}
          </Link>
        </div>
      ) : bookable ? (
        <button
          type="button"
          onClick={start}
          aria-describedby={describedBy}
          aria-disabled={auth.status === "loading" ? true : undefined}
          className={cx(buttonClass.primary, fullWidth ? "w-full" : "self-start")}
        >
          {t("session.cta")}
        </button>
      ) : null}
      {open ? (
        <ConfirmSheet entry={entry} timezone={timezone} onClose={close} onBooked={() => (booked.current = true)} />
      ) : null}
    </>
  )
}
