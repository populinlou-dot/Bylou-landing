import { describe, expect, it, vi } from "vitest"
import { RepositoryError } from "./ports"
import { DISPLAY_NAME_MAX, needsDisplayName, saveDisplayName, validateDisplayName } from "./profile"
import { fakeRepository } from "./test-support"

describe("validateDisplayName", () => {
  it("trims and accepts 1–80 characters, counting code points like Postgres", () => {
    expect(validateDisplayName("  Ana María ")).toEqual({ ok: true, value: "Ana María" })
    expect(validateDisplayName("a".repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true })
    expect(validateDisplayName("🌿".repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true })
  })

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["a".repeat(DISPLAY_NAME_MAX + 1), "too_long"],
    ["Ana\nMaría", "invalid_chars"],
    ["Ana\u0000", "invalid_chars"],
    ["Ana\u007f", "invalid_chars"],
    ["Ana‮airáM", "invalid_chars"],
    ["Ana​", "invalid_chars"],
  ])("rejects %j as %s", (raw, code) => {
    expect(validateDisplayName(raw)).toEqual({ ok: false, code })
  })
})

describe("needsDisplayName", () => {
  it("is true for a missing or blank name and false when there is one", async () => {
    expect(await needsDisplayName({ repository: fakeRepository([], { displayName: null }) })).toBe(true)
    expect(await needsDisplayName({ repository: fakeRepository([], { displayName: "  " }) })).toBe(true)
    expect(await needsDisplayName({ repository: fakeRepository([], { displayName: "Ana" }) })).toBe(false)
  })

  it("never blocks sign-in: a failed read answers false", async () => {
    const repository = fakeRepository([])
    vi.spyOn(repository, "getMyProfile").mockRejectedValue(new RepositoryError("network_error"))
    expect(await needsDisplayName({ repository })).toBe(false)
  })
})

describe("saveDisplayName", () => {
  it("saves the trimmed name", async () => {
    const repository = fakeRepository([])
    expect(await saveDisplayName({ repository }, "  Ana ")).toEqual({ ok: true, displayName: "Ana" })
    expect(repository.calls).toContain("updateMyDisplayName Ana")
  })

  it("does not call the repository for an invalid name", async () => {
    const repository = fakeRepository([])
    expect(await saveDisplayName({ repository }, " ")).toEqual({ ok: false, code: "empty" })
    expect(repository.calls.some((call) => call.startsWith("updateMyDisplayName"))).toBe(false)
  })

  it("maps adapter refusals and thrown errors to codes", async () => {
    const repository = fakeRepository([])
    vi.spyOn(repository, "updateMyDisplayName")
      .mockResolvedValueOnce({ ok: false, code: "forbidden" })
      .mockRejectedValueOnce(new RepositoryError("network_error"))
      .mockRejectedValueOnce(new Error("boom"))
    expect(await saveDisplayName({ repository }, "Ana")).toEqual({ ok: false, code: "forbidden" })
    expect(await saveDisplayName({ repository }, "Ana")).toEqual({ ok: false, code: "network_error" })
    expect(await saveDisplayName({ repository }, "Ana")).toEqual({ ok: false, code: "unknown" })
  })
})
