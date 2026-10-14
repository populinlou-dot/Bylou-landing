import type { Metadata } from "next"
import { Suspense } from "react"
import { SignInFromSearchParams } from "@/booking/ui"
import { routeCopy } from "../../_booking/route-copy"

export const metadata: Metadata = {
  title: routeCopy("auth.signIn"),
}

/** `/reservas/ingresar/?returnTo=…` — email OTP sign-in (ADR-004). Suspense: query read on the client. */
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInFromSearchParams />
    </Suspense>
  )
}
