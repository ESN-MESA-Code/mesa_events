// Runs the standalone production server (`next build` output, as in the
// Docker image): copies the static files next to it, then starts
// .next/standalone/server.js. PORT and HOSTNAME come from the environment.
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { LOCAL_ENV } from "./local-supabase.mjs";

if (!existsSync(".next/standalone/server.js")) {
  console.error("No standalone build – run `npm run build:local` (or `npm run build`) first.");
  process.exit(1);
}
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync("legal", ".next/standalone/legal", { recursive: true });

const local = process.argv.includes("--local");
const child = spawn(process.execPath, ["server.js"], {
  cwd: ".next/standalone",
  stdio: "inherit",
  env: { ...process.env, ...(local ? LOCAL_ENV : {}), PORT: process.env.PORT ?? "3000", HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
