// Access to the local Supabase stack (`npm run supabase:start`) for the DB and
// end-to-end tests. The keys are the fixed, public demo keys of every local
// Supabase stack – never production credentials.
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { TEST_MONTHS, TEST_TAG } from "../../scripts/clean-test-data.mjs";

export { TEST_MONTHS, TEST_TAG };

export const SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? "http://127.0.0.1:54421";
export const ANON_KEY =
  process.env.TEST_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const JWT_SECRET = process.env.TEST_SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
export const PASSWORD = "local-test-password";
export const JOBS_SECRET = "local-jobs-secret-not-for-production";

export type Db = SupabaseClient<Database>;

/** Members seeded by supabase/seed.sql. */
export const USERS = {
  member: { id: "a0000000-0000-4000-8000-000000000001", email: "member@esnmesa.org", name: "Mia Member" },
  oc: { id: "a0000000-0000-4000-8000-000000000002", email: "oc@esnmesa.org", name: "Olga Organiser" },
  helper: { id: "a0000000-0000-4000-8000-000000000003", email: "helper@esnmesa.org", name: "Hugo Helper" },
  events: { id: "a0000000-0000-4000-8000-000000000004", email: "events@esnmesa.org", name: "Eva Events" },
  comms: { id: "a0000000-0000-4000-8000-000000000005", email: "comms@esnmesa.org", name: "Cora Comms" },
  finance: { id: "a0000000-0000-4000-8000-000000000006", email: "finance@esnmesa.org", name: "Finn Finance" },
  treasurer: { id: "a0000000-0000-4000-8000-000000000007", email: "treasurer@esnmesa.org", name: "Theo Treasurer" },
  executive: { id: "a0000000-0000-4000-8000-000000000008", email: "executive@esnmesa.org", name: "Ezra Executive" },
  admin: { id: "a0000000-0000-4000-8000-000000000009", email: "admin@esnmesa.org", name: "Ada Admin" },
  volunteer1: { id: "a0000000-0000-4000-8000-00000000000a", email: "volunteer1@esnmesa.org", name: "Vera Volunteer" },
  volunteer2: { id: "a0000000-0000-4000-8000-00000000000b", email: "volunteer2@esnmesa.org", name: "Victor Volunteer" },
  newcomer: { id: "a0000000-0000-4000-8000-00000000000c", email: "newcomer@esnmesa.org", name: "Nora Newcomer" },
  signout: { id: "a0000000-0000-4000-8000-00000000000d", email: "signout@esnmesa.org", name: "Sam Signout" },
  hr: { id: "a0000000-0000-4000-8000-00000000000e", email: "hr@esnmesa.org", name: "Hana HR" },
  vp: { id: "a0000000-0000-4000-8000-00000000000f", email: "vp@esnmesa.org", name: "Valentin Vice" },
} as const;

export type SeedUser = (typeof USERS)[keyof typeof USERS];

export const admin: Db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export function anonClient(): Db {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
}

/** A client acting with `accessToken` (REST and realtime). */
export async function clientWithToken(accessToken: string): Promise<Db> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.realtime.setAuth(accessToken);
  return client;
}

/**
 * A JWT signed with the local stack's secret. PostgREST and realtime only
 * check the signature, so this acts as a seeded member without signing in
 * (no Auth rate limits). With a random `sub` and any email it is a forged
 * token for "what if someone got a token for another account" checks.
 */
export function signedJwt(claims: { sub: string; email: string; provider?: string; role?: string }) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    sub: claims.sub,
    role: claims.role ?? "authenticated",
    aud: "authenticated",
    email: claims.email,
    app_metadata: { provider: claims.provider ?? "google" },
    user_metadata: {},
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export function forgedJwt(email: string, provider = "google") {
  return signedJwt({ sub: crypto.randomUUID(), email, provider });
}

const clients = new Map<string, Db>();

/** A client acting as a seeded member (cached). */
export async function as(user: SeedUser): Promise<Db> {
  let c = clients.get(user.email);
  if (!c) {
    c = await clientWithToken(signedJwt({ sub: user.id, email: user.email }));
    clients.set(user.email, c);
  }
  return c;
}

/** Signs a seeded member in with their password (a real Auth session, for E2E cookies). */
export async function passwordSession(user: SeedUser) {
  const { data, error } = await anonClient().auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error("no session");
  return data.session;
}

export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
export const daysFromNow = (days: number) => hoursFromNow(days * 24);

/**
 * Test data is tagged (review 2026-10-29 A7): cycles live in test months
 * (before 2020 or from 2040 on, which no real or demo cycle uses), and the
 * helpers below mark what they create with created_by = TEST_TAG. The
 * suites' global setup/teardown (scripts/clean-test-data.mjs) removes
 * every tagged row with everything that depends on it.
 */
export const isTestMonth = (month: string) => month < TEST_MONTHS.before || month >= TEST_MONTHS.from;

/** A random far-future test month unused by other tests, as "YYYY-MM-01". */
export function testMonth(): string {
  const year = 2100 + Math.floor(Math.random() * 800);
  const month = 1 + Math.floor(Math.random() * 12);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** A random past test month (2000–2019), for cycles whose events really happened, as "YYYY-MM-01". */
export function pastTestMonth(): string {
  const year = 2000 + Math.floor(Math.random() * 20);
  const month = 1 + Math.floor(Math.random() * 12);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

export async function createCycle(extra: Partial<Database["public"]["Tables"]["planning_cycles"]["Insert"]> = {}) {
  for (let i = 0; i < 5; i++) {
    const res = await admin.from("planning_cycles").insert({ month: testMonth(), created_by: TEST_TAG, ...extra }).select().single();
    if (!res.error) return res.data;
  }
  throw new Error("Could not create a test cycle");
}

export interface EventSetup {
  title?: string;
  type?: Database["public"]["Enums"]["event_type"];
  status?: Database["public"]["Enums"]["event_status"];
  starts_at?: string;
  ends_at?: string | null;
  helpers_needed?: number;
  cycle_id?: string | null;
  oc?: SeedUser | null;
  helpers?: SeedUser[];
}

/** An event (service role) with its OC and helpers. Defaults: confirmed, in a week, no cycle. */
export async function createEvent(setup: EventSetup = {}) {
  const event = check(
    await admin
      .from("events")
      .insert({
        title: setup.title ?? `Test event ${crypto.randomUUID().slice(0, 8)}`,
        type: setup.type ?? "standard",
        status: setup.status ?? "confirmed",
        starts_at: setup.starts_at ?? daysFromNow(7),
        ends_at: setup.ends_at ?? null,
        helpers_needed: setup.helpers_needed ?? 2,
        cycle_id: setup.cycle_id ?? null,
        location: "Test venue",
        created_by: TEST_TAG,
      })
      .select()
      .single(),
    "createEvent"
  );
  const rows = [
    ...(setup.oc ? [{ event_id: event.id, profile_id: setup.oc.id, role: "oc", source: "manual" }] : []),
    ...(setup.helpers ?? []).map((h) => ({ event_id: event.id, profile_id: h.id, role: "helper", source: "manual" })),
  ];
  if (rows.length) check(await admin.from("assignments").insert(rows), "assignments");
  return event;
}

export async function deleteEvent(id: string) {
  await admin.from("events").delete().eq("id", id);
}

/** Calls the app's job runner route on the running app (E2E) or nothing. */
export async function runJobsOverHttp(baseURL: string) {
  const res = await fetch(`${baseURL}/api/jobs/run`, { method: "POST", headers: { Authorization: `Bearer ${JOBS_SECRET}` } });
  if (!res.ok) throw new Error(`Job runner: ${res.status}`);
  return res.json();
}

/**
 * The @supabase/ssr auth cookies for a session on the app's origin, chunked
 * the way the library writes them.
 */
export function sessionCookies(session: object, baseURL: string) {
  const name = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const CHUNK = 3180;
  const parts =
    value.length <= CHUNK
      ? [{ name, value }]
      : Array.from({ length: Math.ceil(value.length / CHUNK) }, (_, i) => ({
          name: `${name}.${i}`,
          value: value.slice(i * CHUNK, (i + 1) * CHUNK),
        }));
  return parts.map((p) => ({ ...p, url: baseURL, sameSite: "Lax" as const }));
}
