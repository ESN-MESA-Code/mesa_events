// Service-account access tokens for Google APIs (RFC 7523 JWT bearer), with
// an in-process cache. Used by the real Directory, Chat and Drive clients;
// never by the fakes. Server only.
import crypto from "node:crypto";

export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ServiceAccount {
  email: string;
  /** PEM private key from the service account's JSON key */
  privateKey: string;
}

export type Fetch = typeof fetch;

/** The service account from the environment, or null when not configured. */
export function serviceAccountFromEnv(env: Record<string, string | undefined> = process.env): ServiceAccount | null {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !key) return null;
  // Hosting dashboards often store the key's line breaks as "\n".
  return { email, privateKey: key.replace(/\\n/g, "\n") };
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** The signed JWT a service account trades for an access token. */
export function signedAssertion(sa: ServiceAccount, scopes: string[], subject?: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.email,
      scope: scopes.join(" "),
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
      ...(subject && { sub: subject }),
    })
  );
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}

const cache = new Map<string, { token: string; expires: number }>();

export async function accessToken(
  sa: ServiceAccount,
  scopes: string[],
  subject?: string,
  fetchFn: Fetch = fetch
): Promise<string> {
  const key = `${sa.email}|${subject ?? ""}|${scopes.join(" ")}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion(sa, scopes, subject),
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${await res.text()}`);
  const { access_token, expires_in } = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!access_token) throw new Error("Google token response without access_token");
  cache.set(key, { token: access_token, expires: Date.now() + (expires_in ?? 3600) * 1000 });
  return access_token;
}

export function clearTokenCache() {
  cache.clear();
}
