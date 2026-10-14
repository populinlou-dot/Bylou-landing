import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * ADR-007: booking/domain is pure TS and imports nothing outside itself
 * (no react, next, @supabase, brands, booking/ui...). Test files may also import "vitest".
 */
const DOMAIN_DIR = fileURLToPath(new URL("./domain", import.meta.url))
const TEST_ONLY_ALLOWED = new Set(["vitest"])

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g, // import x from "y" / export { x } from "y"
  /\bimport\s*["']([^"']+)["']/g, // side-effect import "y"
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("y")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("y")
]

function importSpecifiers(source: string): string[] {
  return IMPORT_PATTERNS.flatMap((pattern) => Array.from(source.matchAll(pattern), (m) => m[1]))
}

function isInsideDomain(fromFile: string, specifier: string): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false
  const target = resolve(dirname(fromFile), specifier)
  return target === DOMAIN_DIR || target.startsWith(DOMAIN_DIR + sep)
}

function listTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function violations(file: string, source: string): string[] {
  const isTest = /\.test\.tsx?$/.test(file)
  return importSpecifiers(source)
    .filter((spec) => !isInsideDomain(file, spec) && !(isTest && TEST_ONLY_ALLOWED.has(spec)))
    .map((spec) => `${relative(DOMAIN_DIR, file)} -> ${spec}`)
}

describe("booking/domain boundary", () => {
  it("has source files to scan", () => {
    expect(listTsFiles(DOMAIN_DIR).length).toBeGreaterThan(5)
  })

  it("imports nothing outside booking/domain", () => {
    const found = listTsFiles(DOMAIN_DIR).flatMap((file) => violations(file, readFileSync(file, "utf8")))
    expect(found).toEqual([])
  })

  it("detects forbidden imports (scanner self-check)", () => {
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
    expect(violations(file, source)).toEqual([
      "fake.ts -> react",
      "fake.ts -> ../theme/types",
      "fake.ts -> @supabase/supabase-js",
      "fake.ts -> next/headers",
      "fake.ts -> ../../brands/bylou",
      "fake.ts -> ../ui/thing",
    ])
  })

  it("rejects vitest outside test files", () => {
    expect(violations(join(DOMAIN_DIR, "policy.ts"), 'import { it } from "vitest"')).toEqual(["policy.ts -> vitest"])
    expect(violations(join(DOMAIN_DIR, "policy.test.ts"), 'import { it } from "vitest"')).toEqual([])
  })
})
