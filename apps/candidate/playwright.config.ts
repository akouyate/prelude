import { defineConfig, devices } from "@playwright/test";

const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  (process.env.CI ? process.env.DATABASE_URL : undefined) ??
  "postgresql://postgres:postgres@localhost:55432/prelude?schema=public";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    env: {
      DATABASE_URL: e2eDatabaseUrl,
    },
    command: "pnpm dev",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
  },
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
