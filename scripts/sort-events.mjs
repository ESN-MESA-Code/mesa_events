// `npm run sort:events` – sorts every event without a format into the
// suggested category and format, as "Save all" on Events team → Categories
// and formats does with the rows as suggested (lib/formatsApply.ts): a
// category from the keywords (one already set is kept), a format for each
// name that ran more than once, ideas after their event or title. Prints
// what it would do; `--apply` writes.
//
// Target: the local Supabase stack by default. With --remote, the project in
// the environment – only when every staging gate holds (lib/staging.ts):
//   node --env-file=.env.staging scripts/sort-events.mjs --remote [--apply]
import "./staging/ts-loader.mjs";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENV } from "./local-supabase.mjs";

const { failedStagingGates } = await import("@/lib/staging");
const { isLocalSupabaseUrl } = await import("@/lib/localLogin");
const { applySuggestedSorting } = await import("@/lib/formatsApply");

const remote = process.argv.includes("--remote");
const apply = process.argv.includes("--apply");
const env = remote ? process.env : { ...process.env, ...LOCAL_ENV };

if (remote) {
  const failed = failedStagingGates(env);
  if (failed.length) {
    console.error(`Refusing: not a staging target.\n${failed.map((f) => `  - ${f}`).join("\n")}\nSee docs/STAGING.md.`);
    process.exit(1);
  }
} else if (!isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("Refusing: without --remote this only runs against the local stack.");
  process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const r = await applySuggestedSorting(db, { dryRun: !apply });
  const verb = apply ? "" : "Would give ";
  console.log(`${apply ? "Sorted" : "Dry run"} – ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`${verb}${r.categorized} events a category, link ${r.linked} to formats (${r.formatsCreated.length} new), ${r.ideas} ideas a category.`);
  if (r.formatsCreated.length) console.log(`New formats: ${r.formatsCreated.join(", ")}`);
  if (r.unmatched.length) console.log(`No category matched (sort them on the page): ${r.unmatched.join(", ")}`);
  if (!apply) console.log("Nothing written – add --apply to sort.");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
