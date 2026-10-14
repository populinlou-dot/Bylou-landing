/**
 * `returnTo` open-redirect guard (ARCHITECTURE §6.5): only same-origin paths under
 * /reservas/ or /admin/ are accepted. Anything else falls back to the agenda.
 */
export const AGENDA_PATH = "/reservas/"
export const SIGN_IN_PATH = "/reservas/ingresar/"
export const MY_BOOKINGS_PATH = "/reservas/mis-reservas/"
export const ADMIN_PATH = "/admin/"
export const ADMIN_SESSION_PATH = "/admin/clase/"
export const ADMIN_NEW_SESSION_PATH = "/admin/nueva-clase/"
export const ADMIN_CLASS_TYPES_PATH = "/admin/practicas/"

/** Sections a sign-in may return to. The admin shell is public; RLS/RPC protect its data (ADR-003). */
const RETURN_PREFIXES = [AGENDA_PATH, ADMIN_PATH] as const

const MAX_LENGTH = 512
const PROBE_ORIGIN = "https://return-to.invalid"
// Control characters and backslashes: browsers normalise "\" to "/", which enables "/\evil.com".
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/

export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return AGENDA_PATH
  const prefix = RETURN_PREFIXES.find((p) => raw.startsWith(p))
  if (FORBIDDEN.test(raw) || !prefix || raw.startsWith("//")) return AGENDA_PATH
  let url: URL
  try {
    url = new URL(raw, PROBE_ORIGIN)
  } catch {
    return AGENDA_PATH
  }
  // URL() resolves "/reservas/../x" to "/x"; re-check after normalisation (same section only).
  if (url.origin !== PROBE_ORIGIN || !url.pathname.startsWith(prefix)) return AGENDA_PATH
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

/** Admin "Hoy" for a studio-local day; no `dia` = today. */
export function adminDayHref(date?: string | null): string {
  return date ? `${ADMIN_PATH}?${new URLSearchParams({ dia: date }).toString()}` : ADMIN_PATH
}

/** Admin roster + attendance of one session (`/admin/clase/?id=`). */
export function adminSessionHref(sessionId: string): string {
  return `${ADMIN_SESSION_PATH}?${new URLSearchParams({ id: sessionId }).toString()}`
}

/** New session form (`/admin/nueva-clase/?dia=`), prefilled with a studio-local day. */
export function adminNewSessionHref(date?: string | null): string {
  return date ? `${ADMIN_NEW_SESSION_PATH}?${new URLSearchParams({ dia: date }).toString()}` : ADMIN_NEW_SESSION_PATH
}
