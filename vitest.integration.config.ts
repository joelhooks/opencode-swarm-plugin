import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30000, // Integration tests may be slower
    hookTimeout: 30000,
    // Run serially to avoid race conditions with shared services
    sequence: {
      concurrent: false,
    },
  },
});
