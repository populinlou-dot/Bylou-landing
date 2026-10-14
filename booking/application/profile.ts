/**
 * Profile completion (ST-03 AC2, name only). Owner decision 2026-10-14: the display name is REQUIRED (the
 * sign-in email already identifies her; no phone). After sign-in, a student without a name gets the
 * "¿Cómo te llamamos?" step with no way to skip it; a signed-in student who still has none sees it inside
 * the confirm sheet before booking. The server enforces it (`book_session` / `join_waitlist` →
 * `profile_incomplete`). The name is user-provided text that staff see in rosters, so it is validated here
 * and rendered as plain text everywhere.
 */
import { RepositoryError, type BookingRepository, type UpdateProfileResult } from "./ports"

/** Same bounds as the `profiles.display_name` CHECK (char_length 1–80). */
export const DISPLAY_NAME_MAX = 80

export type DisplayNameError = "empty" | "too_long" | "invalid_chars"

export type DisplayNameValidation = { ok: true; value: string } | { ok: false; code: DisplayNameError }

/**
 * C0/C1 control characters plus the invisible bidi overrides/isolates and zero-width marks
 * that can disguise a name in the staff roster.
 */
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/

/**
 * A name made only of these is no name (whitespace, control, zero-width, BOM, Hangul fillers). Same character
 * set as `private.has_display_name` and the `profiles_display_name_visible` CHECK (migration 20261014001300).
 */
export const BLANK_NAME =
  /^[\s\u0000-\u001F\u007F-\u009F\u00A0\u115F\u1160\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\u3164\uFEFF\uFFA0]*$/u

/** True when the name has at least one visible character (the server rule for booking / joining a waitlist). */
export function hasVisibleName(name: string | null | undefined): boolean {
  return typeof name === "string" && !BLANK_NAME.test(name)
}

/** Trims, then requires 1–80 characters (code points, like Postgres `char_length`) and no control characters. */
export function validateDisplayName(raw: string): DisplayNameValidation {
  const value = raw.trim()
  if (!hasVisibleName(value)) return { ok: false, code: "empty" }
  if (FORBIDDEN_CHARS.test(value)) return { ok: false, code: "invalid_chars" }
  if (Array.from(value).length > DISPLAY_NAME_MAX) return { ok: false, code: "too_long" }
  return { ok: true, value }
}

export interface ProfileDeps {
  repository: BookingRepository
}

/**
 * True when the signed-in user has no display name yet. Any failure (signed out, network) answers false:
 * the step must never trap her on a broken page, and the server still refuses to book without a name
 * (`profile_incomplete`), which the confirm sheet answers with the same step.
 */
export async function needsDisplayName(deps: ProfileDeps): Promise<boolean> {
  try {
    const profile = await deps.repository.getMyProfile()
    return !hasVisibleName(profile.displayName)
  } catch (error) {
    if (!(error instanceof RepositoryError)) console.error("[booking] profile load failed", error)
    return false
  }
}

export type SaveDisplayNameResult = UpdateProfileResult | { ok: false; code: DisplayNameError }

/** Validates, then saves through the repository (RLS: own row, `display_name` column only). */
export async function saveDisplayName(deps: ProfileDeps, raw: string): Promise<SaveDisplayNameResult> {
  const validation = validateDisplayName(raw)
  if (!validation.ok) return validation
  try {
    return await deps.repository.updateMyDisplayName(validation.value)
  } catch (error) {
    return { ok: false, code: error instanceof RepositoryError ? error.code : "unknown" }
  }
}
