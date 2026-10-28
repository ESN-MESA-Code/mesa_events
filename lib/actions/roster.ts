// Roster changes after confirmation: dropping out, claiming open slots, the
// OC's decision on an under-staffed event, Chat spaces on request.
import { z } from "zod";
import { dbError, defineAction, forbidden, notFound, requireEventOc, requireRole, uuid } from "@/lib/actions/core";

export const dropOut = defineAction(z.object({ assignment_id: uuid, reason: z.string().trim().max(500).optional() }), async (ctx, i) => {
  const { error } = await ctx.supabase.rpc("drop_out", { assignment: i.assignment_id, reason: i.reason ?? undefined });
  dbError(error);
});

export const claimSlot = defineAction(z.object({ event_id: uuid, role: z.enum(["oc", "helper"]) }), async (ctx, i) => {
  const { data, error } = await ctx.supabase.rpc("claim_slot", { event: i.event_id, slot_role: i.role });
  dbError(error);
  return { assignment_id: data as string };
});

/** The OC (or Events) decides whether an under-staffed event runs. */
export const decideUnderstaffed = defineAction(z.object({ event_id: uuid, decision: z.enum(["run", "cancel"]) }), async (ctx, i) => {
  await requireEventOc(ctx, i.event_id);
  const { data: event } = await ctx.supabase.from("events").select("status").eq("id", i.event_id).single();
  if (!event) throw notFound();
  if (event.status !== "understaffed") throw forbidden("Only under-staffed events need this decision.");
  const { error } = await ctx.supabase
    .from("events")
    .update({ status: i.decision === "run" ? "confirmed" : "cancelled" })
    .eq("id", i.event_id);
  dbError(error);
});

export const requestChatSpace = defineAction(z.object({ event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("request_chat_space", { event: i.event_id })).error);
});
