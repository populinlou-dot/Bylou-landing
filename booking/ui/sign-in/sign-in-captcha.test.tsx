import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { demoStudioBrand } from "../../../brands/demo-studio"
import type { AuthPort } from "../../application"
import { fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import type { BrandConfig } from "../../theme"
import { BookingProvider, type CaptchaConfig } from "../booking-context"
import { SignInContainer } from "./sign-in-container"
import { TURNSTILE_SCRIPT_SRC, resetTurnstileLoader, turnstileLanguage, type TurnstileApi, type TurnstileRenderOptions } from "./turnstile"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

const CAPTCHA: CaptchaConfig = { provider: "turnstile", siteKey: "1x00000000000000000000AA" }
const EMAIL = "alumna1@example.test"

/** Stub of the Cloudflare global: records the render options so tests can fire its callbacks. */
function stubTurnstile() {
  let options: TurnstileRenderOptions | null = null
  const api = {
    render: vi.fn((_el: HTMLElement, opts: TurnstileRenderOptions) => {
      options = opts
      return "widget-1"
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  } satisfies TurnstileApi
  window.turnstile = api
  const current = () => {
    if (!options) throw new Error("widget not rendered")
    return options
  }
  return {
    api,
    current,
    solve: (token: string) => act(() => current().callback(token)),
    expire: () => act(() => current()["expired-callback"]()),
    fail: () => act(() => void current()["error-callback"]("300010")),
  }
}

function renderSignIn(auth: AuthPort, captcha: CaptchaConfig | null = CAPTCHA, brand: BrandConfig = bylouBrand) {
  render(
    <BookingProvider
      brand={brand}
      captcha={captcha}
      runtime={{ status: "ready", repository: fakeRepository([]), clock: fixedClock("2026-10-14T15:00:00.000Z"), isDemo: false, auth }}
    >
      <SignInContainer returnTo="/reservas/" />
    </BookingProvider>,
  )
}

const sendButton = () => screen.getByRole("button", { name: "Enviarme el código" }) as HTMLButtonElement
const turnstileScripts = () => document.head.querySelectorAll("script[data-booking-turnstile]")

beforeEach(() => {
  resetTurnstileLoader()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete window.turnstile
  for (const script of turnstileScripts()) script.remove()
  router.replace.mockClear()
})

describe("Sign-in captcha (Cloudflare Turnstile, ADR-024)", () => {
  it("without a site key: no widget, no script, no token, submit enabled", async () => {
    const auth = fakeAuth(null)
    const request = vi.spyOn(auth, "requestCode")
    renderSignIn(auth, null)
    expect(turnstileScripts()).toHaveLength(0)
    expect(document.querySelector("[data-booking-captcha]")).toBeNull()
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: EMAIL } })
    expect(sendButton().disabled).toBe(false)
    await act(async () => fireEvent.click(sendButton()))
    expect(request).toHaveBeenCalledWith(EMAIL, undefined)
  })

  it("renders the widget explicitly in the brand language and keeps submit disabled until a token exists", async () => {
    const turnstile = stubTurnstile()
    const auth = fakeAuth(null)
    const request = vi.spyOn(auth, "requestCode")
    renderSignIn(auth)
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1))
    expect(turnstile.current()).toMatchObject({
      sitekey: CAPTCHA.siteKey,
      language: "es",
      theme: "light",
      appearance: "interaction-only",
      "response-field": false,
    })

    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: EMAIL } })
    expect(sendButton().disabled).toBe(true)
    expect(screen.getByText("Un momento: estamos haciendo una verificación de seguridad.")).toBeTruthy()
    // Enter in the field does not bypass the disabled button.
    fireEvent.submit(sendButton().closest("form")!)
    expect(request).not.toHaveBeenCalled()

    await turnstile.solve("token-1")
    expect(sendButton().disabled).toBe(false)
    expect(screen.queryByText("Un momento: estamos haciendo una verificación de seguridad.")).toBeNull()
  })

  it("sends the token with the code request, resets after send and after resend, and never sends one to verify", async () => {
    vi.useFakeTimers()
    const turnstile = stubTurnstile()
    const auth = fakeAuth(null)
    const request = vi.spyOn(auth, "requestCode")
    const verify = vi.spyOn(auth, "verifyCode")
    renderSignIn(auth)
    await act(async () => {})
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: EMAIL } })
    await turnstile.solve("token-1")
    await act(async () => fireEvent.click(sendButton()))

    expect(request).toHaveBeenLastCalledWith(EMAIL, { captchaToken: "token-1" })
    expect(turnstile.api.reset).toHaveBeenCalledTimes(1)
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1")
    // Same widget on the code step (not remounted): it serves "Reenviar código".
    expect(turnstile.api.render).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 60; i++) await act(async () => vi.advanceTimersByTime(1000))
    const resend = screen.getByRole("button", { name: "Reenviar código" }) as HTMLButtonElement
    expect(resend.disabled).toBe(true) // the spent token was dropped; waiting for a fresh one
    await turnstile.solve("token-2")
    expect(resend.disabled).toBe(false)
    await act(async () => fireEvent.click(resend))
    expect(request).toHaveBeenLastCalledWith(EMAIL, { captchaToken: "token-2" })
    expect(turnstile.api.reset).toHaveBeenCalledTimes(2)

    // Verifying needs no token: "Entrar" works even while the widget is fetching a new one.
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } })
    expect((screen.getByRole("button", { name: "Entrar" }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Entrar" })))
    expect(verify).toHaveBeenCalledWith(EMAIL, "123456")
    expect(verify.mock.calls[0]).toHaveLength(2)
  })

  it("resets after a failed request too (the token is spent) and shows the captcha_failed copy", async () => {
    const turnstile = stubTurnstile()
    const auth = fakeAuth(null)
    vi.spyOn(auth, "requestCode").mockResolvedValue({ ok: false, code: "captcha_failed" })
    renderSignIn(auth)
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: EMAIL } })
    await turnstile.solve("token-1")
    await act(async () => fireEvent.click(sendButton()))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos confirmar la verificación de seguridad. Esperá a que se complete y probá de nuevo.",
    )
    expect(turnstile.api.reset).toHaveBeenCalledTimes(1)
    expect(sendButton().disabled).toBe(true)
  })

  it("drops the token and resets the widget when it expires", async () => {
    const turnstile = stubTurnstile()
    renderSignIn(fakeAuth(null))
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled())
    await turnstile.solve("token-1")
    expect(sendButton().disabled).toBe(false)
    await turnstile.expire()
    expect(sendButton().disabled).toBe(true)
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1")
  })

  it("shows an inline message with a retry when the challenge errors, and retry resets the widget", async () => {
    const turnstile = stubTurnstile()
    renderSignIn(fakeAuth(null))
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled())
    expect(turnstile.current()["error-callback"]("300010")).toBe(true) // handled: Turnstile logs nothing
    await turnstile.fail()
    expect(screen.getByRole("alert").textContent).toContain("No pudimos cargar la verificación de seguridad.")
    expect(sendButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Reintentar verificación" }))
    expect(turnstile.api.reset).toHaveBeenCalledWith("widget-1")
    expect(screen.queryByRole("alert")).toBeNull()
    await turnstile.solve("token-1")
    expect(sendButton().disabled).toBe(false)
  })

  it("loads the explicit-render script only when mounted, and offers a retry when it fails to load (offline/blocked)", async () => {
    renderSignIn(fakeAuth(null))
    await waitFor(() => expect(turnstileScripts()).toHaveLength(1))
    const script = turnstileScripts()[0] as HTMLScriptElement
    expect(script.src).toBe(TURNSTILE_SCRIPT_SRC)
    expect(script.src).toContain("render=explicit")

    await act(async () => script.dispatchEvent(new Event("error")))
    expect((await screen.findByRole("alert")).textContent).toContain("No pudimos cargar la verificación de seguridad.")
    expect(turnstileScripts()).toHaveLength(0)
    expect(sendButton().disabled).toBe(true)

    // Retry requests the script again; this time it loads.
    const turnstile = stubTurnstile()
    delete window.turnstile
    fireEvent.click(screen.getByRole("button", { name: "Reintentar verificación" }))
    await waitFor(() => expect(turnstileScripts()).toHaveLength(1))
    window.turnstile = turnstile.api
    await act(async () => turnstileScripts()[0].dispatchEvent(new Event("load")))
    expect(turnstile.api.render).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("removes the widget when the sign-in screen unmounts", async () => {
    const turnstile = stubTurnstile()
    renderSignIn(fakeAuth(null))
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled())
    cleanup()
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1")
  })

  it("uses the demo-studio copy and language for the other brand", async () => {
    const turnstile = stubTurnstile()
    renderSignIn(fakeAuth(null), CAPTCHA, demoStudioBrand)
    await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled())
    expect(turnstile.current().language).toBe("es")
    expect(screen.getByText("Un momento: estamos realizando una verificación de seguridad.")).toBeTruthy()
  })
})

describe("turnstileLanguage", () => {
  it.each([
    ["es-AR", "es"],
    ["es", "es"],
    ["pt_BR", "pt"],
    ["", "auto"],
    ["x-klingon", "auto"],
  ])("%j → %j", (locale, expected) => {
    expect(turnstileLanguage(locale)).toBe(expected)
  })
})
