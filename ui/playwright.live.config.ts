import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "m1-live.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL:
      process.env.AI_ARTIST_LIVE_URL ??
      "https://tongjin-server.tail910d5f.ts.net",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "live-desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
