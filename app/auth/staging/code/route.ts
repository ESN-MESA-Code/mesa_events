import { NextResponse, type NextRequest } from "next/server";
import { stagingSignInEnabled, supabaseProjectRef } from "@/lib/staging";
import { ACCESS_COOKIE, accessCookieValue, accessLimiter, clientKey, codeMatches } from "@/lib/staging/access";

// The staging access code (docs/STAGING.md): a correct code opens the role
// picker for this browser session. 404 unless every staging gate holds –
// always in a production build.
export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging" || !stagingSignInEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const back = (error?: string) => NextResponse.redirect(new URL(error ? `/staging?error=${error}` : "/staging", req.url), 303);

  const key = clientKey(req.headers);
  if (!accessLimiter.allowed(key)) return back("too_many");

  const form = await req.formData();
  const code = process.env.STAGING_ACCESS_CODE!;
  if (!codeMatches(String(form.get("code") ?? ""), code)) {
    accessLimiter.fail(key);
    return back("wrong_code");
  }
  accessLimiter.succeed(key);

  const res = back();
  // No expiry: the cookie lasts for the browser session.
  res.cookies.set(ACCESS_COOKIE, accessCookieValue(code, supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL)!), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
  });
  return res;
}
