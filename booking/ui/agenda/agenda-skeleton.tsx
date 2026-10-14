"use client"

import { SkeletonBlock } from "../primitives"

/** Static under reduced motion (pulse is `motion-safe` only). Hidden from assistive tech: the live region announces loading. */
export function AgendaSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3" data-testid="agenda-skeleton">
      <SkeletonBlock className="h-4 w-44" />
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-card p-5">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-6 w-48" />
          <SkeletonBlock className="h-4 w-36" />
          <SkeletonBlock className="h-11 w-32" />
        </div>
      ))}
    </div>
  )
}
