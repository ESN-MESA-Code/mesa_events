// Builds the action context from the request (cookies) – only used by the
// "use server" files – and revalidates the pages the action declared.
import { revalidatePath } from "next/cache";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import type { Action, ActionResult } from "@/lib/actions/core";

export async function run<R>(action: Action<R>, raw: unknown): Promise<ActionResult<R>> {
  const [supabase, viewer] = await Promise.all([createSessionClient(), getViewer()]);
  const result = await action({ supabase, viewer }, raw);
  if (result.ok) {
    for (const target of action.revalidate) {
      if (typeof target === "string") revalidatePath(target);
      else revalidatePath(target[0], target[1]);
    }
  }
  return result;
}
