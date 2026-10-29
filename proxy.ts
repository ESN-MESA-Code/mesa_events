import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isWorkspaceUser } from "@/lib/auth";
import { isPublicPath, securityHeaders } from "@/lib/securityHeaders";

// Every request: a CSP nonce and the security headers, a refreshed Supabase
// session, and the member area behind the Google Workspace login and the
// confidentiality rules (/confidentiality). Open without login: the public
// attendance form (/event/[token]), legal pages, sign-in routes and the
// jobs runner (/api/jobs/run checks its own secret).
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const headers = securityHeaders(nonce, {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    dev: process.env.NODE_ENV !== "production",
    https: (process.env.APP_BASE_URL ?? "").startsWith("https://"),
  });

  // Next.js reads the nonce from the request's CSP header for its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const finish = (res: NextResponse) => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, cacheHeaders) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cacheHeaders ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) {
    // Keep the session fresh on the login pages too.
    if (pathname === "/login" || pathname.startsWith("/auth/")) await supabase.auth.getUser();
    return finish(response);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isWorkspaceUser(user)) {
    if (pathname.startsWith("/api/")) return finish(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    return finish(redirectTo(request, "/login", pathname + search));
  }

  // Members see nothing before they accepted the confidentiality rules (the
  // database refuses them too, see public.is_workspace_member()).
  if (!pathname.startsWith("/confidentiality")) {
    const { data: accepted } = await supabase.rpc("is_workspace_member");
    if (accepted !== true) {
      if (pathname.startsWith("/api/")) {
        return finish(NextResponse.json({ error: "Confidentiality rules not accepted" }, { status: 403 }));
      }
      return finish(redirectTo(request, "/confidentiality", pathname + search));
    }
  }

  return finish(response);
}

function redirectTo(request: NextRequest, pathname: string, next: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything but static files (they get headers from next.config.ts).
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|pretzel.svg|esn-mesa-logo.*\\.png).*)",
  ],
};
