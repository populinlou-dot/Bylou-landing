"use client"

import type { AdminSessionState } from "../application"
import { useCopy } from "../ui/booking-context"
import { Badge, type BadgeTone } from "../ui/primitives"

const STATE_TONE: Record<AdminSessionState, BadgeTone> = {
  upcoming: "brand",
  in_progress: "success",
  finished: "neutral",
  cancelled: "danger",
}

/** Session state as text (never color alone). */
export function AdminStateBadge({ state }: { state: AdminSessionState }) {
  const t = useCopy()
  return <Badge tone={STATE_TONE[state]}>{t(`admin.state.${state}`)}</Badge>
}

/** "8/8" with a spoken equivalent ("8 de 8 lugares ocupados"). */
export function Occupancy({ confirmed, capacity }: { confirmed: number; capacity: number }) {
  const t = useCopy()
  return (
    <span className="tabular-nums">
      <span aria-hidden="true">{t("admin.session.occupancy", { n: confirmed, capacity })}</span>
      <span className="sr-only">{t("admin.session.occupancyLabel", { n: confirmed, capacity })}</span>
    </span>
  )
}
