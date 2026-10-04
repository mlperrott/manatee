import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.MANATEE_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:4173/";

export default defineConfig({
  testDir: "./tests/browser",
  // Solid diagnostics measure millisecond budgets; avoid contention between browsers.
  workers: 1,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          env: { MANATEE_BROWSER_TESTS: "1" },
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "iphone",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
