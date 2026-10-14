import type { StudioRules } from "../domain"
import { type ValidationError, isPlainObject } from "./validation"

/** ADR-011 provisional defaults (Proposed — owner to confirm). */
export const DEFAULT_STUDIO_RULES: StudioRules = {
  timezone: "America/Argentina/Buenos_Aires",
  bookingWindow: { opensDaysBefore: 30, closesMinutesBefore: 0 },
  cancellationWindowHours: 24,
  lateCancelPolicy: "allow_without_refund",
  creditsPerBooking: 1,
}

const LATE_CANCEL_POLICIES = ["allow_without_refund", "deny"]

/** Validates untrusted rules (e.g. edited in admin settings). Returns [] when valid. */
export function validateStudioRules(input: unknown, path = "rules"): ValidationError[] {
  if (!isPlainObject(input)) return [{ path, message: "must be an object" }]
  const errors: ValidationError[] = []

  if (typeof input.timezone !== "string" || !isValidTimeZone(input.timezone)) {
    errors.push({ path: `${path}.timezone`, message: "must be a valid IANA timezone" })
  }

  const window = input.bookingWindow
  if (!isPlainObject(window)) {
    errors.push({ path: `${path}.bookingWindow`, message: "must be an object" })
  } else {
    checkInteger(errors, `${path}.bookingWindow.opensDaysBefore`, window.opensDaysBefore, 1)
    checkInteger(errors, `${path}.bookingWindow.closesMinutesBefore`, window.closesMinutesBefore, 0)
    if (
      Number.isInteger(window.opensDaysBefore) &&
      Number.isInteger(window.closesMinutesBefore) &&
      (window.closesMinutesBefore as number) >= (window.opensDaysBefore as number) * 24 * 60
    ) {
      errors.push({ path: `${path}.bookingWindow`, message: "booking must close after it opens" })
    }
  }

  checkInteger(errors, `${path}.cancellationWindowHours`, input.cancellationWindowHours, 0)
  checkInteger(errors, `${path}.creditsPerBooking`, input.creditsPerBooking, 1)

  if (typeof input.lateCancelPolicy !== "string" || !LATE_CANCEL_POLICIES.includes(input.lateCancelPolicy)) {
    errors.push({ path: `${path}.lateCancelPolicy`, message: `must be one of ${LATE_CANCEL_POLICIES.join(", ")}` })
  }

  return errors
}

function checkInteger(errors: ValidationError[], path: string, value: unknown, min: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    errors.push({ path, message: `must be an integer >= ${min}` })
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}
