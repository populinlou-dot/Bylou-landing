import { describe, expect, it } from "vitest"
import { adminDayHref, adminNewSessionHref, adminSessionHref, sanitizeReturnTo, sessionHref, signInHref } from "./return-to"

describe("sanitizeReturnTo (open-redirect guard)", () => {
  it.each([
    ["/reservas/", "/reservas/"],
    ["/reservas/mis-reservas/", "/reservas/mis-reservas/"],
    ["/reservas/sesion/?id=abc&reservar=1", "/reservas/sesion/?id=abc&reservar=1"],
    ["/admin/", "/admin/"],
    ["/admin/?dia=2026-10-14", "/admin/?dia=2026-10-14"],
    ["/admin/clase/?id=abc", "/admin/clase/?id=abc"],
  ])("keeps %s", (raw, expected) => {
    expect(sanitizeReturnTo(raw)).toBe(expected)
  })

  it.each([
    null,
    undefined,
    42,
    "",
    "https://evil.example/reservas/",
    "//evil.example/reservas/",
    "/\\evil.example",
    "/reservas/\\..\\..\\evil",
    "javascript:alert(1)",
    "/admin",
    "/administrator/",
    "/admin/../reservas/",
    "/admin/../evil/",
    "//admin/",
    "/",
    "/reservasx/",
    "/reservas/../admin/",
    "/reservas/%2e%2e/admin/",
    "/reservas/\n/x",
    "/reservas/ingresar/",
    "/reservas/ingresar/?returnTo=/reservas/",
    `/reservas/${"a".repeat(600)}`,
  ])("falls back to the agenda for %j", (raw) => {
    expect(sanitizeReturnTo(raw)).toBe("/reservas/")
  })

  it("builds admin links with encoded query params", () => {
    expect(adminDayHref()).toBe("/admin/")
    expect(adminDayHref("2026-10-15")).toBe("/admin/?dia=2026-10-15")
    expect(adminSessionHref("a b&c")).toBe("/admin/clase/?id=a+b%26c")
    expect(adminNewSessionHref("2026-10-15")).toBe("/admin/nueva-clase/?dia=2026-10-15")
    expect(adminNewSessionHref(null)).toBe("/admin/nueva-clase/")
    expect(sanitizeReturnTo("/admin/nueva-clase/?dia=2026-10-15")).toBe("/admin/nueva-clase/?dia=2026-10-15")
    expect(signInHref("/admin/")).toBe(`/reservas/ingresar/?returnTo=${encodeURIComponent("/admin/")}`)
  })

  it("builds a sign-in link that round-trips the intent", () => {
    const href = signInHref(sessionHref("s-1", true))
    expect(href).toBe(`/reservas/ingresar/?returnTo=${encodeURIComponent("/reservas/sesion/?id=s-1&reservar=1")}`)
    const returnTo = new URL(href, "https://x.test").searchParams.get("returnTo")
    expect(sanitizeReturnTo(returnTo)).toBe("/reservas/sesion/?id=s-1&reservar=1")
  })
})
