// The runner with the app's clients and handlers. Server only.
import { googleClients } from "@/lib/google";
import { HANDLERS } from "@/lib/jobs/handlers";
import { runDueJobs } from "@/lib/jobs/runner";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/env";

export function runAppJobs(options?: Parameters<typeof runDueJobs>[2]) {
  const admin = supabaseAdmin();
  return runDueJobs({ admin, google: googleClients(admin), env: process.env, baseUrl: appBaseUrl() }, HANDLERS, options);
}
