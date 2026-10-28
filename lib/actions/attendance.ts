// Attendance lists: sign-off with a headcount, the risk notice.
import { z } from "zod";
import { dbError, defineAction, notFound, requireEventOc, requireEventStaff, uuid } from "@/lib/actions/core";

/** The OC closes the list with the number of people counted (final). */
export const signOffList = defineAction(z.object({ event_id: uuid, headcount: z.number().int().min(0).max(10_000) }), async (ctx, i) => {
  await requireEventOc(ctx, i.event_id);
  // signed_off_at / signed_off_by are set by the database (guard_attendance_list).
  const { error, count } = await ctx.supabase
    .from("attendance_lists")
    .update({ headcount: i.headcount, signed_off_at: new Date().toISOString(), signed_off_by: ctx.viewer.email }, { count: "exact" })
    .eq("event_id", i.event_id);
  dbError(error);
  if (!count) throw notFound();
});

/** Optional risk notice (e.g. hikes), shown above the terms; fixed once people signed in. */
export const setRiskNotice = defineAction(z.object({ event_id: uuid, risk_notice: z.string().trim().max(2000) }), async (ctx, i) => {
  await requireEventStaff(ctx, i.event_id);
  const { error, count } = await ctx.supabase
    .from("attendance_lists")
    .update({ risk_notice: i.risk_notice || null }, { count: "exact" })
    .eq("event_id", i.event_id);
  dbError(error);
  if (!count) throw notFound();
});
