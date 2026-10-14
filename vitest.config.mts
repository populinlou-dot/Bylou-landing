import { configDefaults, defineConfig } from "vitest/config"

// Playwright specs (tests/e2e, `pnpm run test:e2e`) never run under Vitest.
const exclude = [...configDefaults.exclude, "tests/e2e/**", "playwright*.config.ts"]

// `vitest run` (the `test` script, CI deploy) never touches a database.
// DB concurrency tests need the local Supabase stack and run only with `--mode db`
// (`pnpm run test:db`), which selects the `db` project instead of the unit projects.
export default defineConfig(({ mode }) => ({
  test: {
    projects:
      mode === "db"
        ? [
            {
              test: {
                name: "db",
                environment: "node",
                include: ["tests/db/**/*.test.ts"],
                exclude,
                testTimeout: 120_000,
                hookTimeout: 60_000,
                fileParallelism: false,
              },
            },
          ]
        : [
            {
              test: {
                name: "node",
                environment: "node",
                include: ["booking/**/*.test.ts", "brands/**/*.test.ts"],
                exclude,
              },
            },
            {
              // Component tests for booking/ui (React Testing Library + jsdom).
              test: {
                name: "dom",
                environment: "jsdom",
                include: ["booking/**/*.test.tsx"],
                exclude,
              },
            },
          ],
  },
}))
