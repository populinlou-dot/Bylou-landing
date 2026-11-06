import type { BrandConfig } from "../theme/types"
import { COPY_KEYS, REQUIRED_PLACEHOLDERS } from "./copy"
import { validateStudioRules } from "./rules"
import { TERM_KEYS } from "./terminology"
import { type ValidationError, isNonEmptyString, isPlainObject } from "./validation"

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const FEATURE_KEYS = ["waitlist", "groupSessions", "showCatalogStep"] as const

/**
 * Runtime checks a TS type cannot give: empty strings, missing/unknown copy keys,
 * dropped placeholders, invalid rules, no contact channel. Returns [] when valid.
 */
export function validateBrandConfig(brand: BrandConfig): ValidationError[] {
  const errors: ValidationError[] = []
  const add = (path: string, message: string) => errors.push({ path, message })

  if (!SLUG.test(brand.id)) add("id", "must be a lowercase slug")
  if (!isNonEmptyString(brand.name)) add("name", "must be a non-empty string")
  if (!isNonEmptyString(brand.locale)) add("locale", "must be a non-empty string")
  if (typeof brand.domain !== "string" || !DOMAIN.test(brand.domain)) add("domain", "must be a lowercase DNS domain (no scheme)")
  if (!isNonEmptyString(brand.logo?.alt)) add("logo.alt", "must be a non-empty string")
  if (!isNonEmptyString(brand.logo?.wordmark)) add("logo.wordmark", "must be a non-empty string")
  if (!brand.contact?.instagramDm && !brand.contact?.email) add("contact", "needs at least one channel")

  for (const [role, value] of Object.entries(brand.theme?.palette ?? {})) {
    if (role === "decorative" && value === null) continue
    if (!isNonEmptyString(value)) add(`theme.palette.${role}`, "must be a CSS color")
  }
  for (const group of ["fonts", "radii", "shadows"] as const) {
    for (const [key, value] of Object.entries(brand.theme?.[group] ?? {})) {
      if (typeof value === "string" && !isNonEmptyString(value)) add(`theme.${group}.${key}`, "must not be empty")
    }
  }

  for (const key of TERM_KEYS) {
    const term = brand.terminology?.[key]
    if (!term || !isNonEmptyString(term.singular) || !isNonEmptyString(term.plural)) {
      add(`terminology.${key}`, "needs singular and plural")
    }
  }
  if (!isNonEmptyString(brand.terminology?.location?.online)) add("terminology.location.online", "must not be empty")
  if (!isNonEmptyString(brand.terminology?.location?.inPerson)) add("terminology.location.inPerson", "must not be empty")

  const copy: Record<string, unknown> = isPlainObject(brand.copy) ? brand.copy : {}
  for (const key of COPY_KEYS) {
    const message = copy[key]
    if (!isNonEmptyString(message)) {
      add(`copy.${key}`, "missing message")
      continue
    }
    for (const placeholder of REQUIRED_PLACEHOLDERS[key] ?? []) {
      if (!message.includes(`{${placeholder}}`)) add(`copy.${key}`, `must keep placeholder {${placeholder}}`)
    }
  }
  const known = new Set<string>(COPY_KEYS)
  for (const key of Object.keys(copy)) {
    if (!known.has(key)) add(`copy.${key}`, "unknown message id")
  }

  errors.push(...validateStudioRules(brand.rules))

  for (const key of FEATURE_KEYS) {
    if (typeof brand.features?.[key] !== "boolean") add(`features.${key}`, "must be a boolean")
  }

  return errors
}
