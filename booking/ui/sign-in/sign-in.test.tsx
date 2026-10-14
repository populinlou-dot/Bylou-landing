import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { SignInContainer } from "./sign-in-container"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

function renderSignIn(auth = fakeAuth(null), returnTo = "/reservas/sesion/?id=s-1&reservar=1") {
  render(
    <BookingProvider
      brand={bylouBrand}
      runtime={{ status: "ready", repository: fakeRepository([]), clock: fixedClock("2026-10-14T15:00:00.000Z"), isDemo: true, auth }}
    >
      <SignInContainer returnTo={returnTo} />
    </BookingProvider>,
  )
  return auth
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  router.replace.mockClear()
})

describe("Sign in (email OTP)", () => {
  it("goes email → code (demo code on screen) → returnTo", async () => {
    const auth = fakeAuth(null)
    vi.spyOn(auth, "requestCode").mockResolvedValue({ ok: true, demoCode: "123456" })
    renderSignIn(auth)

    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: "alumna1@example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }))

    const codeInput = await screen.findByLabelText("Código de 6 dígitos")
    expect(codeInput.getAttribute("autocomplete")).toBe("one-time-code")
    expect(document.activeElement).toBe(codeInput)
    expect(screen.getByRole("note").textContent).toContain("Tu código es 123456")
    expect(screen.getByRole("button", { name: /Podés pedir otro código en 60 s/ })).toHaveProperty("disabled", true)

    fireEvent.change(codeInput, { target: { value: "12 34 56" } })
    expect((codeInput as HTMLInputElement).value).toBe("123456")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Entrar" })))
    expect(router.replace).toHaveBeenCalledWith("/reservas/sesion/?id=s-1&reservar=1")
  })

  it("shows a linked, announced error for a wrong code and keeps the user on the code step", async () => {
    const auth = fakeAuth(null)
    vi.spyOn(auth, "verifyCode").mockResolvedValue({ ok: false, code: "invalid_code" })
    renderSignIn(auth)
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: "alumna1@example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }))
    const codeInput = await screen.findByLabelText("Código de 6 dígitos")
    fireEvent.change(codeInput, { target: { value: "000000" } })
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("El código no es correcto o ya venció. Revisalo o pedí uno nuevo.")
    expect(codeInput.getAttribute("aria-invalid")).toBe("true")
    expect(codeInput.getAttribute("aria-describedby")).toContain(alert.id)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it("maps rate limiting on request to clear copy", async () => {
    const auth = fakeAuth(null)
    vi.spyOn(auth, "requestCode").mockResolvedValue({ ok: false, code: "rate_limited" })
    renderSignIn(auth)
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: "alumna1@example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Hiciste varios intentos seguidos.")
    expect(screen.getByLabelText("Tu mail")).toBeTruthy()
  })

  it("enables resend after the cooldown", async () => {
    vi.useFakeTimers()
    const auth = fakeAuth(null)
    const request = vi.spyOn(auth, "requestCode")
    renderSignIn(auth)
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: "alumna1@example.test" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" })))
    for (let i = 0; i < 60; i++) await act(async () => vi.advanceTimersByTime(1000))
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reenviar código" })))
    expect(request).toHaveBeenCalledTimes(2)
    expect(screen.getByText("Te mandamos un código nuevo.")).toBeTruthy()
  })

  it("redirects immediately when already signed in", () => {
    renderSignIn(fakeAuth(), "/reservas/mis-reservas/")
    expect(router.replace).toHaveBeenCalledWith("/reservas/mis-reservas/")
  })
})
