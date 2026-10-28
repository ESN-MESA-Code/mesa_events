// `npm run dev:local` – the app against the local Supabase stack instead of
// the project in .env.local (variables set here win over .env files), with
// the "Local test sign-in" on the login page and fake Google services.
import { spawn } from "node:child_process";
import { LOCAL_ENV } from "./local-supabase.mjs";

const args = ["next", "dev", ...process.argv.slice(2)];
const child = spawn("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...LOCAL_ENV, NEXT_PUBLIC_LOCAL_LOGIN: "true" },
});
child.on("exit", (code) => process.exit(code ?? 0));
