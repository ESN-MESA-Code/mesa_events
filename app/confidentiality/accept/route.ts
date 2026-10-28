import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth";
import { createSessionClient } from "@/lib/supabase/session";

// Records that the signed-in member accepted the confidentiality rules. The
// database takes the email and time from the session, and refuses a
// version other than the current one.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const next = safeNext(String(form.get("next") ?? ""));
  const version = String(form.get("version") ?? "");

  const supabase = await createSessionClient();
  const { error } = await supabase.rpc("acknowledge_confidentiality", { accepted_version: version });

  if (error) {
    const back = new URL("/confidentiality", req.url);
    back.searchParams.set("next", next);
    back.searchParams.set("error", error.code === "22023" ? "changed" : "failed");
    return NextResponse.redirect(back, 303);
  }
  return NextResponse.redirect(new URL(next, req.url), 303);
}
