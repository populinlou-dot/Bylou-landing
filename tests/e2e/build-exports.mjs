#!/usr/bin/env node
/**
 * Builds the static exports the E2E suite serves (ADR-009: Playwright runs on `out/`).
 *
 *   node tests/e2e/build-exports.mjs            → mock exports for bylou and demo-studio
 *   node tests/e2e/build-exports.mjs supabase   → bylou export wired to the LOCAL Supabase stack
 *
 * `next build` always writes `out/`, so each export is copied to an ignored cache directory
 * (node_modules/.cache/bylou-e2e/<name>) before the next build. `out/` is left holding the
 * last build. Set E2E_SKIP_BUILD=1 to reuse the cached exports.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const E2E_DIR = join(ROOT, "node_modules", ".cache", "bylou-e2e")
const NEXT_BIN = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next")

const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321"

/** Public values from `supabase status -o env` (local stack only; never a hosted project). */
function localSupabaseAnonKey() {
  const env = execFileSync("supabase", ["status", "-o", "env"], { cwd: ROOT, encoding: "utf8" })
  const vars = Object.fromEntries(
    env
      .split("\n")
      .map((line) => /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  )
  const apiUrl = vars.API_URL
  if (apiUrl && !/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(apiUrl)) {
    throw new Error(`Refusing to build against a non-local Supabase API (${apiUrl})`)
  }
  const key = vars.ANON_KEY ?? vars.PUBLISHABLE_KEY
  if (!key) throw new Error("No ANON_KEY in `supabase status -o env`; is the local stack running (pnpm run db:start)?")
  return key
}

function build(name, env) {
  console.log(`\n▶ e2e export "${name}"`)
  const result = spawnSync(NEXT_BIN, ["build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_BASE_PATH: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      ...env,
    },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
  const target = join(E2E_DIR, name)
  rmSync(target, { recursive: true, force: true })
  cpSync(join(ROOT, "out"), target, { recursive: true })
}

const mode = process.argv[2] ?? "mock"

if (process.env.E2E_SKIP_BUILD === "1") {
  const needed = mode === "supabase" ? ["supabase"] : ["demo-studio", "bylou"]
  const missing = needed.filter((name) => !existsSync(join(E2E_DIR, name, "index.html")))
  if (missing.length === 0) {
    console.log(`E2E_SKIP_BUILD=1: reusing ${needed.join(", ")} from ${E2E_DIR}`)
    process.exit(0)
  }
  console.log(`E2E_SKIP_BUILD=1 but ${missing.join(", ")} missing: building`)
}

if (mode === "supabase") {
  build("supabase", {
    NEXT_PUBLIC_BOOKING_BRAND: "bylou",
    NEXT_PUBLIC_BOOKING_DATA_SOURCE: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localSupabaseAnonKey(),
  })
} else {
  build("demo-studio", { NEXT_PUBLIC_BOOKING_BRAND: "demo-studio", NEXT_PUBLIC_BOOKING_DATA_SOURCE: "mock" })
  // Bylou last, so `out/` ends as the default brand.
  build("bylou", { NEXT_PUBLIC_BOOKING_BRAND: "bylou", NEXT_PUBLIC_BOOKING_DATA_SOURCE: "mock" })
}
