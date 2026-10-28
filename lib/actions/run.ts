// Builds the action context from the request (cookies) – only used by the
// "use server" files.
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import type { ActionContext, ActionResult } from "@/lib/actions/core";

export async function run<R>(
  action: (ctx: ActionContext, raw: unknown) => Promise<ActionResult<R>>,
  raw: unknown
): Promise<ActionResult<R>> {
  const [supabase, viewer] = await Promise.all([createSessionClient(), getViewer()]);
  return action({ supabase, viewer }, raw);
}
