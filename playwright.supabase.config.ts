import { defineConfig, devices } from "@playwright/test"
import type { BookingOptions } from "./tests/e2e/support/fixtures"

/**
 * OPT-IN: journeys B and F against the LOCAL Supabase stack (never a hosted project).
 * Prerequisites: `pnpm run db:start` (or `supabase start`) and a fresh `supabase db reset`.
 * Run with `pnpm run test:e2e:supabase`, then `supabase db reset` to restore the seed.
 * Not part of `pnpm run test:e2e`.
 */
const E2E_DIR = "node_modules/.cache/bylou-e2e"
const PORT = 4312

export default defineConfig<BookingOptions>({
  testDir: "tests/e2e/supabase",
  outputDir: `${E2E_DIR}/test-results-supabase`,
  reporter: [["list"], ["html", { outputFolder: `${E2E_DIR}/report-supabase`, open: "never" }]],
  // One shared database: run serially.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    brandId: "bylou",
    // Real clock: the seed is relative to the database's now().
    fixedNow: null,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "supabase-local" }],
  webServer: {
    command: `node tests/e2e/static-server.mjs ${E2E_DIR}/supabase ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
