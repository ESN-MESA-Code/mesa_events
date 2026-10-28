// The service-role client: bypasses RLS. Server only (job runner, role sync,
// auth callback) – the key has no NEXT_PUBLIC_ prefix, so it never reaches
// the browser bundle (tests/bundle/bundle.test.ts checks).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let client: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}
