import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * ADR-007 / ARCHITECTURE §2 import boundaries, enforced by scanning import specifiers
 * (ESLint is broken in this repo, ADR-012).
 *
 * - booking/domain: pure TS, imports nothing outside itself.
 * - booking/application: imports only booking/domain and its own files.
 * - booking/ui and booking/admin: never import brands/*, booking/infrastructure or @supabase/*.
 *   The brand and adapters arrive through props/context from the composition roots
 *   (app/reservas/**, app/admin/**, app/_booking). UI test files may import a brand as a fixture.
 * Test files (*.test.ts[x]) may also import the test runner / testing library.
 */
const BOOKING_DIR = fileURLToPath(new URL(".", import.meta.url))
const ROOT_DIR = resolve(BOOKING_DIR, "..")
const DOMAIN_DIR = join(BOOKING_DIR, "domain")
const APPLICATION_DIR = join(BOOKING_DIR, "application")
const UI_DIR = join(BOOKING_DIR, "ui")
const ADMIN_DIR = join(BOOKING_DIR, "admin")
const BRANDS_DIR = join(ROOT_DIR, "brands")
const INFRASTRUCTURE_DIR = join(BOOKING_DIR, "infrastructure")

const TEST_ONLY_PACKAGES = ["vitest", "@testing-library/"]

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g, // import x from "y" / export { x } from "y"
  /\bimport\s*["']([^"']+)["']/g, // side-effect import "y"
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("y")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("y")
]

function importSpecifiers(source: string): string[] {
  return IMPORT_PATTERNS.flatMap((pattern) => Array.from(source.matchAll(pattern), (m) => m[1]))
}

/** Absolute path for relative and "@/" specifiers; null for packages. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return resolve(dirname(fromFile), specifier)
  if (specifier.startsWith("@/")) return resolve(ROOT_DIR, specifier.slice(2))
  return null
}

const isInside = (target: string | null, dir: string) => target !== null && (target === dir || target.startsWith(dir + sep))
const isTestFile = (file: string) => /\.test\.tsx?$/.test(file)
const isTestPackage = (specifier: string) => TEST_ONLY_PACKAGES.some((p) => specifier === p || specifier.startsWith(p))

type Rule = (file: string, specifier: string) => boolean // true = allowed

/** Allow-list: only the given directories (plus test packages in tests). */
const onlyInside =
  (...dirs: string[]): Rule =>
  (file, specifier) => {
    if (isTestFile(file) && isTestPackage(specifier)) return true
    const target = resolveSpecifier(file, specifier)
    return dirs.some((dir) => isInside(target, dir))
  }

/** Deny-list for the UI layer. */
const uiRule: Rule = (file, specifier) => {
  const target = resolveSpecifier(file, specifier)
  if (specifier.startsWith("@supabase/")) return false
  if (isInside(target, INFRASTRUCTURE_DIR)) return false
  if (isInside(target, BRANDS_DIR)) return isTestFile(file)
  return true
}

const LAYERS = [
  { name: "booking/domain", dir: DOMAIN_DIR, rule: onlyInside(DOMAIN_DIR), minFiles: 6 },
  { name: "booking/application", dir: APPLICATION_DIR, rule: onlyInside(DOMAIN_DIR, APPLICATION_DIR), minFiles: 3 },
  { name: "booking/ui", dir: UI_DIR, rule: uiRule, minFiles: 5 },
  { name: "booking/admin", dir: ADMIN_DIR, rule: uiRule, minFiles: 5 },
]

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function violations(rule: Rule, baseDir: string, file: string, source: string): string[] {
  return importSpecifiers(source)
    .filter((spec) => !rule(file, spec))
    .map((spec) => `${relative(baseDir, file)} -> ${spec}`)
}

describe.each(LAYERS)("$name boundary", ({ dir, rule, minFiles }) => {
  it("has source files to scan", () => {
    expect(listTsFiles(dir).length).toBeGreaterThanOrEqual(minFiles)
  })

  it("respects its import rule", () => {
    const found = listTsFiles(dir).flatMap((file) => violations(rule, dir, file, readFileSync(file, "utf8")))
    expect(found).toEqual([])
  })
})

/**
 * Phase 3: the Supabase SDK is an infrastructure detail. Only booking/infrastructure/supabase
 * may import it; booking/ui, application, domain and the app/ composition root never do.
 */
describe("@supabase/* confinement", () => {
  const SUPABASE_ADAPTER_DIR = join(INFRASTRUCTURE_DIR, "supabase")
  const APP_DIR = join(ROOT_DIR, "app")
  const SELF = fileURLToPath(import.meta.url) // its self-check fixtures mention @supabase on purpose
  const scanned = [BOOKING_DIR, BRANDS_DIR, APP_DIR].flatMap(listTsFiles).filter((file) => file !== SELF)

  it("scans the adapter, the UI and the admin UI", () => {
    expect(scanned.some((file) => isInside(file, SUPABASE_ADAPTER_DIR))).toBe(true)
    expect(scanned.some((file) => isInside(file, UI_DIR))).toBe(true)
    expect(scanned.some((file) => isInside(file, ADMIN_DIR))).toBe(true)
  })

  it("imports @supabase/* only from booking/infrastructure/supabase", () => {
    const offenders = scanned.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"))
        .filter((spec) => spec.startsWith("@supabase/") && !isInside(file, SUPABASE_ADAPTER_DIR))
        .map((spec) => `${relative(ROOT_DIR, file)} -> ${spec}`),
    )
    expect(offenders).toEqual([])
  })

  it("never references a privileged key in shipped source", () => {
    const privileged = new RegExp(["service", "role"].join("_"), "i")
    const offenders = scanned
      .filter((file) => !isTestFile(file))
      .filter((file) => privileged.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT_DIR, file))
    expect(offenders).toEqual([])
  })
})

describe("boundary scanner self-checks", () => {
  const domainRule = LAYERS[0].rule
  const applicationRule = LAYERS[1].rule

  it("detects forbidden domain imports", () => {
    const file = join(DOMAIN_DIR, "fake.ts")
    const source = [
      'import { useState } from "react"',
      'import type { BrandConfig } from "../theme/types"',
      'export { x } from "@supabase/supabase-js"',
      'import "next/headers"',
      'const m = await import("../../brands/bylou")',
      'const r = require("../ui/thing")',
      'import { ok } from "./types"',
      'import { ok2 } from "../domain/codes"',
    ].join("\n")
    expect(violations(domainRule, DOMAIN_DIR, file, source)).toEqual([
      "fake.ts -> react",
      "fake.ts -> ../theme/types",
      "fake.ts -> @supabase/supabase-js",
      "fake.ts -> next/headers",
      "fake.ts -> ../../brands/bylou",
      "fake.ts -> ../ui/thing",
    ])
  })

  it("rejects vitest outside test files", () => {
    expect(violations(domainRule, DOMAIN_DIR, join(DOMAIN_DIR, "policy.ts"), 'import { it } from "vitest"')).toEqual([
      "policy.ts -> vitest",
    ])
    expect(violations(domainRule, DOMAIN_DIR, join(DOMAIN_DIR, "policy.test.ts"), 'import { it } from "vitest"')).toEqual([])
  })

  it("lets application import only domain and itself", () => {
    const file = join(APPLICATION_DIR, "fake.ts")
    const source = [
      'import { evaluateBooking } from "../domain"',
      'import type { Clock } from "./ports"',
      'import { DEFAULT_STUDIO_RULES } from "../config"',
      'import { MockBookingRepository } from "../infrastructure/mock"',
      'import { bylouBrand } from "@/brands/bylou"',
      'import { useState } from "react"',
    ].join("\n")
    expect(violations(applicationRule, APPLICATION_DIR, file, source)).toEqual([
      "fake.ts -> ../config",
      "fake.ts -> ../infrastructure/mock",
      "fake.ts -> @/brands/bylou",
      "fake.ts -> react",
    ])
  })

  it("keeps brands, infrastructure and supabase out of the UI (brands allowed only as test fixtures)", () => {
    const source = [
      'import { useState } from "react"',
      'import Link from "next/link"',
      'import { getAgenda } from "../application"',
      'import { themeToCssVars } from "../theme"',
      'import { bylouBrand } from "../../brands/bylou"',
      'import { resolveBrand } from "@/brands"',
      'import { createBookingRuntime } from "../infrastructure/data-source"',
      'import { createClient } from "@supabase/supabase-js"',
    ].join("\n")
    expect(violations(uiRule, UI_DIR, join(UI_DIR, "fake.tsx"), source)).toEqual([
      "fake.tsx -> ../../brands/bylou",
      "fake.tsx -> @/brands",
      "fake.tsx -> ../infrastructure/data-source",
      "fake.tsx -> @supabase/supabase-js",
    ])
    expect(violations(uiRule, UI_DIR, join(UI_DIR, "fake.test.tsx"), source)).toEqual([
      "fake.test.tsx -> ../infrastructure/data-source",
      "fake.test.tsx -> @supabase/supabase-js",
    ])
  })

  it("applies the same rule to booking/admin (it may reuse booking/ui)", () => {
    const adminRule = LAYERS[3].rule
    const source = [
      'import { useCopy } from "../../ui/booking-context"',
      'import { getAdminDay } from "../../application"',
      'import { MockAdminRepository } from "../../infrastructure/mock"',
      'import { SupabaseAdminRepository } from "@/booking/infrastructure/supabase"',
      'import { bylouBrand } from "@/brands/bylou"',
      'import type { SupabaseClient } from "@supabase/supabase-js"',
    ].join("\n")
    expect(violations(adminRule, ADMIN_DIR, join(ADMIN_DIR, "day", "fake.tsx"), source)).toEqual([
      "day/fake.tsx -> ../../infrastructure/mock",
      "day/fake.tsx -> @/booking/infrastructure/supabase",
      "day/fake.tsx -> @/brands/bylou",
      "day/fake.tsx -> @supabase/supabase-js",
    ])
  })
})
