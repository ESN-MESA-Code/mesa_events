import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of a STAGING build (NEXT_PUBLIC_APP_ENV=staging, into
// .next-staging) against the local stack, with the local staging gates
// (scripts/staging/local-env.mjs): banner, demo sign-in behind the access
// code, role switching, the demo outbox. `npm run test:e2e:staging`.
// The production build's side (no staging anywhere) is in tests/e2e.
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e-staging",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-staging" }]] : "list",
  outputDir: "test-results/staging",
  use: { baseURL: BASE, trace: "retain-on-failure" },
  // Seeds the staging demo on the shared local stack, and puts back what was there.
  globalSetup: "./tests/e2e-staging/global-setup.ts",
  globalTeardown: "./tests/e2e-staging/global-teardown.ts",
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /banner/ },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? "node scripts/start-staging.mjs" : "node scripts/build-staging.mjs && node scripts/start-staging.mjs",
    url: `${BASE}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: { PORT: String(PORT), HOSTNAME: "localhost", APP_BASE_URL: BASE },
  },
});
