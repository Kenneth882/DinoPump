import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  ...(process.env.DINOPUMP_E2E_FILE
    ? { testMatch: process.env.DINOPUMP_E2E_FILE }
    : {}),
  outputDir: process.env.DINOPUMP_E2E_FILE
    ? `test-results/${process.env.DINOPUMP_E2E_FILE}`
    : "test-results",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec node --import tsx tests/helpers/e2e-game-server.ts",
      url: "http://127.0.0.1:3101/health",
      env: { GAME_SERVER_PORT: "3101", WEB_ORIGIN: "http://127.0.0.1:3100" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "pnpm --filter @dinopump/web exec next dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      env: { DINOPUMP_E2E: "1", GAME_SERVER_ORIGIN: "http://127.0.0.1:3101" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
