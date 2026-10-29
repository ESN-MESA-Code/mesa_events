import { NextResponse, type NextRequest } from "next/server";
import { run } from "@/lib/actions/run";
import { resetDemoData } from "@/lib/actions/staging";
import { isStaging } from "@/lib/staging";

// Admin → "Reset demo data" (StagingCard): runs the action with the
// signed-in member (it checks the admin role and every staging gate). 404
// unless this is a staging build on the staging site.
export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging" || !isStaging()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Only from this site's own form.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const result = await run(resetDemoData, { confirm: String(form.get("confirm") ?? "") });
  const outcome = result.ok ? "done" : result.error === "invalid_input" ? "confirm" : result.error === "forbidden" || result.error === "unauthenticated" ? "forbidden" : "failed";
  if (outcome === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.redirect(new URL(`/admin?demo=${outcome}`, req.url), 303);
}
