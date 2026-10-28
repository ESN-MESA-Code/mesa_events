import { NextRequest, NextResponse } from "next/server";
import { createSessionClient } from "@/lib/supabase/session";
import { safeNext } from "@/lib/auth";
import { isLocalUser, localLoginEnabled } from "@/lib/localLogin";

// Signs in as one of the seeded members (supabase/seed.sql) – `npm run
// dev:local` only. In a production build localLoginEnabled() is false, so
// this answers 404 (tests/e2e/security.spec.ts).
export async function POST(req: NextRequest) {
  if (!localLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  if (!isLocalUser(email)) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", req.url), 303);
  }

  const supabase = await createSessionClient();
  // The seeded members' password; kept out of the login page's browser bundle.
  const { error } = await supabase.auth.signInWithPassword({ email, password: "local-test-password" });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", req.url), 303);
  }

  return NextResponse.redirect(new URL(safeNext(String(form.get("next") ?? "")), req.url), 303);
}
