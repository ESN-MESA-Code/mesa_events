// `npm run build:local` – a production build against the local stack (for
// the end-to-end tests and the bundle scan). NEXT_PUBLIC_* values are
// baked in at build time. The local test sign-in is off in every
// production build, whatever is set here.
import { spawnSync } from "node:child_process";
import { LOCAL_ENV } from "./local-supabase.mjs";

const res = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...LOCAL_ENV, NEXT_PUBLIC_LOCAL_LOGIN: "true" },
});
process.exit(res.status ?? 1);
