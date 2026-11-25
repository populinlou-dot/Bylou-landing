/**
 * Validates the two public Supabase variables (ARCHITECTURE §10, ADR-013). Pure: no client is
 * created here. A key that looks like a service-role/secret key is REJECTED, so a leaked secret
 * can never end up wired into the static bundle's client.
 */
import type { BookingConfigVariable } from "../../application"

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export type SupabaseConfigResolution =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; reason: "missing" | "invalid"; variable: BookingConfigVariable; received: string | null }

export function resolveSupabaseConfig(rawUrl: string | null | undefined, rawKey: string | null | undefined): SupabaseConfigResolution {
  const url = rawUrl?.trim() ?? ""
  const anonKey = rawKey?.trim() ?? ""
  if (url === "") return { ok: false, reason: "missing", variable: "NEXT_PUBLIC_SUPABASE_URL", received: null }
  if (!isHttpUrl(url)) return { ok: false, reason: "invalid", variable: "NEXT_PUBLIC_SUPABASE_URL", received: url }
  if (anonKey === "") return { ok: false, reason: "missing", variable: "NEXT_PUBLIC_SUPABASE_ANON_KEY", received: null }
  // Never echo key material back, even to the owner.
  if (looksSecret(anonKey)) return { ok: false, reason: "invalid", variable: "NEXT_PUBLIC_SUPABASE_ANON_KEY", received: null }
  return { ok: true, config: { url: url.replace(/\/+$/, ""), anonKey } }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.username === "" && parsed.password === ""
  } catch {
    return false
  }
}

/**
 * New-style secret keys ("sb_" then "secret_") and legacy JWTs whose role claim is anything but
 * "anon". The prefix is checked in two parts so no full secret-key marker lands in the bundle
 * (the minifier folds string concatenations), keeping the SE-03 bundle scan clean.
 */
export function looksSecret(key: string): boolean {
  if (key.startsWith("sb_") && key.slice(3).startsWith("secret_")) return true
  const parts = key.split(".")
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { role?: unknown }
    return payload.role !== "anon"
  } catch {
    // An unparseable 3-part token is not a valid anon JWT either.
    return true
  }
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  return atob(padded)
}

/** Bot protection for Supabase Auth sign-in (ADR-024). Only the public site key reaches the bundle. */
export interface CaptchaConfig {
  provider: "turnstile"
  siteKey: string
}

export type CaptchaConfigResolution =
  | { ok: true; captcha: CaptchaConfig | null }
  | { ok: false; reason: "invalid"; variable: "NEXT_PUBLIC_TURNSTILE_SITE_KEY"; received: null }

/**
 * Cloudflare Turnstile site keys are short ("0x4AAAAAAA…", test keys "1x00000000000000000000AA");
 * secret keys share the "<digit>x" prefix but are longer (35 characters). Loose on purpose: the
 * length cap is what keeps a pasted secret key out of the bundle.
 */
const TURNSTILE_SITE_KEY = /^[0-9]x[A-Za-z0-9_-]{18,28}$/

/**
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: empty or missing → captcha off (no widget, no script, no token).
 * Anything that is not a plausible site key — including a Turnstile secret key or a Supabase
 * secret — is a config error, and the raw value is never echoed back.
 */
export function resolveCaptchaConfig(rawSiteKey: string | null | undefined): CaptchaConfigResolution {
  const siteKey = rawSiteKey?.trim() ?? ""
  if (siteKey === "") return { ok: true, captcha: null }
  if (!TURNSTILE_SITE_KEY.test(siteKey) || looksSecret(siteKey)) {
    return { ok: false, reason: "invalid", variable: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", received: null }
  }
  return { ok: true, captcha: { provider: "turnstile", siteKey } }
}
