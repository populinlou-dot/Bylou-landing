import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["booking/**/*.test.ts", "brands/**/*.test.ts"],
        },
      },
      {
        // Component tests for booking/ui (React Testing Library + jsdom).
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["booking/**/*.test.tsx"],
        },
      },
    ],
  },
})
