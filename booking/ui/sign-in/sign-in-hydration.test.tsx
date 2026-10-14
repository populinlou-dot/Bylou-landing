/**
 * Regression (browser QA, Phase 4.3): in `next dev` the sign-in form is server-rendered. The page's
 * Suspense boundary hydrates after the layout (its chunk loads later), and the auth session resolves
 * in between. An urgent auth-context update into the still-dehydrated boundary made React discard the
 * server HTML and client-render the form: new `useId` ids (hydration mismatch in the console) and the
 * email typed right after page load was wiped.
 */
import { act, cleanup } from "@testing-library/react"
import { Suspense, lazy, type AnchorHTMLAttributes, type ComponentType } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { bylouBrand } from "../../../brands/bylou"
import type { AuthPort, AuthUser } from "../../application"
import { fakeRepository, fixedClock } from "../../application/test-support"
import { BookingProvider } from "../booking-context"
import { BookingShell } from "../booking-shell"
import { SignInContainer } from "./sign-in-container"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

/** Auth whose session resolves when the test says so (Supabase emits INITIAL_SESSION asynchronously). */
function deferredAuth() {
  const listeners = new Set<(user: AuthUser | null) => void>()
  const auth: AuthPort = {
    getUser: async () => null,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    requestCode: async () => ({ ok: true }),
    verifyCode: async () => ({ ok: false, code: "invalid_code" }),
    signOut: async () => undefined,
  }
  return { auth, resolveSession: (user: AuthUser | null) => listeners.forEach((listener) => listener(user)) }
}

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  cleanup()
  vi.restoreAllMocks()
})

describe("Sign-in hydration", () => {
  it("keeps the server-rendered form (same node, same ids, typed email) when auth resolves mid-hydration", async () => {
    const { auth, resolveSession } = deferredAuth()
    const runtime = {
      status: "ready" as const,
      repository: fakeRepository([]),
      clock: fixedClock("2026-10-14T15:00:00.000Z"),
      isDemo: false,
      auth,
    }
    const Page = () => <SignInContainer returnTo="/reservas/" />
    const page = (Content: ComponentType) => (
      <BookingProvider brand={bylouBrand} runtime={runtime}>
        <BookingShell>
          <Suspense fallback={null}>
            <Content />
          </Suspense>
        </BookingShell>
      </BookingProvider>
    )

    const container = document.createElement("div")
    container.innerHTML = renderToString(page(Page))
    document.body.appendChild(container)
    const serverInput = container.querySelector<HTMLInputElement>("input[name=email]")
    const serverLabel = container.querySelector("label")
    expect(serverInput).not.toBeNull()
    expect(serverLabel?.htmlFor).toBe(serverInput?.id)

    // The page chunk arrives after the layout has hydrated.
    let loadPage!: (module: { default: ComponentType }) => void
    const LazyPage = lazy(() => new Promise<{ default: ComponentType }>((resolve) => (loadPage = resolve)))
    const recoverable: unknown[] = []
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => recoverable.push(args))
    await act(async () => {
      root = hydrateRoot(container, page(LazyPage), { onRecoverableError: (error) => recoverable.push(error) })
    })

    serverInput!.value = "early@example.test" // typed before React owns the input
    await act(async () => resolveSession(null))
    await act(async () => loadPage({ default: Page }))

    const input = container.querySelector<HTMLInputElement>("input[name=email]")
    expect(input).toBe(serverInput)
    expect(input?.id).toBe(serverLabel?.htmlFor)
    expect(container.querySelector("label")).toBe(serverLabel)
    expect(input?.value).toBe("early@example.test")
    expect(recoverable).toEqual([])
    consoleError.mockRestore()
  })
})
