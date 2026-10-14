import type { Metadata } from "next"
import { Suspense } from "react"
import { SignInFromSearchParams } from "@/booking/ui"

export const metadata: Metadata = {
  title: "Ingresar",
}

/** `/reservas/ingresar/?returnTo=…` — email OTP sign-in (ADR-004). Suspense: query read on the client. */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInFromSearchParams />
    </Suspense>
  )
}
