/**
 * Profile completion (ST-03 AC2, name only): after sign-in, a student without a display name is
 * offered an optional "¿Cómo te llamamos?" step. The name is user-provided text that staff see in
 * rosters, so it is validated here and rendered as plain text everywhere.
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

/** Trims, then requires 1–80 characters (code points, like Postgres `char_length`) and no control characters. */
export function validateDisplayName(raw: string): DisplayNameValidation {
  const value = raw.trim()
  if (value === "") return { ok: false, code: "empty" }
  if (FORBIDDEN_CHARS.test(value)) return { ok: false, code: "invalid_chars" }
  if (Array.from(value).length > DISPLAY_NAME_MAX) return { ok: false, code: "too_long" }
  return { ok: true, value }
}

export interface ProfileDeps {
  repository: BookingRepository
}

/**
 * True when the signed-in user has no display name yet. The step is optional, so any failure
 * (signed out, network) answers false: it must never block the way back to the booking.
 */
export async function needsDisplayName(deps: ProfileDeps): Promise<boolean> {
  try {
    const profile = await deps.repository.getMyProfile()
    return !profile.displayName?.trim()
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
