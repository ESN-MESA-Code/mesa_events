// Event descriptions: the month's deadline, editing, Comms review, publishing.
import { z } from "zod";
import { dbError, defineAction, notFound, requireRole, uuid } from "@/lib/actions/core";
import { localDateTime } from "@/lib/actions/planning";

/** One description deadline per cycle, set by Events, for all its events. */
export const setDescriptionDeadline = defineAction(z.object({ cycle_id: uuid, deadline: localDateTime.nullable() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("planning_cycles").update({ description_deadline: i.deadline }, { count: "exact" }).eq("id", i.cycle_id);
  dbError(error);
  if (!count) throw notFound();
});
