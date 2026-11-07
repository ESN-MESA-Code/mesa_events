// Reliability (2026-11-07): the OC reports who was missing after an event,
// the Events team marks events non-crucial, and the Events team and HR keep
// the blacklist. The database checks who may do what
// (20261107000200_reliability.sql); the role checks here give clearer errors.
import { z } from "zod";
import { dbError, defineAction, forbidden, PAGES, requireEventOc, requireRole, uuid } from "@/lib/actions/core";
import { hasRole } from "@/lib/roles";
import { ATTENDANCE_OUTCOMES } from "@/lib/reliability";

/** The OC (or the Events team) reports that someone of the team was missing, and why. */
export const reportAttendance = defineAction(
  z.object({ event_id: uuid, assignment_id: uuid, outcome: z.enum(ATTENDANCE_OUTCOMES), note: z.string().trim().max(500).optional() }),
  async (ctx, i) => {
    await requireEventOc(ctx, i.event_id);
    dbError((await ctx.supabase.rpc("report_attendance", { assignment: i.assignment_id, outcome: i.outcome, note: i.note || undefined })).error);
  },
  { revalidate: [PAGES.event, PAGES.reliability] }
);

/** Takes a report back: they were there after all. */
export const clearAttendanceReport = defineAction(z.object({ event_id: uuid, assignment_id: uuid }), async (ctx, i) => {
  await requireEventOc(ctx, i.event_id);
  dbError((await ctx.supabase.rpc("clear_attendance_report", { assignment: i.assignment_id })).error);
}, { revalidate: [PAGES.event, PAGES.reliability] });

/** The Events team marks an event non-crucial: people on the blacklist may help on it. */
export const setNonCrucial = defineAction(z.object({ event_id: uuid, non_crucial: z.boolean() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("events").update({ non_crucial: i.non_crucial }, { count: "exact" }).eq("id", i.event_id);
  dbError(error);
  if (!count) throw forbidden("This event cannot be changed.");
}, { revalidate: [PAGES.eventsTeam, PAGES.event] });

function requireBlacklistKeeper(roles: Parameters<typeof hasRole>[0]) {
  if (!hasRole(roles, "events") && !hasRole(roles, "hr")) throw forbidden("Only the Events team and HR keep the blacklist.");
}

export const addToBlacklist = defineAction(
  z.object({ profile_id: uuid, reason: z.string().trim().min(1, "Give a reason").max(500) }),
  async (ctx, i) => {
    requireBlacklistKeeper(ctx.viewer.roles);
    dbError((await ctx.supabase.rpc("blacklist_add", { profile: i.profile_id, reason: i.reason })).error);
  },
  { revalidate: [PAGES.reliability, PAGES.eventsTeam] }
);

export const removeFromBlacklist = defineAction(
  z.object({ profile_id: uuid, note: z.string().trim().max(500).optional() }),
  async (ctx, i) => {
    requireBlacklistKeeper(ctx.viewer.roles);
    dbError((await ctx.supabase.rpc("blacklist_remove", { profile: i.profile_id, note: i.note || undefined })).error);
  },
  { revalidate: [PAGES.reliability, PAGES.eventsTeam] }
);
