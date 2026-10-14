import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import { RepositoryError, type BookingRepository } from "../../application"
import { fakeAuth, fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { SignInContainer } from "./sign-in-container"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

function renderSignIn(
  auth = fakeAuth(null),
  returnTo = "/reservas/sesion/?id=s-1&reservar=1",
  repository: BookingRepository = fakeRepository([]),
) {
  render(
    <BookingProvider
      brand={bylouBrand}
      runtime={{ status: "ready", repository, clock: fixedClock("2026-10-14T15:00:00.000Z"), isDemo: true, auth }}
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

describe("Profile completion after the first sign-in (UX backlog #4)", () => {
  const RETURN_TO = "/reservas/sesion/?id=s-1&reservar=1"

  async function signInThroughCode(repository: BookingRepository) {
    renderSignIn(fakeAuth(null), RETURN_TO, repository)
    fireEvent.change(screen.getByLabelText("Tu mail"), { target: { value: "nueva@example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }))
    fireEvent.change(await screen.findByLabelText("Código de 6 dígitos"), { target: { value: "123456" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Entrar" })))
  }

  it("asks '¿Cómo te llamamos?' when the profile has no name, saves it, then continues", async () => {
    const repository = fakeRepository([], { displayName: null })
    const update = vi.spyOn(repository, "updateMyDisplayName")
    await signInThroughCode(repository)

    expect(await screen.findByRole("heading", { name: "¿Cómo te llamamos?" })).toBeTruthy()
    const input = screen.getByLabelText("Tu nombre")
    expect(document.activeElement).toBe(input)
    expect(router.replace).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "  Ana  " } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar" })))
    expect(update).toHaveBeenCalledWith("Ana")
    expect(router.replace).toHaveBeenCalledWith(RETURN_TO)
  })

  it("is skippable: 'Ahora no' continues without saving", async () => {
    const repository = fakeRepository([], { displayName: null })
    const update = vi.spyOn(repository, "updateMyDisplayName")
    await signInThroughCode(repository)
    fireEvent.click(await screen.findByRole("button", { name: "Ahora no" }))
    expect(router.replace).toHaveBeenCalledWith(RETURN_TO)
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ["   ", "Escribí tu nombre o tocá «Ahora no»."],
    ["a".repeat(81), "Usá hasta 80 caracteres."],
    ["Ana\u202e", "Hay caracteres que no podemos guardar. Probá solo con tu nombre."],
  ])("validates %j inline without calling the repository", async (value, message) => {
    const repository = fakeRepository([], { displayName: null })
    const update = vi.spyOn(repository, "updateMyDisplayName")
    await signInThroughCode(repository)
    const input = await screen.findByLabelText("Tu nombre")
    fireEvent.change(input, { target: { value: JSON.parse(`"${value}"`) } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar" })))

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toBe(message)
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toContain(alert.id)
    expect(update).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it("shows a retryable error when saving fails and still lets the student skip", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const repository = fakeRepository([], { displayName: null })
    vi.spyOn(repository, "updateMyDisplayName").mockResolvedValueOnce({ ok: false, code: "network_error" })
    await signInThroughCode(repository)
    fireEvent.change(await screen.findByLabelText("Tu nombre"), { target: { value: "Ana" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar" })))
    expect(screen.getByRole("alert").textContent).toContain("No pudimos guardar tu nombre.")
    fireEvent.click(screen.getByRole("button", { name: "Ahora no" }))
    expect(router.replace).toHaveBeenCalledWith(RETURN_TO)
  })

  it("skips the step when the student already has a name, or when the profile cannot be read", async () => {
    await signInThroughCode(fakeRepository([], { displayName: "Ana" }))
    expect(router.replace).toHaveBeenCalledWith(RETURN_TO)
    expect(screen.queryByRole("heading", { name: "¿Cómo te llamamos?" })).toBeNull()
    cleanup()
    router.replace.mockClear()

    const failing = fakeRepository([], { displayName: null })
    vi.spyOn(failing, "getMyProfile").mockRejectedValue(new RepositoryError("network_error"))
    await signInThroughCode(failing)
    expect(router.replace).toHaveBeenCalledWith(RETURN_TO)
  })

  it("does not ask again when the visitor was already signed in", async () => {
    const repository = fakeRepository([], { displayName: null })
    renderSignIn(fakeAuth(), RETURN_TO, repository)
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(RETURN_TO))
    expect(repository.calls).not.toContain("getMyProfile")
  })
})
