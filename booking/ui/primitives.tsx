"use client"

import type { ReactNode } from "react"
import { useBooking } from "./booking-context"
import { cx } from "./format"

/** Pill/rounded control sizes keep a 44px minimum target (UX_DESIGN §5.2). */
export const buttonClass = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-button)] bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors duration-[var(--dur)] ease-[var(--ease)] hover:bg-[color:var(--primary-hover)]",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-button)] border-[1.5px] border-input bg-card px-5 text-[15px] font-semibold text-primary transition-colors duration-[var(--dur)] ease-[var(--ease)] hover:bg-secondary",
  link: "inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline",
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] font-bold uppercase tracking-[0.22em] text-primary">{children}</p>
}

/**
 * Display heading in the brand display font. Brands with `italicEmphasis` put the last
 * word in italic primary (Bylou signature); others render plain text.
 */
export function DisplayTitle({
  as: Tag = "h1",
  id,
  className,
  children,
}: {
  as?: "h1" | "h2"
  id?: string
  className?: string
  children: string
}) {
  const { brand } = useBooking()
  const words = children.trim().split(/\s+/)
  const emphasize = brand.theme.fonts.italicEmphasis && words.length > 1
  const last = words.pop()
  return (
    <Tag
      id={id}
      className={cx(
        "[font-family:var(--font-display)] font-medium leading-[1.08] tracking-[-0.02em] text-foreground",
        className,
      )}
    >
      {emphasize ? (
        <>
          {words.join(" ")} <em className="italic text-primary">{last}</em>
        </>
      ) : (
        children
      )}
    </Tag>
  )
}

export type BadgeTone = "brand" | "neutral" | "danger" | "success"

const badgeTone: Record<BadgeTone, string> = {
  brand: "bg-secondary text-primary",
  neutral: "bg-muted text-muted-foreground border border-border",
  danger: "bg-card text-destructive border border-[color:var(--destructive)]",
  success: "bg-card text-[color:var(--success)] border border-[color:var(--success)]",
}

export function Badge({ tone = "brand", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em]",
        badgeTone[tone],
      )}
    >
      {children}
    </span>
  )
}

/** Shared frame for empty / error / config / not-found states: always text + one next action. */
export function StatusPanel({
  icon,
  title,
  children,
  action,
  role,
  titleAs: TitleTag = "h2",
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  role?: "alert" | "status"
  titleAs?: "h1" | "h2"
}) {
  return (
    <div
      role={role}
      className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-border bg-card p-6 [box-shadow:var(--shadow-card)] sm:p-8"
    >
      {icon ? (
        <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-secondary text-primary">
          {icon}
        </span>
      ) : null}
      <TitleTag className="[font-family:var(--font-display)] text-[22px] font-medium leading-tight text-foreground">
        {title}
      </TitleTag>
      {children ? <div className="text-[15px] text-muted-foreground">{children}</div> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block rounded-full bg-secondary motion-safe:animate-pulse", className)} />
}
