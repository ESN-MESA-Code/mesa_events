// Security headers for every response (set by proxy.ts). The Content
// Security Policy allows scripts only with the per-request nonce (Next.js
// adds it to its own scripts), talks only to this site and Supabase, and
// forbids framing (clickjacking) – tests/unit/securityHeaders.test.ts and
// tests/e2e/security.spec.ts check it.

// Pages open without login (proxy.ts); everything else needs a member.
// /api/esn: the ESN Activities script, with a personal access token instead of a session.
// /api/calendar: the calendar subscription (iCal), with a personal feed token instead of a session.
// /staging: the staging demo sign-in (behind its access code; 404 elsewhere).
const PUBLIC_PATHS = ["/login", "/auth", "/event", "/impressum", "/privacy", "/datenschutz", "/terms", "/api/jobs", "/api/esn", "/api/calendar", "/robots.txt", "/staging"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function contentSecurityPolicy(nonce: string, opts: { supabaseUrl?: string; dev?: boolean } = {}): string {
  let supabase = "";
  let supabaseWs = "";
  try {
    const url = new URL(opts.supabaseUrl ?? "");
    supabase = url.origin;
    supabaseWs = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  } catch {
    // No Supabase URL configured: same-origin only.
  }
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic': scripts loaded by nonce-carrying scripts are trusted.
    // React's dev overlay needs eval in development only.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", supabase].filter(Boolean),
    "font-src": ["'self'"],
    // Development: the dev server's hot reload websocket.
    "connect-src": ["'self'", supabase, supabaseWs, ...(opts.dev ? ["ws://localhost:*", "ws://127.0.0.1:*"] : [])].filter(Boolean),
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

export function securityHeaders(nonce: string, opts: { supabaseUrl?: string; dev?: boolean; https?: boolean; noindex?: boolean } = {}) {
  return {
    "Content-Security-Policy": contentSecurityPolicy(nonce, opts),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    // QR code tokens in /event/[token] never leave the site in a Referer header.
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(opts.https ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {}),
    // Staging: search engines must not list the demo site.
    ...(opts.noindex ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
  } as Record<string, string>;
}
