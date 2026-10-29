// The ESN Activities browser script (tools/esn-activities/mesa-esn.user.js)
// as installed by a Comms member: this platform's address and, right after
// creating a token, the token filled in. Server only: reads the file from
// disk (shipped next to the server like legal/, see next.config.ts and the
// Dockerfile).
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "tools", "esn-activities", "mesa-esn.user.js");

export function userscript(baseUrl: string, token?: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const host = new URL(base).hostname;
  return fs
    .readFileSync(FILE, "utf8")
    .replace("__MESA_HOST__", host)
    .replace("__MESA_BASE_URL__", base)
    .replace("__MESA_TOKEN__", token && /^mesa_esn_[A-Za-z0-9_-]{43}$/.test(token) ? token : "");
}
