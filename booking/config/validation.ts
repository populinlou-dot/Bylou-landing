export interface ValidationError {
  /** Dotted path to the offending field, e.g. "rules.bookingWindow.opensDaysBefore". */
  path: string
  /** Developer-facing message (English). Not shown to students. */
  message: string
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
