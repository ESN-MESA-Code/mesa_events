// The demo members' passwords: derived from the service-role key, so only
// the server (sign-in route, seed) can compute them. The anon key is public,
// and Supabase Auth would let anyone sign in with a known password – which
// would skip the staging access code. Server only.
import { createHmac } from "node:crypto";

export function demoPassword(email: string, serviceRoleKey: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY): string {
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createHmac("sha256", serviceRoleKey).update(`mesa-staging-demo-password:v1:${email.toLowerCase()}`).digest("base64url");
}
