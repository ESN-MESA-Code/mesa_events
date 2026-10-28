import crypto from "node:crypto";

/**
 * Whether the request carries "Authorization: Bearer <JOBS_SECRET>". Compared
 * in constant time; refuses everything while no (long enough) secret is set.
 */
export function hasJobsSecret(authorization: string | null, secret = process.env.JOBS_SECRET): boolean {
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization ?? "");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
