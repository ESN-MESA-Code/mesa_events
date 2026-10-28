import type { User } from "@supabase/supabase-js";

// Google Workspace domain whose members may sign in.
export const WORKSPACE_DOMAIN = (
  process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || "esnmesa.org"
).toLowerCase();

/**
 * True when the user signed in with Google using an account from our
 * Workspace domain. Google sets the `hd` (hosted domain) claim only for
 * Workspace accounts, so we require it in addition to the email suffix.
 */
export function isWorkspaceUser(user: User | null, domain = WORKSPACE_DOMAIN): user is User {
  if (!user || !domain) return false;
  const email = user.email?.toLowerCase() ?? "";
  const hd = (user.user_metadata?.custom_claims?.hd ?? "").toLowerCase();
  const provider = user.app_metadata?.provider ?? "";
  return email.endsWith(`@${domain}`) && hd === domain && provider === "google";
}

export const DEFAULT_AFTER_LOGIN = "/";

/**
 * Where to go after signing in: only paths on this site, so the login link
 * cannot send members to another site ("//evil.com", "/\evil.com",
 * "/%2F%2Fevil.com", control characters).
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return DEFAULT_AFTER_LOGIN;
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  const bad = (s: string) =>
    !s.startsWith("/") || s.startsWith("//") || s.includes("\\") || /[\u0000-\u001f\u007f]/.test(s);
  if (bad(next) || bad(decoded)) return DEFAULT_AFTER_LOGIN;
  // Resolve against a dummy origin: anything that leaves it is refused.
  try {
    const url = new URL(next, "http://localhost");
    if (url.origin !== "http://localhost") return DEFAULT_AFTER_LOGIN;
    return url.pathname + url.search + url.hash;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
