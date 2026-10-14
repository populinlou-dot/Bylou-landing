/**
 * `returnTo` open-redirect guard (ARCHITECTURE §6.5): only same-origin paths under
 * /reservas/ are accepted. Anything else falls back to the agenda.
 */
export const AGENDA_PATH = "/reservas/"
export const SIGN_IN_PATH = "/reservas/ingresar/"
export const MY_BOOKINGS_PATH = "/reservas/mis-reservas/"

const MAX_LENGTH = 512
const PROBE_ORIGIN = "https://return-to.invalid"
// Control characters and backslashes: browsers normalise "\" to "/", which enables "/\evil.com".
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/

export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return AGENDA_PATH
  if (FORBIDDEN.test(raw) || !raw.startsWith(AGENDA_PATH) || raw.startsWith("//")) return AGENDA_PATH
  let url: URL
  try {
    url = new URL(raw, PROBE_ORIGIN)
  } catch {
    return AGENDA_PATH
  }
  // URL() resolves "/reservas/../x" to "/x"; re-check after normalisation.
  if (url.origin !== PROBE_ORIGIN || !url.pathname.startsWith(AGENDA_PATH)) return AGENDA_PATH
  // Never bounce back to the sign-in page itself.
  if (url.pathname === SIGN_IN_PATH || url.pathname === SIGN_IN_PATH.slice(0, -1)) return AGENDA_PATH
  return `${url.pathname}${url.search}`
}

/** Sign-in link that brings the user back to `returnTo` (sanitised again on arrival). */
export function signInHref(returnTo: string): string {
  return `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(sanitizeReturnTo(returnTo))}`
}

/** Session detail URL; `reservar=1` re-opens the confirm sheet after sign-in (intent preserved). */
export function sessionHref(sessionId: string, reopenSheet = false): string {
  const query = new URLSearchParams({ id: sessionId })
  if (reopenSheet) query.set("reservar", "1")
  return `/reservas/sesion/?${query.toString()}`
}
