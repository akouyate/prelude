import { defineConfig, devices } from "@playwright/test";

const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined) ??
  "postgresql://postgres:postgres@localhost:5440/prelude?schema=public";

export default defineConfig({
  testDir: "./e2e",
  webServer: [
    {
      command: "node e2e/fake-realtime-server.mjs",
      reuseExistingServer: !process.env.CI,
      url: "http://127.0.0.1:18081/healthz",
    },
    {
      env: {
        ALLOW_MOCK_INTERVIEW: "1",
        DATABASE_URL: e2eDatabaseUrl,
        PRELUDE_REALTIME_API_URL: "http://127.0.0.1:18081",
      },
      command: "./node_modules/.bin/next dev --port 3001",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
});
