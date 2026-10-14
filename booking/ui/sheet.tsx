"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { useCopy } from "./booking-context"

/**
 * Bottom sheet on mobile, centered dialog from `sm` (UX_DESIGN S2/S6). Radix provides
 * role="dialog", aria-modal, focus trap and Esc to close. Without a Radix <Trigger>, Radix
 * does not restore focus, so the sheet returns it to the element focused when it opened.
 * Portalled into the booking theme scope so brand CSS variables still apply.
 * No slide animation: nothing to disable under prefers-reduced-motion.
 */
export function Sheet({
  title,
  onClose,
  children,
  closeDisabled = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /** Esc / outside click / ✕ are ignored while a request is in flight. */
  closeDisabled?: boolean
}) {
  const t = useCopy()
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)))
  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>("[data-booking-theme]") ?? document.body)
  }, [])
  if (!container) return null

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !closeDisabled && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[color:var(--inverse)]/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener?.isConnected) opener.focus()
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-[var(--radius-card)] border border-border bg-card p-5 pb-8 text-card-foreground [box-shadow:var(--shadow-raised)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-card)] sm:p-7"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="[font-family:var(--font-display)] text-[24px] font-medium leading-tight text-foreground">
              {title}
            </Dialog.Title>
            <Dialog.Close
              disabled={closeDisabled}
              aria-label={t("sheet.close")}
              className="-mr-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-50"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
