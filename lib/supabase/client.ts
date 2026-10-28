import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cookie-based client so the session is shared with server code and the proxy.
export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
