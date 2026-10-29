import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, isPublicPath, securityHeaders } from "@/lib/securityHeaders";

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((d) => {
      const [k, ...v] = d.trim().split(/\s+/);
      return [k, v];
    })
  );

describe("security headers", () => {
  it("allows scripts only with the nonce, no inline or eval in production", () => {
    const csp = parse(contentSecurityPolicy("abc123", { supabaseUrl: "https://xyz.supabase.co" }));
    expect(csp["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("forbids framing, plugins and foreign form targets", () => {
    const csp = parse(contentSecurityPolicy("n"));
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
  });

  it("connects only to this site and Supabase (REST and realtime)", () => {
    const csp = parse(contentSecurityPolicy("n", { supabaseUrl: "https://xyz.supabase.co" }));
    expect(csp["connect-src"]).toEqual(["'self'", "https://xyz.supabase.co", "wss://xyz.supabase.co"]);
    const local = parse(contentSecurityPolicy("n", { supabaseUrl: "http://127.0.0.1:54421" }));
    expect(local["connect-src"]).toEqual(["'self'", "http://127.0.0.1:54421", "ws://127.0.0.1:54421"]);
  });

  it("sends the other headers, HSTS only over https", () => {
    const h = securityHeaders("n");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("same-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders("n", { https: true })["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });

  it("dev mode adds eval for React's tooling only", () => {
    expect(parse(contentSecurityPolicy("n", { dev: true }))["script-src"]).toContain("'unsafe-eval'");
  });
});

describe("public paths (no login)", () => {
  it.each(["/login", "/auth/callback", "/event/abc", "/impressum", "/privacy", "/datenschutz", "/terms", "/api/jobs/run", "/api/esn/events/x"])("%s is public", (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each(["/", "/calendar", "/events/1", "/eventsx", "/loginx", "/admin", "/team/finance", "/kiosk/1", "/api/other", "/api/jobsx", "/api/esnx"])(
    "%s needs a member",
    (p) => {
      expect(isPublicPath(p)).toBe(false);
    }
  );
});
