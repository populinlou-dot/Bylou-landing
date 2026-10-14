import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["booking/**/*.test.ts", "brands/**/*.test.ts"],
  },
})
