import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4317);

export default defineConfig({
  testDir: "./tests",
  // The scenario is one room played by several browsers, step by step.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  // The built client served by the real game server, AI franchises off so
  // the bidding is deterministic.
  webServer: {
    command: "npm run build && npm start",
    cwd: "..",
    url: `http://localhost:${PORT}/api/session`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), AI_ENABLED: "false", COOKIE_SECRET: "e2e-secret" },
  },
});
