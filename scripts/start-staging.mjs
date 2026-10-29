// `npm run start:staging` – serves the staging build (`npm run build:staging`)
// against the local stack on http://localhost:3200, with the local staging
// gates (scripts/staging/local-env.mjs). Variables set by the caller win.
import { spawn } from "node:child_process";
import { LOCAL_ENV } from "./local-supabase.mjs";
import { STAGING_LOCAL_ENV } from "./staging/local-env.mjs";

const PORT = process.env.PORT ?? "3200";
const child = spawn(process.execPath, ["scripts/start-standalone.mjs"], {
  stdio: "inherit",
  env: { ...LOCAL_ENV, ...STAGING_LOCAL_ENV, APP_BASE_URL: `http://localhost:${PORT}`, ...process.env, PORT, NEXT_DIST_DIR: ".next-staging" },
});
child.on("exit", (code) => process.exit(code ?? 0));
