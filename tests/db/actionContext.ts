// The server-action context of a seeded member, built the way the app does
// (lib/actions/run.ts): their own Supabase client, roles from my_context().
import { as, type SeedUser } from "../helpers/local";
import type { ActionContext } from "@/lib/actions/core";
import type { AppRole } from "@/lib/roles";

export async function actionContext(user: SeedUser): Promise<ActionContext> {
  const supabase = await as(user);
  const { data } = await supabase.rpc("my_context");
  const c = (data ?? {}) as { accepted?: boolean; roles?: AppRole[] };
  return {
    supabase,
    viewer: { id: user.id, email: user.email, accepted: c.accepted === true, roles: c.accepted ? (c.roles ?? []) : [] },
  };
}
