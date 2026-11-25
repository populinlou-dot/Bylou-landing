import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { SupabaseAuth } from "./supabase-auth"

function fakeClient(error: unknown = null) {
  const signInWithOtp = vi.fn().mockResolvedValue({ data: { user: null, session: null }, error })
  const verifyOtp = vi.fn().mockResolvedValue({
    data: { session: { user: { id: "u1", email: "alumna1@example.test" } } },
    error: null,
  })
  const client = { auth: { signInWithOtp, verifyOtp } } as unknown as SupabaseClient
  return { auth: new SupabaseAuth(() => client), signInWithOtp, verifyOtp }
}

describe("SupabaseAuth captcha forwarding (ADR-024)", () => {
  it("forwards the captcha token to signInWithOtp as options.captchaToken", async () => {
    const { auth, signInWithOtp } = fakeClient()
    expect(await auth.requestCode(" Alumna1@Example.test ", { captchaToken: "token-1" })).toEqual({ ok: true })
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "alumna1@example.test",
      options: { shouldCreateUser: true, captchaToken: "token-1" },
    })
  })

  it("sends no captchaToken when there is none (captcha off)", async () => {
    const { auth, signInWithOtp } = fakeClient()
    await auth.requestCode("alumna1@example.test")
    await auth.requestCode("alumna1@example.test", { captchaToken: "  " })
    for (const [args] of signInWithOtp.mock.calls) {
      expect(args).toEqual({ email: "alumna1@example.test", options: { shouldCreateUser: true } })
    }
  })

  it("does not call Supabase (or spend the token) for an invalid email", async () => {
    const { auth, signInWithOtp } = fakeClient()
    expect(await auth.requestCode("not-an-email", { captchaToken: "token-1" })).toEqual({ ok: false, code: "invalid_email" })
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it("maps a rejected captcha to captcha_failed", async () => {
    const { auth } = fakeClient({ name: "AuthApiError", code: "captcha_failed", status: 400 })
    expect(await auth.requestCode("alumna1@example.test", { captchaToken: "spent" })).toEqual({ ok: false, code: "captcha_failed" })
  })

  it("verifies the code without a captcha token (/verify is not captcha-protected)", async () => {
    const { auth, verifyOtp } = fakeClient()
    expect((await auth.verifyCode("alumna1@example.test", "123456")).ok).toBe(true)
    expect(verifyOtp).toHaveBeenCalledWith({ email: "alumna1@example.test", token: "123456", type: "email" })
  })
})
