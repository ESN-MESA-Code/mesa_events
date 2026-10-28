// `npm run gen:types` – TypeScript types of the local database schema
// (types/database.ts) from the running local Supabase stack.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = execSync("npx -y supabase@2.121.0 gen types typescript --local --schema public", {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  shell: true,
});
writeFileSync("types/database.ts", out);
console.log(`types/database.ts: ${out.split("\n").length} lines`);
