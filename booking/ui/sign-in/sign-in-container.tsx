"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { sanitizeReturnTo, type AuthCode } from "../../application"
import { useAuthState, useCopy, useReadyRuntime } from "../booking-context"
import { SignInView, type SignInStep } from "./sign-in-view"

/** Supabase's default minimum between OTP emails is 60 s; the button mirrors it. */
export const RESEND_COOLDOWN_SECONDS = 60

export function SignInContainer({ returnTo }: { returnTo: string }) {
  const { auth } = useReadyRuntime()
  const authState = useAuthState()
  const router = useRouter()
  const t = useCopy()
  const [step, setStep] = useState<SignInStep>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthCode | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Already signed in (or just verified): continue to the validated destination.
  useEffect(() => {
    if (authState.status === "signed_in") router.replace(returnTo)
  }, [authState.status, returnTo, router])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode(isResend: boolean) {
    setPending(true)
    setError(null)
    setNotice(null)
    const result = await auth.requestCode(email)
    setPending(false)
    if (!result.ok) {
      setError(result.code)
      return
    }
    setDemoCode(result.demoCode ?? null)
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setCode("")
    if (isResend) setNotice(t("auth.resent"))
    setStep("code")
  }

  async function verify() {
    setPending(true)
    setError(null)
    setNotice(null)
    const result = await auth.verifyCode(email, code)
    if (!result.ok) {
      setPending(false)
      setError(result.code)
      return
    }
    // Keep the button busy while navigating to the validated destination.
    router.replace(returnTo)
  }

  return (
    <SignInView
      step={step}
      email={email}
      code={code}
      pending={pending}
      error={error}
      cooldown={cooldown}
      demoCode={demoCode}
      notice={notice}
      onEmailChange={(value) => {
        setEmail(value)
        if (error) setError(null)
      }}
      onCodeChange={(value) => {
        setCode(value)
        if (error) setError(null)
      }}
      onSubmitEmail={() => void sendCode(false)}
      onSubmitCode={() => void verify()}
      onResend={() => void sendCode(true)}
      onChangeEmail={() => {
        setStep("email")
        setCode("")
        setError(null)
        setNotice(null)
        setDemoCode(null)
      }}
    />
  )
}

/** Route adapter: `?returnTo=` is sanitised (open-redirect guard). Render inside <Suspense>. */
export function SignInFromSearchParams() {
  const returnTo = sanitizeReturnTo(useSearchParams().get("returnTo"))
  return <SignInContainer returnTo={returnTo} />
}
