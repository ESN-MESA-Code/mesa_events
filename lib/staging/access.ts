// The staging access code (STAGING_ACCESS_CODE): the demo sign-in's role
// picker sits behind it, because the staging site is public. Compared in
// constant time, failed attempts rate-limited per client and overall, and a
// correct code leaves a cookie for the browser session (no expiry date)
// that is an HMAC of the code – changing the code signs everyone out of the
// picker. Server only.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "mesa_staging_access";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time comparison (hashing first makes the lengths equal). */
export function codeMatches(input: string, code: string): boolean {
  return timingSafeEqual(sha256(input), sha256(code)) && code.length > 0;
}

export function accessCookieValue(code: string, projectRef: string): string {
  return createHmac("sha256", code).update(`mesa-staging-access:v1:${projectRef}`).digest("base64url");
}

export function hasAccess(cookie: string | undefined, code: string | undefined, projectRef: string | null): boolean {
  if (!cookie || !code || !projectRef) return false;
  return codeMatches(cookie, accessCookieValue(code, projectRef));
}

/** The client's address as the proxy in front reports it (Vercel, Caddy, nginx). */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Failed attempts in a sliding window, per client and overall (so many
 * clients together cannot try more either). In memory: per server
 * instance, which is enough with a code of at least 16 characters.
 */
export class AttemptLimiter {
  private failures = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly perClient = 5,
    private readonly overall = 30,
    private readonly windowMs = 15 * 60_000
  ) {}

  private recent(list: number[], now: number) {
    return list.filter((t) => now - t < this.windowMs);
  }

  /** Whether `key` may try now. */
  allowed(key: string, now = Date.now()): boolean {
    this.all = this.recent(this.all, now);
    const mine = this.recent(this.failures.get(key) ?? [], now);
    if (mine.length) this.failures.set(key, mine);
    else this.failures.delete(key);
    return mine.length < this.perClient && this.all.length < this.overall;
  }

  fail(key: string, now = Date.now()) {
    this.failures.set(key, [...this.recent(this.failures.get(key) ?? [], now), now]);
    this.all = [...this.recent(this.all, now), now];
  }

  succeed(key: string) {
    this.failures.delete(key);
  }
}

/** The server's limiter for the access code. */
export const accessLimiter = new AttemptLimiter();
