import { NextResponse, type NextRequest } from "next/server";
import { createSessionClient } from "@/lib/supabase/session";
import { WORKSPACE_DOMAIN } from "@/lib/auth";
import { stagingSignInEnabled, supabaseProjectRef } from "@/lib/staging";
import { ACCESS_COOKIE, hasAccess } from "@/lib/staging/access";
import { demoEmail, persona, person } from "@/lib/staging/people";
import { demoPassword } from "@/lib/staging/password";

// Signs in as one of the demo personas (lib/staging/people.ts) – staging
// only, after the access code. 404 unless every staging gate holds.
export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging" || !stagingSignInEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!hasAccess(req.cookies.get(ACCESS_COOKIE)?.value, process.env.STAGING_ACCESS_CODE, supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL))) {
    return NextResponse.redirect(new URL("/staging", req.url), 303);
  }

  const form = await req.formData();
  const chosen = persona(String(form.get("persona") ?? ""));
  if (!chosen) return NextResponse.redirect(new URL("/staging?error=unknown_role", req.url), 303);

  const email = demoEmail(person(chosen.person), WORKSPACE_DOMAIN);
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: demoPassword(email) });
  if (error) {
    console.error(`Staging sign-in as ${email} failed:`, error.message);
    return NextResponse.redirect(new URL("/staging?error=not_seeded", req.url), 303);
  }
  return NextResponse.redirect(new URL(chosen.start, req.url), 303);
}
