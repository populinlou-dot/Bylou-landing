"use client"

import { MapPin, MonitorPlay } from "lucide-react"
import type { AgendaEntry, MyOutcome, SessionState } from "../application"
import type { Modality } from "../domain"
import { useBooking, useCopy, type Translate } from "./booking-context"
import { Badge, type BadgeTone } from "./primitives"

export function useModalityLabel(): (modality: Modality) => string {
  const { brand } = useBooking()
  // Terminology may hold a "{name}" slot (e.g. "Sede {name}"); sessions carry no venue yet, so drop it.
  return (modality) => {
    const label = modality === "online" ? brand.terminology.location.online : brand.terminology.location.inPerson
    return label.replace(/\s*\{\w+\}/g, "").trim()
  }
}

export function ModalityIcon({ modality }: { modality: Modality }) {
  const Icon = modality === "online" ? MonitorPlay : MapPin
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
}

/** Badge for states that must be readable at a glance. Text, never color alone. */
export function stateBadge(state: SessionState, t: Translate): { label: string; tone: BadgeTone } | null {
  switch (state) {
    case "full":
      return { label: t("session.full"), tone: "brand" }
    case "cancelled":
      return { label: t("session.cancelled"), tone: "danger" }
    case "past":
      return { label: t("session.past"), tone: "neutral" }
    case "in_progress":
      return { label: t("session.inProgress"), tone: "success" }
    default:
      return null
  }
}

/** One sentence describing availability; null when the badge already says it all. */
export function availabilityText(entry: AgendaEntry, t: Translate): string | null {
  switch (entry.state) {
    case "available":
      return entry.spotsLeft === 1 ? t("session.spots.one") : t("session.spots.many", { n: entry.spotsLeft })
    case "full":
      return t("reason.session_full")
    case "cancelled":
      return t("reason.session_cancelled")
    case "in_progress":
      return t("reason.session_started")
    case "past":
      return null
    case "not_open":
      return t("reason.booking_not_open")
    case "closed":
      return t("reason.booking_closed")
  }
}

/** The student's own booking of a started/ended session: Asististe / No asististe / Reservada. */
export function outcomeText(outcome: MyOutcome, t: Translate): string {
  switch (outcome) {
    case "attended":
      return t("history.attended")
    case "absent":
      return t("history.absent")
    case "booked":
      return t("session.booked")
  }
}

/**
 * One sentence under the card title: the student's outcome when there is one, else availability.
 * An upcoming session she already booked shows only the booked state (the action line says it):
 * "Esta clase está completa." / closed / not open explain why booking is impossible and would
 * contradict it. Spots left stay (plain information). The state badge ("Completa") is unaffected.
 */
export function statusText(entry: AgendaEntry, t: Translate): string | null {
  if (entry.myOutcome) return outcomeText(entry.myOutcome, t)
  if (entry.action === "booked" && entry.state !== "available") return null
  return availabilityText(entry, t)
}

export function StateBadge({ state }: { state: SessionState }) {
  const t = useCopy()
  const badge = stateBadge(state, t)
  return badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null
}
