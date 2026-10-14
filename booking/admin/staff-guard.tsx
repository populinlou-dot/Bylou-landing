"use client"

import { AlertCircle, LockKeyhole, LogIn, RotateCw } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { ADMIN_PATH, AGENDA_PATH, resolveStaffAccess, signInHref } from "../application"
import { useAuthState, useCopy, useReadyRuntime } from "../ui/booking-context"
import { SkeletonBlock, StatusPanel, buttonClass } from "../ui/primitives"
import { useAdminRepository, useDemoStaffEmail } from "./admin-context"

export type StaffGuardState =
  | { status: "checking" }
  | { status: "signed_out" }
  | { status: "forbidden" }
  | { status: "error" }
  /** Resolved for this user id only: a user switch never renders admin content early. */
  | { status: "staff"; userId: string }

/**
 * UX-only gate (ADR-005, AD-01): the only admin call it makes is reading the caller's own role.
 * Children (which load admin data) mount only for staff. RLS/RPC remain the real protection.
 */
export function StaffGuard({ children }: { children: ReactNode }) {
  const auth = useAuthState()
  const admin = useAdminRepository()
  const { auth: authPort } = useReadyRuntime()
  const [state, setState] = useState<StaffGuardState>({ status: "checking" })
  const [attempt, setAttempt] = useState(0)
  const userId = auth.status === "signed_in" ? auth.user.id : null
  const returnTo = useAdminReturnTo()

  useEffect(() => {
    if (auth.status === "loading") {
      setState({ status: "checking" })
      return
    }
    if (!userId) {
      setState({ status: "signed_out" })
      return
    }
    let active = true
    setState({ status: "checking" })
    resolveStaffAccess({ admin }).then(
      (access) => {
        if (!active) return
        setState(access === "staff" ? { status: "staff", userId } : { status: access })
      },
      (error: unknown) => {
        if (!active) return
        console.error("[admin] role check failed", error)
        setState({ status: "error" })
      },
    )
    return () => {
      active = false
    }
  }, [admin, auth.status, userId, attempt])

  if (state.status === "staff" && state.userId === userId) return <>{children}</>
  const shown: StaffGuardState = state.status === "staff" ? { status: "checking" } : state
  return (
    <StaffGuardView
      state={shown}
      returnTo={returnTo}
      onRetry={() => setAttempt((n) => n + 1)}
      onSignOut={() => void authPort.signOut()}
    />
  )
}

/** Current admin path (+ query) to come back to after signing in; sanitised by signInHref. */
function useAdminReturnTo(): string {
  const pathname = usePathname() ?? ADMIN_PATH
  const [search, setSearch] = useState("")
  useEffect(() => {
    setSearch(window.location.search)
  }, [pathname])
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`
  return `${path}${search}`
}

export function StaffGuardView({
  state,
  returnTo,
  onRetry,
  onSignOut,
}: {
  state: Exclude<StaffGuardState, { status: "staff" }>
  returnTo: string
  onRetry: () => void
  onSignOut: () => void
}) {
  const t = useCopy()
  const demoStaffEmail = useDemoStaffEmail()

  if (state.status === "checking") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p role="status" aria-live="polite" className="sr-only">
          {t("admin.guard.checking")}
        </p>
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-24 w-full rounded-[var(--radius-card)]" />
      </div>
    )
  }

  if (state.status === "signed_out") {
    return (
      <StatusPanel
        role="status"
        titleAs="h1"
        icon={<LogIn className="size-5" />}
        title={t("admin.guard.signIn")}
        action={
          <Link href={signInHref(returnTo)} className={buttonClass.primary}>
            {t("auth.signIn")}
          </Link>
        }
      >
        {demoStaffEmail ? <p>{t("admin.demoHint", { email: demoStaffEmail })}</p> : null}
      </StatusPanel>
    )
  }

  if (state.status === "forbidden") {
    return (
      <StatusPanel
        role="alert"
        titleAs="h1"
        icon={<LockKeyhole className="size-5" />}
        title={t("admin.guard.forbidden.title")}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={AGENDA_PATH} className={buttonClass.primary}>
              {t("admin.guard.toAgenda")}
            </Link>
            <button type="button" onClick={onSignOut} className={buttonClass.secondary}>
              {t("auth.signOut")}
            </button>
          </div>
        }
      >
        <p>{t("admin.guard.forbidden.body")}</p>
      </StatusPanel>
    )
  }

  return (
    <StatusPanel
      role="alert"
      titleAs="h1"
      icon={<AlertCircle className="size-5" />}
      title={t("admin.guard.error")}
      action={
        <button type="button" onClick={onRetry} className={buttonClass.primary}>
          <RotateCw aria-hidden="true" className="size-4" />
          {t("error.retry")}
        </button>
      }
    />
  )
}
