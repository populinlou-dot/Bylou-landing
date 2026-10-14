"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { AdminRepository } from "../application"

interface AdminContextValue {
  repository: AdminRepository | null
  /** Demo-only sign-in hint (mock data source); null with a real backend. */
  demoStaffEmail: string | null
}

const AdminContext = createContext<AdminContextValue>({ repository: null, demoStaffEmail: null })

/**
 * Provided by the /admin composition root, inside <BookingProvider> (brand, runtime, auth).
 * booking/admin never imports brands or infrastructure: the admin adapter arrives as a prop.
 */
export function AdminProvider({
  repository,
  demoStaffEmail = null,
  children,
}: {
  repository: AdminRepository | null
  demoStaffEmail?: string | null
  children: ReactNode
}) {
  const value = useMemo(() => ({ repository, demoStaffEmail }), [repository, demoStaffEmail])
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

/** Admin adapter for containers rendered behind <BookingRuntimeGate> + <StaffGuard>. */
export function useAdminRepository(): AdminRepository {
  const { repository } = useContext(AdminContext)
  if (!repository) throw new Error("Admin repository missing; render inside <AdminProvider> with a ready runtime")
  return repository
}

export function useDemoStaffEmail(): string | null {
  return useContext(AdminContext).demoStaffEmail
}
