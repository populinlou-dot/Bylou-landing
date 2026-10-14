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
import { WaitlistAction } from "./waitlist-action"

/**
 * "Reservar" for one session, driven by `entry.action` (decided in the application layer in the
 * domain order, so a past session never reads as "already booked"). Signed out → sign-in with
 * the intent preserved (returnTo = session detail with `reservar=1`). Signed in → confirm sheet.
 * Booked (upcoming) → note + link to "Mis reservas". Full with the waitlist on → join / place + leave
 * (WaitlistAction). Anything else → nothing (the card says why).
 */
export function ReserveAction({
  entry,
  timezone,
  describedBy,
  fullWidth = false,
  autoOpen = false,
  waitlistHours = null,
}: {
  entry: AgendaEntry
  timezone: string
  describedBy?: string
  fullWidth?: boolean
  /** Re-open the sheet after returning from sign-in. */
  autoOpen?: boolean
  /** Studio cancellation window (session detail): adds the waitlist rule / closed-window explanations. */
  waitlistHours?: number | null
}) {
  const t = useCopy()
  const auth = useAuthState()
  const router = useRouter()
  const refresh = useDataRefresh()
  const [open, setOpen] = useState(false)
  const autoOpened = useRef(false)
  /** Set when the sheet closes after a booking: the "Reservar" button is gone, focus the link instead. */
  const focusMine = useRef(false)
  const mineLink = useRef<HTMLAnchorElement>(null)
  const bookable = entry.action === "book"

  useEffect(() => {
    if (!autoOpen || autoOpened.current || auth.status !== "signed_in" || !bookable) return
    autoOpened.current = true
    setOpen(true)
  }, [autoOpen, auth.status, bookable])

  useEffect(() => {
    if (open || !focusMine.current || !mineLink.current) return
    focusMine.current = false
    mineLink.current.focus()
  }, [open, entry.action])

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

  function booked() {
    // Re-read the session right away so the card behind the sheet shows the new spots count.
    focusMine.current = true
    refresh(entry.session.id)
  }

  return (
    <>
      {entry.action === "booked" ? (
        <div className={cx("flex flex-col gap-1", !fullWidth && "sm:flex-row sm:items-center sm:gap-3")}>
          <p className="flex items-center gap-1.5 text-[14.5px] font-semibold text-[color:var(--success)]">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
            {t("reason.already_booked")}
          </p>
          <Link ref={mineLink} href={MY_BOOKINGS_PATH} className={buttonClass.link}>
            {t("success.mine")}
          </Link>
        </div>
      ) : entry.action === "join_waitlist" || entry.action === "waiting" ? (
        <WaitlistAction entry={entry} hours={waitlistHours} describedBy={describedBy} fullWidth={fullWidth} />
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
      {open ? <ConfirmSheet entry={entry} timezone={timezone} onClose={() => setOpen(false)} onBooked={booked} /> : null}
    </>
  )
}
