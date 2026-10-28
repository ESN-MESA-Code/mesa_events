import { NextResponse, type NextRequest } from "next/server";
import { createSessionClient } from "@/lib/supabase/session";
import { isWorkspaceUser, safeNext } from "@/lib/auth";
import { refreshRolesFor } from "@/lib/roleSync";

// Google → Supabase redirects here with a one-time code after sign-in.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  if (!isWorkspaceUser(data.user)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  // Joined or left a role group since the last daily sync?
  try {
    await refreshRolesFor(data.user.email!.toLowerCase());
  } catch (err) {
    console.error("Role check at login failed:", err);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
