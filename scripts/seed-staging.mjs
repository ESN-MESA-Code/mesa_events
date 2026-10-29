// `npm run seed:staging` – the rich staging demo data (lib/staging/seed.ts):
// replaces what an earlier run created (and the local demo seed's data).
// `npm run staging:reset` – wipes ALL data first (public.staging_wipe(); members,
// accepted rules, team roles and settings stay), then seeds.
// `npm run seed:staging -- --remove` – takes the staging demo out again (data
// and demo members); `npm run seed:demo` brings back the small local demo.
//
// Target: the local Supabase stack by default. With --remote, the project in
// the environment – and only when every staging gate holds (lib/staging.ts):
//   node --env-file=.env.staging scripts/seed-staging.mjs --remote [--reset]
// The database refuses as well unless it is marked as a demo database
// (docs/STAGING.md). Never touches .env.local.
import "./staging/ts-loader.mjs";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENV } from "./local-supabase.mjs";

const { failedStagingGates } = await import("@/lib/staging");
const { isLocalSupabaseUrl } = await import("@/lib/localLogin");
const { roleGroups } = await import("@/lib/roles");
const { seedStaging, resetStagingData, removeStagingData, deleteDemoMembers } = await import("@/lib/staging/seed");
const { PERSONAS, person, demoEmail } = await import("@/lib/staging/people");

const remote = process.argv.includes("--remote");
const reset = process.argv.includes("--reset");
const remove = process.argv.includes("--remove");
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
const domain = (env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || "esnmesa.org").toLowerCase();
const opts = {
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  baseUrl: env.APP_BASE_URL || "http://localhost:3000",
  domain,
  groups: roleGroups(env),
  driveRoot: env.DRIVE_PHOTOS_FOLDER_ID || undefined,
  log: (line) => console.log(line),
};

try {
  if (remove) {
    const n = await removeStagingData(db, domain);
    await deleteDemoMembers(db, domain);
    console.log(`Removed the staging demo (${n} events) and its members.${remote ? "" : " npm run seed:demo brings back the small demo."}`);
    process.exit(0);
  }
  const started = Date.now();
  const summary = reset ? await resetStagingData(db, opts) : await seedStaging(db, opts);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log("  Cycles:", Object.entries(summary.cycles).map(([m, s]) => `${m.slice(0, 7)} ${s}`).join(", "));
  console.log("  Events:", JSON.stringify(summary.eventStatuses));
  console.log("  Descriptions:", JSON.stringify(summary.descriptionStages));
  console.log("  Claims:", JSON.stringify(summary.claimStatuses));
  console.log("  Ideas:", JSON.stringify(summary.ideaStatuses));
  console.log("Demo sign-in personas (staging builds, after the access code):");
  for (const p of PERSONAS) console.log(`  ${p.label.padEnd(18)} ${demoEmail(person(p.person), domain)}`);
  if (!remote) console.log('Locally, the team roles (Events, Comms, Finance …) of "npm run dev:local" see all of it too.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (!remote) console.error("Is the local stack running? npm run supabase:start");
  process.exit(1);
}
