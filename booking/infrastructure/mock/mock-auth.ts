/**
 * In-memory AuthPort for the `mock` data source. No email is sent: the fixed demo code is
 * returned by requestCode and shown on screen (ARCHITECTURE §10). Every email signs in as the
 * same fictional demo student, so the demo pack and history are always there.
 */
import type { AuthPort, AuthUser, RequestCodeResult, VerifyCodeResult } from "../../application"

export const DEMO_OTP_CODE = "123456"
export const DEMO_USER_ID = "demo-alumna"

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
    this.setUser({ id: DEMO_USER_ID, email: normalized })
    return { ok: true, user: { id: DEMO_USER_ID, email: normalized } }
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
