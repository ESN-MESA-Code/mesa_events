// Event descriptions: the month's deadline, editing (autosave), Comms
// review, publishing.
import { z } from "zod";
import { ActionError, dbError, defineAction, PAGES, notFound, requireRole, uuid } from "@/lib/actions/core";
import { localDateTime } from "@/lib/actions/planning";
import { coerceFields, renderDescription, validateAll, TEXT_FIELDS } from "@/lib/description/template";
import { berlinDate, nowMs } from "@/lib/dates";

/** One description deadline per cycle, set by Events, for all its events. */
export const setDescriptionDeadline = defineAction(z.object({ cycle_id: uuid, deadline: localDateTime.nullable() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("planning_cycles").update({ description_deadline: i.deadline }, { count: "exact" }).eq("id", i.cycle_id);
  dbError(error);
  if (!count) throw notFound();
}, { revalidate: [PAGES.eventsTeam, PAGES.comms, PAGES.event, PAGES.home] });

const patchSchema = z
  .object(Object.fromEntries(TEXT_FIELDS.map((k) => [k, z.string().max(6000).optional()])) as Record<(typeof TEXT_FIELDS)[number], z.ZodOptional<z.ZodString>>)
  .extend({ weather: z.boolean().optional() })
  .strict();

/** Autosave: merges the changed fields (others' edits to other fields stay). */
export const saveDescription = defineAction(z.object({ event_id: uuid, patch: patchSchema }), async (ctx, i) => {
  const { data, error } = await ctx.supabase.rpc("save_description", { event: i.event_id, patch: i.patch });
  dbError(error);
  const row = data?.[0];
  return { version: row?.version ?? 0, status: row?.status ?? "draft" };
}, { revalidate: [] });

async function currentFields(ctx: Parameters<typeof saveDescription>[0], eventId: string) {
  const { data } = await ctx.supabase.from("descriptions").select("fields, status").eq("event_id", eventId).maybeSingle();
  if (!data) throw notFound("There is no description yet.");
  return { fields: coerceFields(data.fields), status: data.status };
}

/** Submits for Comms review – only a complete description within the limit. */
export const submitDescription = defineAction(z.object({ event_id: uuid }), async (ctx, i) => {
  const { fields } = await currentFields(ctx, i.event_id);
  const v = validateAll(fields, berlinDate(new Date(nowMs()).toISOString()));
  if (!v.ok) throw new ActionError("failed", `Not complete yet: ${Object.values(v.errors).flat().join(" ")}`);
  const { error } = await ctx.supabase.rpc("submit_description", { event: i.event_id, rendered: renderDescription(fields).chat });
  dbError(error);
}, { revalidate: [PAGES.event, PAGES.comms, PAGES.home] });

export const reviewDescription = defineAction(
  z.object({ event_id: uuid, decision: z.enum(["approved", "changes_requested"]), comment: z.string().trim().max(4000).default("") }),
  async (ctx, i) => {
    requireRole(ctx, "comms");
    const { fields } = await currentFields(ctx, i.event_id);
    if (i.decision === "approved") {
      const v = validateAll(fields);
      if (!v.ok) throw new ActionError("failed", "The description is not complete – request changes instead.");
    }
    const { error } = await ctx.supabase.rpc("review_description", {
      event: i.event_id,
      decision: i.decision,
      comment: i.comment,
      rendered: renderDescription(fields).chat,
    });
    dbError(error);
  },
  { revalidate: [PAGES.event, PAGES.comms, PAGES.home] }
);

export const publishDescription = defineAction(z.object({ event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("publish_description", { event: i.event_id })).error);
}, { revalidate: [PAGES.event, PAGES.comms, PAGES.home] });
