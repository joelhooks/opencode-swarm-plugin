import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Don't follow symlinks to their realpath — keeps resolution
    // in the normal node_modules tree instead of .bun/ internals.
    symlinks: false,
    alias: {
      // Map bun:test → our shim that bridges bun:test API to vitest
      "bun:test": path.resolve(__dirname, "vitest-bun-shim.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Exclude integration tests and files with heavy bun-specific APIs
    exclude: [
      "src/**/*.integration.test.ts",
      "src/swarm-worktree.test.ts", // Uses Bun.$ shell API
      "src/zz-eval-runner.test.ts", // Uses Bun.write
    ],
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 4 },
    },
    testTimeout: 15000,
  },
});
