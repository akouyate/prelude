import { defineConfig, devices } from "@playwright/test";

const port = process.env.CONSOLE_E2E_PORT ?? "3100";
const baseURL = `http://127.0.0.1:${port}`;
const authProvider = process.env.CONSOLE_AUTH_PROVIDER ?? "mock";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: `CONSOLE_AUTH_PROVIDER=${authProvider} INTERVIEW_DRAFT_GENERATOR=deterministic pnpm exec next dev --port ${port}`,
    reuseExistingServer:
      !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    url: baseURL,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "clerk setup",
      testMatch: /clerk\.setup\.ts/,
    },
    {
      dependencies: ["clerk setup"],
      name: "chromium",
      testIgnore: /clerk\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
