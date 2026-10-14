import { defineConfig, devices } from "@playwright/test"
import type { BookingOptions } from "./tests/e2e/support/fixtures"

/**
 * E2E on the STATIC export (ADR-009), mock data source. `pnpm run test:e2e` builds the exports
 * first (tests/e2e/build-exports.mjs); this config only serves and tests them.
 * Artifacts go under node_modules/.cache (already git-ignored).
 * The opt-in Supabase run lives in playwright.supabase.config.ts.
 */
const E2E_DIR = "node_modules/.cache/bylou-e2e"
const BYLOU_PORT = 4310
const DEMO_PORT = 4311

const serve = (dir: string, port: number) => ({
  command: `node tests/e2e/static-server.mjs ${E2E_DIR}/${dir} ${port}`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: false,
  timeout: 30_000,
})

export default defineConfig<BookingOptions>({
  testDir: "tests/e2e",
  testIgnore: ["supabase/**"],
  outputDir: `${E2E_DIR}/test-results`,
  reporter: [["list"], ["html", { outputFolder: `${E2E_DIR}/report`, open: "never" }]],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: ["demo-studio.spec.ts", "supabase/**"],
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${BYLOU_PORT}`, brandId: "bylou" },
    },
    {
      name: "mobile",
      testIgnore: ["demo-studio.spec.ts", "supabase/**"],
      use: { ...devices["Pixel 7"], baseURL: `http://127.0.0.1:${BYLOU_PORT}`, brandId: "bylou" },
    },
    {
      // Journey G: the brand-agnostic journeys (@white-label) + identity smoke on the demo build.
      name: "demo-studio",
      grep: /@white-label|demo-studio brand/,
      testIgnore: ["supabase/**"],
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${DEMO_PORT}`, brandId: "demo-studio" },
    },
  ],
  webServer: [serve("bylou", BYLOU_PORT), serve("demo-studio", DEMO_PORT)],
})
