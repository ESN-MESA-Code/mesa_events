// Runs due jobs from public.jobs: claims a batch (claim_jobs, which skips
// rows another runner holds), runs each kind's handler and records the
// outcome. Failures are retried with exponential backoff by fail_job();
// after max_attempts a job is "dead" and an admin can retry it (/admin).
// Server only; called by POST /api/jobs/run (pg_cron) and `npm run jobs:run`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleClients } from "@/lib/google";
import type { TelegramSetup } from "@/lib/telegram";
import type { Database, Json } from "@/types/database";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];

export interface JobDeps {
  admin: SupabaseClient<Database>;
  google: GoogleClients;
  env: Record<string, string | undefined>;
  /** Public base URL of the app (links in Chat messages). */
  baseUrl: string;
  /** Telegram client and chat; picked from the environment when not given (tests pass a fake). */
  telegram?: TelegramSetup;
}

export type JobHandler = (job: Job, deps: JobDeps) => Promise<Json | void>;

export interface RunSummary {
  claimed: number;
  done: number;
  failed: number;
  results: Array<{ id: number; kind: string; ok: boolean; error?: string }>;
}

export async function runDueJobs(
  deps: JobDeps,
  handlers: Record<string, JobHandler>,
  { worker = `runner-${process.pid}`, limit = 20, maxBatches = 5 } = {}
): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, done: 0, failed: 0, results: [] };
  for (let batch = 0; batch < maxBatches; batch++) {
    const { data: jobs, error } = await deps.admin.rpc("claim_jobs", { worker, max_jobs: limit });
    if (error) throw new Error(`Claiming jobs failed: ${error.message}`);
    if (!jobs?.length) break;
    summary.claimed += jobs.length;
    for (const job of jobs) {
      try {
        const handler = handlers[job.kind];
        if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
        const result = await handler(job, deps);
        const { error: doneError } = await deps.admin.rpc("complete_job", { job_id: job.id, job_result: (result ?? null) as Json });
        if (doneError) throw new Error(doneError.message);
        summary.done++;
        summary.results.push({ id: job.id, kind: job.kind, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await deps.admin.rpc("fail_job", { job_id: job.id, error: message });
        summary.failed++;
        summary.results.push({ id: job.id, kind: job.kind, ok: false, error: message });
      }
    }
  }
  return summary;
}
