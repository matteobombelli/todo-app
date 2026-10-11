import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against `npm run dev` (the built SPA on wrangler, local D1). Each test signs up a
// user of its own (e2e/fixtures.ts), so tests run in parallel without seeing each other's data.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8787",
    // The production build registers a service worker; tests talk to the Worker directly.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8787",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
