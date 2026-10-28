import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the local Supabase stack and a PRODUCTION build
// of the app (standalone server, as in the Docker image) – so the security
// headers and "no local test sign-in in production" are what users get.
// Sessions are put into cookies (tests/e2e/fixtures.ts); Google services run
// on the database fakes; jobs are run through the secret-protected route.
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Participants sign in on their phones.
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /public-form/ },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? "node scripts/start-standalone.mjs --local" : "node scripts/build-local.mjs && node scripts/start-standalone.mjs --local",
    url: `${BASE}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    env: { PORT: String(PORT), HOSTNAME: "localhost", APP_BASE_URL: BASE },
  },
});
