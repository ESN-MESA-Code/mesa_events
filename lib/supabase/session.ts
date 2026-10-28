import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWorkspaceUser } from "@/lib/auth";
import type { AppRole } from "@/lib/roles";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type Db = SupabaseClient<Database>;

/** Per-request Supabase client bound to the signed-in user's cookies (RLS applies). */
export async function createSessionClient(): Promise<Db> {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component – the proxy refreshes the session instead.
        }
      },
    },
  });
}

export interface Viewer {
  id: string;
  email: string;
  name: string;
  /** Accepted the current confidentiality rules (public.is_workspace_member()). */
  accepted: boolean;
  /** Team roles, from the database (public.my_roles()), never from the client. */
  roles: AppRole[];
}

/** The signed-in Workspace member and their roles, or null. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isWorkspaceUser(user)) return null;
  const { data } = await supabase.rpc("my_context");
  const ctx = (data ?? {}) as { accepted?: boolean; roles?: AppRole[] };
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email!.toLowerCase(),
    name: String(meta.full_name ?? meta.name ?? "") || user.email!.split("@")[0],
    accepted: ctx.accepted === true,
    roles: ctx.accepted ? (ctx.roles ?? []) : [],
  };
});
