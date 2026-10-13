import { defineConfig, devices } from "@playwright/test";

// Playwright enables FORCE_COLOR for child processes; the host also injects
// NO_COLOR, so remove only the conflicting inherited preference before spawn.
delete process.env.NO_COLOR;

const port = 4173;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: "test-results/artifacts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // The launcher itself: builds IRIS when the code changed, then serves out/.
  webServer: {
    command: `node scripts/iris.mjs --port ${port} --no-open`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
