// `npm run build:staging` – a staging build (NEXT_PUBLIC_APP_ENV=staging)
// against the local stack, into .next-staging so it does not replace the
// production build of `build:local` (E2E, bundle scan). For the
// staging-mode E2E (playwright.staging.config.ts) and for rehearsing a demo:
// `npm run start:staging` serves it on http://localhost:3200.
import { spawnSync } from "node:child_process";
import { LOCAL_ENV } from "./local-supabase.mjs";
import { STAGING_LOCAL_ENV } from "./staging/local-env.mjs";

const res = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...LOCAL_ENV, ...STAGING_LOCAL_ENV, NEXT_DIST_DIR: ".next-staging" },
});
process.exit(res.status ?? 1);
