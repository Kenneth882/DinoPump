import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.database.test.ts"],
    // Process crash suites and latency checks share one disposable PostgreSQL host.
    // Tests that need competing processors create that concurrency explicitly.
    maxWorkers: 1,
    hookTimeout: 15_000,
  },
});
