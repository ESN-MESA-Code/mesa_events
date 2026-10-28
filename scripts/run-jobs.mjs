// `npm run jobs:run [baseUrl]` – asks the running app to process due jobs
// now (what pg_cron does every 30 seconds), e.g. after `npm run dev:local`.
import { LOCAL_ENV } from "./local-supabase.mjs";

const base = process.argv[2] ?? process.env.APP_BASE_URL ?? LOCAL_ENV.APP_BASE_URL;
const secret = process.env.JOBS_SECRET ?? LOCAL_ENV.JOBS_SECRET;
const res = await fetch(`${base}/api/jobs/run`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
console.log(res.status, JSON.stringify(await res.json(), null, 2));
process.exit(res.ok ? 0 : 1);
