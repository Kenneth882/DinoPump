import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @dinopump/game-server dev",
      url: "http://127.0.0.1:3001/health",
      env: { GAME_SERVER_PORT: "3001" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @dinopump/web dev",
      url: "http://127.0.0.1:3000",
      env: { GAME_SERVER_ORIGIN: "http://127.0.0.1:3001" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
