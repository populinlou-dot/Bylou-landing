/**
 * In-memory AuthPort for the `mock` data source. No email is sent: the fixed demo code is
 * returned by requestCode and shown on screen (ARCHITECTURE §10). Every email signs in as the
 * same fictional demo student, so the demo pack and history are always there — except an
 * address whose local part is "staff" (e.g. staff@demo.test), which signs in as the fictional
 * demo staff member so the /admin/ demo works (Phase 4.1), and "nueva" (e.g. nueva@demo.test), a second
 * fictional student who has a pack but no name yet (required name step, waitlist journey; Phase 4.4).
 * There is no bot protection in the demo: a captcha challenge, if passed, is ignored (ADR-024).
 */
import type { AuthPort, AuthUser, RequestCodeResult, VerifyCodeResult } from "../../application"

export const DEMO_OTP_CODE = "123456"
export const DEMO_USER_ID = "demo-alumna"
export const DEMO_STAFF_ID = "demo-staff"
/** Second demo student: a pack, no display name yet (Phase 4.4). */
export const DEMO_NEW_STUDENT_ID = "demo-alumna-nueva"
export const DEMO_NEW_STUDENT_EMAIL = "nueva@demo.test"
/** Shown as a hint on the admin sign-in state in demo mode. */
export const DEMO_STAFF_EMAIL = "staff@demo.test"

const isDemoStaffEmail = (email: string) => email.split("@")[0] === "staff"
const isDemoNewStudentEmail = (email: string) => email.split("@")[0] === "nueva"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class MockAuth implements AuthPort {
  private user: AuthUser | null = null
  private pendingEmail: string | null = null
  private readonly listeners = new Set<(user: AuthUser | null) => void>()

  constructor(private readonly options: { latencyMs?: number } = {}) {}

  /** Synchronous accessor for the mock repository (same in-memory session). */
  currentUserId(): string | null {
    return this.user?.id ?? null
  }

  async getUser(): Promise<AuthUser | null> {
    await this.delay()
    return this.user ? { ...this.user } : null
  }

  onChange(listener: (user: AuthUser | null) => void): () => void {
    this.listeners.add(listener)
    listener(this.user ? { ...this.user } : null)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async requestCode(email: string): Promise<RequestCodeResult> {
    await this.delay()
    const normalized = email.trim().toLowerCase()
    if (!EMAIL.test(normalized)) return { ok: false, code: "invalid_email" }
    this.pendingEmail = normalized
    return { ok: true, demoCode: DEMO_OTP_CODE }
  }

  async verifyCode(email: string, code: string): Promise<VerifyCodeResult> {
    await this.delay()
    const normalized = email.trim().toLowerCase()
    if (!EMAIL.test(normalized)) return { ok: false, code: "invalid_email" }
    if (this.pendingEmail !== normalized || code.trim() !== DEMO_OTP_CODE) return { ok: false, code: "invalid_code" }
    this.pendingEmail = null
    const id = isDemoStaffEmail(normalized) ? DEMO_STAFF_ID : isDemoNewStudentEmail(normalized) ? DEMO_NEW_STUDENT_ID : DEMO_USER_ID
    const user = { id, email: normalized }
    this.setUser(user)
    return { ok: true, user: { ...user } }
  }

  async signOut(): Promise<void> {
    await this.delay()
    this.setUser(null)
  }

  private setUser(user: AuthUser | null): void {
    this.user = user
    for (const listener of this.listeners) listener(user ? { ...user } : null)
  }

  private delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
  }
}
