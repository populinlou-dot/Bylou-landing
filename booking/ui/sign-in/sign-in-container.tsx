"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { needsDisplayName, sanitizeReturnTo, saveDisplayName, type AuthChallenge, type AuthCode } from "../../application"
import { useAuthState, useBooking, useCaptchaConfig, useCopy, useReadyRuntime } from "../booking-context"
import { ProfileNameView, type ProfileNameError } from "./profile-name-view"
import { SignInView, type SignInStep } from "./sign-in-view"
import { TurnstileWidget, type TurnstileWidgetHandle } from "./turnstile"

/** Supabase's default minimum between OTP emails is 60 s; the button mirrors it. */
export const RESEND_COOLDOWN_SECONDS = 60

export function SignInContainer({ returnTo }: { returnTo: string }) {
  const { auth, repository } = useReadyRuntime()
  const authState = useAuthState()
  const router = useRouter()
  const t = useCopy()
  const { brand } = useBooking()
  const captcha = useCaptchaConfig()
  const captchaRef = useRef<TurnstileWidgetHandle>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaBlocked = captcha !== null && captchaToken === null
  /** "name" = required profile step (no display name yet; owner decision 2026-10-14). */
  const [step, setStep] = useState<SignInStep | "name">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthCode | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<ProfileNameError | null>(null)
  // Set while verify() owns the navigation (it may show the profile step before leaving).
  const verifying = useRef(false)

  // Already signed in when arriving: ask for the missing name first, else continue to the destination.
  useEffect(() => {
    if (authState.status !== "signed_in" || verifying.current) return
    let active = true
    needsDisplayName({ repository }).then((missing) => {
      if (!active) return
      if (missing) setStep("name")
      else router.replace(returnTo)
    })
    return () => {
      active = false
    }
  }, [authState.status, repository, returnTo, router])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode(isResend: boolean) {
    if (captchaBlocked) return
    const challenge: AuthChallenge | undefined = captchaToken ? { captchaToken } : undefined
    setPending(true)
    setError(null)
    setNotice(null)
    const result = await auth.requestCode(email, challenge)
    // Single use: Supabase spent the token on this request whatever the outcome, so get a fresh one.
    if (challenge) captchaRef.current?.reset()
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
    verifying.current = true
    const result = await auth.verifyCode(email, code)
    if (!result.ok) {
      verifying.current = false
      setPending(false)
      setError(result.code)
      return
    }
    // No name yet: the required step comes first (a failed check continues; the server still asks for it).
    if (await needsDisplayName({ repository })) {
      setPending(false)
      setStep("name")
      return
    }
    // Keep the button busy while navigating to the validated destination.
    router.replace(returnTo)
  }

  async function saveName() {
    setPending(true)
    setNameError(null)
    const result = await saveDisplayName({ repository }, name)
    if (result.ok) {
      router.replace(returnTo)
      return
    }
    setPending(false)
    if (result.code === "empty" || result.code === "too_long" || result.code === "invalid_chars") {
      setNameError(result.code)
      return
    }
    console.error("[booking] display name save failed", result.code)
    setNameError("save")
  }

  if (step === "name") {
    return (
      <ProfileNameView
        name={name}
        pending={pending}
        error={nameError}
        onNameChange={(value) => {
          setName(value)
          if (nameError) setNameError(null)
        }}
        onSubmit={() => void saveName()}
      />
    )
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
      captchaBlocked={captchaBlocked}
      captcha={
        captcha ? (
          <TurnstileWidget
            ref={captchaRef}
            siteKey={captcha.siteKey}
            locale={brand.locale}
            onToken={setCaptchaToken}
            showPendingHint={step === "email"}
          />
        ) : null
      }
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
