import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // e2e/ belongs to Playwright, not vitest.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
