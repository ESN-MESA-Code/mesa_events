import { NextRequest, NextResponse } from "next/server";
import { createSessionClient } from "@/lib/supabase/session";
import { safeNext } from "@/lib/auth";
import { isLocalDemoUser, isLocalUser, localLoginEnabled } from "@/lib/localLogin";
import { demoPassword } from "@/lib/staging/password";

// Signs in as a persona of the demo data (`npm run seed:staging`) or a
// seeded test account (supabase/seed.sql) – `npm run dev:local` only. In a
// production build localLoginEnabled() is false, so this answers 404
// (tests/e2e/security.spec.ts).
export async function POST(req: NextRequest) {
  if (!localLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const demo = isLocalDemoUser(email);
  if (!demo && !isLocalUser(email)) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", req.url), 303);
  }

  const supabase = await createSessionClient();
  // The test accounts' password, or the demo members' (derived from the local service-role key);
  // kept out of the login page's browser bundle.
  const password = demo ? demoPassword(email) : "local-test-password";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", req.url), 303);
  }

  return NextResponse.redirect(new URL(safeNext(String(form.get("next") ?? "")), req.url), 303);
}
