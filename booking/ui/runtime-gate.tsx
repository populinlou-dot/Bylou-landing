"use client"

import { Clock3, Settings2 } from "lucide-react"
import type { ReactNode } from "react"
import { useBooking, useCopy } from "./booking-context"
import { StatusPanel, buttonClass } from "./primitives"

/**
 * Renders children only with a ready runtime. Config problems are explicit states,
 * never a silent switch to mock data (ADR-013).
 */
export function BookingRuntimeGate({ children }: { children: ReactNode }) {
  const { runtime } = useBooking()
  if (runtime.status === "ready") return <>{children}</>
  if (runtime.status === "unavailable") return <UnavailableState />
  return <ConfigErrorState variable={runtime.variable} received={runtime.received} />
}

export function ConfigErrorState({ variable, received }: { variable: string; received: string | null }) {
  const t = useCopy()
  return (
    <StatusPanel role="alert" titleAs="h1" icon={<Settings2 className="size-5" />} title={t("config.error.title")}>
      <p>{t("config.error.body")}</p>
      <p className="mt-3 text-[13.5px]">
        {t("config.error.detail", { name: variable })}{" "}
        {received !== null ? (
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{`${variable}=${received}`}</code>
        ) : null}
      </p>
    </StatusPanel>
  )
}

function UnavailableState() {
  const t = useCopy()
  const { brand } = useBooking()
  const contact = brand.contact.instagramDm ?? (brand.contact.email ? `mailto:${brand.contact.email}` : null)
  return (
    <StatusPanel
      role="status"
      titleAs="h1"
      icon={<Clock3 className="size-5" />}
      title={t("config.unavailable.title")}
      action={
        contact ? (
          <a href={contact} className={buttonClass.primary} rel="noopener noreferrer" target={contact.startsWith("http") ? "_blank" : undefined}>
            {t("contact.cta")}
          </a>
        ) : null
      }
    >
      <p>{t("config.unavailable.body")}</p>
    </StatusPanel>
  )
}
