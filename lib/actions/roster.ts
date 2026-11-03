// Roster changes after confirmation: dropping out, claiming open slots, the
// OC's decision on an under-staffed event, cancelling (the OC asks, the
// Events team decides – round 2026-11-03) and reopening, Chat spaces on
// request.
import { z } from "zod";
import { dbError, defineAction, PAGES, forbidden, notFound, requireEventOc, requireRole, uuid } from "@/lib/actions/core";

export const dropOut = defineAction(z.object({ assignment_id: uuid, reason: z.string().trim().max(500).optional() }), async (ctx, i) => {
  const { error } = await ctx.supabase.rpc("drop_out", { assignment: i.assignment_id, reason: i.reason ?? undefined });
  dbError(error);
}, { revalidate: [PAGES.event, PAGES.calendar, PAGES.me, PAGES.home, PAGES.eventsTeam] });

export const claimSlot = defineAction(z.object({ event_id: uuid, role: z.enum(["oc", "helper"]) }), async (ctx, i) => {
  const { data, error } = await ctx.supabase.rpc("claim_slot", { event: i.event_id, slot_role: i.role });
  dbError(error);
  return { assignment_id: data as string };
}, { revalidate: [PAGES.event, PAGES.calendar, PAGES.me, PAGES.home, PAGES.eventsTeam] });

/**
 * The OC (or Events) decides whether an under-staffed event runs. "Run" is
 * stored on the event and holds through later roster changes until the
 * event loses its OC (decide_understaffed()).
 */
export const decideUnderstaffed = defineAction(z.object({ event_id: uuid, decision: z.enum(["run", "cancel"]) }), async (ctx, i) => {
  await requireEventOc(ctx, i.event_id);
  const { data: event } = await ctx.supabase.from("events").select("status").eq("id", i.event_id).single();
  if (!event) throw notFound();
  if (event.status !== "understaffed") throw forbidden("Only under-staffed events need this decision.");
  dbError((await ctx.supabase.rpc("decide_understaffed", { event: i.event_id, decision: i.decision })).error);
}, { revalidate: [PAGES.event, PAGES.calendar, PAGES.me, PAGES.home, PAGES.eventsTeam, PAGES.comms] });

/** The Events team cancels a running event; the team and the Chat space are told (cancel_event()). */
export const cancelEvent = defineAction(z.object({ event_id: uuid, reason: z.string().trim().max(300).optional() }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("cancel_event", { event: i.event_id, reason: i.reason || undefined })).error);
}, { revalidate: [PAGES.event, PAGES.calendar, PAGES.me, PAGES.home, PAGES.eventsTeam, PAGES.comms] });

/** The OC asks the Events team to cancel, with a reason; the Events team is mentioned in Chat (request_cancellation()). */
export const requestCancellation = defineAction(z.object({ event_id: uuid, reason: z.string().trim().min(1, "Say why the event should be cancelled.").max(300) }), async (ctx, i) => {
  // The Events team cancels directly; asking is the OC's.
  await requireEventOc(ctx, i.event_id, null);
  dbError((await ctx.supabase.rpc("request_cancellation", { event: i.event_id, reason: i.reason })).error);
}, { revalidate: [PAGES.event, PAGES.eventsTeam] });

/** The Events team cancels the event or keeps it on (a note for the OC); the OC withdraws the request. */
export const decideCancellation = defineAction(
  z.object({ request_id: uuid, decision: z.enum(["cancelled", "declined", "withdrawn"]), note: z.string().trim().max(300).optional() }),
  async (ctx, i) => {
    if (i.decision !== "withdrawn") requireRole(ctx, "events");
    dbError((await ctx.supabase.rpc("decide_cancellation", { request: i.request_id, decision: i.decision, note: i.note || undefined })).error);
  },
  { revalidate: [PAGES.event, PAGES.calendar, PAGES.me, PAGES.home, PAGES.eventsTeam, PAGES.comms] }
);

/** The Events team reopens a cancelled event: back to the status its staffing gives. */
export const reopenEvent = defineAction(z.object({ event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data, error } = await ctx.supabase.rpc("reopen_event", { event: i.event_id });
  dbError(error);
  return { status: data as string };
}, { revalidate: [PAGES.event, PAGES.calendar, PAGES.me, PAGES.home, PAGES.eventsTeam, PAGES.comms] });

export const requestChatSpace = defineAction(z.object({ event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  dbError((await ctx.supabase.rpc("request_chat_space", { event: i.event_id })).error);
}, { revalidate: [PAGES.event] });
