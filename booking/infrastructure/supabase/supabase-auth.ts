/**
 * AuthPort over Supabase Auth email OTP (ADR-004): the 6-digit code is typed on the same page,
 * so cross-device email opening works and no PKCE verifier is involved.
 * Bot protection (ADR-024): the captcha token goes to `signInWithOtp` (`POST /otp`, captcha-checked
 * by GoTrue). `verifyOtp` (`POST /verify`) is not captcha-checked, so it never receives one.
 */
import type { AuthChallenge, AuthPort, AuthUser, RequestCodeResult, VerifyCodeResult } from "../../application"
import type { SupabaseClientProvider } from "./client"
import { mapAuthError } from "./mappers"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE = /^\d{6}$/

interface SessionLike {
  user: { id: string; email?: string | null }
}

export function toAuthUser(session: SessionLike | null | undefined): AuthUser | null {
  if (!session) return null
  return { id: session.user.id, email: session.user.email ?? "" }
}

export class SupabaseAuth implements AuthPort {
  constructor(private readonly client: SupabaseClientProvider) {}

  async getUser(): Promise<AuthUser | null> {
    const { data } = await this.client().auth.getSession()
    return toAuthUser(data.session)
  }

  onChange(listener: (user: AuthUser | null) => void): () => void {
    // Supabase emits INITIAL_SESSION on subscribe. The callback stays synchronous: awaiting other
    // supabase calls inside it can deadlock the auth lock.
    const { data } = this.client().auth.onAuthStateChange((_event, session) => listener(toAuthUser(session)))
    return () => data.subscription.unsubscribe()
  }

  async requestCode(email: string, challenge?: AuthChallenge): Promise<RequestCodeResult> {
    const normalized = email.trim().toLowerCase()
    if (!EMAIL.test(normalized)) return { ok: false, code: "invalid_email" }
    const captchaToken = challenge?.captchaToken?.trim()
    try {
      const { error } = await this.client().auth.signInWithOtp({
        email: normalized,
        options: captchaToken ? { shouldCreateUser: true, captchaToken } : { shouldCreateUser: true },
      })
      return error ? { ok: false, code: mapAuthError(error, "request") } : { ok: true }
    } catch {
      return { ok: false, code: "network_error" }
    }
  }

  async verifyCode(email: string, code: string): Promise<VerifyCodeResult> {
    const normalized = email.trim().toLowerCase()
    const token = code.trim()
    if (!EMAIL.test(normalized)) return { ok: false, code: "invalid_email" }
    if (!CODE.test(token)) return { ok: false, code: "invalid_code" }
    try {
      const { data, error } = await this.client().auth.verifyOtp({ email: normalized, token, type: "email" })
      if (error) return { ok: false, code: mapAuthError(error, "verify") }
      const user = toAuthUser(data.session)
      return user ? { ok: true, user } : { ok: false, code: "unknown" }
    } catch {
      return { ok: false, code: "network_error" }
    }
  }

  async signOut(): Promise<void> {
    // Local scope: signs this browser out even when offline; other devices keep their session.
    await this.client().auth.signOut({ scope: "local" })
  }
}
