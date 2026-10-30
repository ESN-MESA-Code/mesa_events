// `npm run dev:local` – the app against the local Supabase stack instead of
// the project in .env.local (variables set here win over .env files), with
// the "Local test sign-in" on the login page and fake Google services.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { LOCAL_ENV } from "./local-supabase.mjs";

// A production standalone build left in .next by `build:local` / the E2E
// tests makes the dev server reload pages in an endless loop: remove it
// (`npm run test:e2e` builds it again).
rmSync(".next/standalone", { recursive: true, force: true });

const args = ["next", "dev", ...process.argv.slice(2)];
const child = spawn("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  // Real address suggestions from Photon (OpenStreetMap) while trying the app; ADDRESS_LOOKUP=fake works offline.
  env: { ...process.env, ...LOCAL_ENV, ADDRESS_LOOKUP: process.env.ADDRESS_LOOKUP || "photon", NEXT_PUBLIC_LOCAL_LOGIN: "true" },
});
child.on("exit", (code) => process.exit(code ?? 0));
