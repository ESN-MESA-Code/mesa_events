import { NextRequest, NextResponse } from "next/server";
import { hasJobsSecret } from "@/lib/jobs/secret";
import { runAppJobs } from "@/lib/jobs";

// Runs due jobs (Chat, Drive, role sync). pg_cron calls it through pg_net
// with "Authorization: Bearer <JOBS_SECRET>" (private.invoke_job_runner());
// nobody else may trigger it.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!hasJobsSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runAppJobs());
  } catch (err) {
    console.error("Job runner failed:", err);
    return NextResponse.json({ error: "Job runner failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
