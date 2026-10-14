"use client"

import { MessageCircle } from "lucide-react"
import type { BrandConfig } from "../theme"
import { useBooking, useCopy } from "./booking-context"
import { buttonClass } from "./primitives"

/** Instagram DM first, then mail; null when the brand has no contact channel. */
export function brandContactHref(brand: BrandConfig): string | null {
  return brand.contact.instagramDm ?? (brand.contact.email ? `mailto:${brand.contact.email}` : null)
}

/** "Escribile a Lou" style link to the studio's contact channel (brand config). */
export function ContactLink({ label, variant = "link" }: { label?: string; variant?: keyof typeof buttonClass }) {
  const { brand } = useBooking()
  const t = useCopy()
  const href = brandContactHref(brand)
  if (!href) return null
  const external = href.startsWith("http")
  return (
    <a
      href={href}
      className={buttonClass[variant]}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      <MessageCircle aria-hidden="true" className="size-4" />
      {label ?? t("contact.cta")}
    </a>
  )
}
