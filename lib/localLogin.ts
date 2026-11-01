// "Local test sign-in" for `npm run dev:local`: Google sign-in cannot work
// against the local Supabase stack, so the login page offers the personas of
// the demo data (`npm run seed:staging`, the same data as on staging) and the
// test accounts of supabase/seed.sql – one per role each.
//
// It can never be on in a production build: Next.js inlines NODE_ENV
// ("production" in every `next build`), so the check below is constant-false
// there and the code is dropped. It also needs NEXT_PUBLIC_LOCAL_LOGIN=true
// and a Supabase on this machine (tests/unit/localLogin.test.ts,
// tests/bundle/bundle.test.ts).

import { PERSONAS, demoEmail, person } from "@/lib/staging/people";

export interface LocalUser {
  email: string;
  label: string;
}

const DEMO_DOMAIN = (process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || "esnmesa.org").toLowerCase();

/** The demo data's personas (lib/staging/people.ts): they sign in with their derived password. */
export const LOCAL_DEMO_USERS: LocalUser[] = PERSONAS.map((p) => ({ email: demoEmail(person(p.person), DEMO_DOMAIN), label: `${p.label} – ${person(p.person).name}` }));

/** Seeded members (supabase/seed.sql), local stack only. */
export const LOCAL_USERS: LocalUser[] = [
  { email: "member@esnmesa.org", label: "Member" },
  { email: "oc@esnmesa.org", label: "OC (of the demo events)" },
  { email: "helper@esnmesa.org", label: "Helper (of the demo events)" },
  { email: "volunteer1@esnmesa.org", label: "Volunteer 1" },
  { email: "volunteer2@esnmesa.org", label: "Volunteer 2" },
  { email: "events@esnmesa.org", label: "Events team" },
  { email: "comms@esnmesa.org", label: "Comms team" },
  { email: "finance@esnmesa.org", label: "Finance team" },
  { email: "treasurer@esnmesa.org", label: "Treasurer" },
  { email: "executive@esnmesa.org", label: "Executive" },
  { email: "hr@esnmesa.org", label: "HR (internal events)" },
  { email: "vp@esnmesa.org", label: "Vice President (internal events)" },
  { email: "admin@esnmesa.org", label: "Admin (IT)" },
  { email: "newcomer@esnmesa.org", label: "Newcomer (rules not accepted)" },
];

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url ?? "").hostname);
  } catch {
    return false;
  }
}

export function localLoginEnabled(
  env: { NODE_ENV?: string; NEXT_PUBLIC_LOCAL_LOGIN?: string; NEXT_PUBLIC_SUPABASE_URL?: string } = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_LOCAL_LOGIN: process.env.NEXT_PUBLIC_LOCAL_LOGIN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }
): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.NEXT_PUBLIC_LOCAL_LOGIN === "true" && isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
}

export function isLocalUser(email: string): boolean {
  return LOCAL_USERS.some((u) => u.email === email);
}

export function isLocalDemoUser(email: string): boolean {
  return LOCAL_DEMO_USERS.some((u) => u.email === email);
}
