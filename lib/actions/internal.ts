// Internal events, meetings and office hours (round 2026-10-30): HR and the
// Vice President schedule them and assign OC and helpers; members sign up
// to internal events. RLS (public.is_internal_planner()) checks again.
import crypto from "node:crypto";
import { z } from "zod";
import { ActionError, dbError, defineAction, forbidden, notFound, PAGES, uuid, type ActionContext } from "@/lib/actions/core";
import { localDateTime } from "@/lib/actions/planning";
import { berlinInputToIso } from "@/lib/dates";
import { INTERNAL_KINDS, isStaffed, type InternalKind } from "@/lib/internal";
import { isInternalPlanner } from "@/lib/roles";

const kind = z.enum(INTERNAL_KINDS as [InternalKind, ...InternalKind[]]);
const title = z.string().trim().min(1, "Required").max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date (YYYY-MM-DD)");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time (HH:MM)");
const presentation = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S{3,}$/.test(v), "Use an https:// link")
  .transform((v) => v || null);
const details = {
  location: z.string().trim().max(300).optional(),
  note: z.string().trim().max(2000).optional(),
  presentation_url: presentation.nullable().optional(),
  capacity: z.number().int().min(1).max(10_000).nullable().optional(),
  helpers_needed: z.number().int().min(0).max(20).optional(),
};
const PLANNING = [PAGES.internal, PAGES.home, PAGES.me, PAGES.calendar, PAGES.officeHours, PAGES.internalEvent] as const;

function requirePlanner(ctx: ActionContext) {
  if (!isInternalPlanner(ctx.viewer!.roles)) throw forbidden("Only HR and the Vice President plan internal events.");
}

/** One date, e.g. dragged from the palette onto a day (title, times and helpers default to the kind's settings). */
export const createInternalEvent = defineAction(
  z.object({ kind, title: title.optional(), starts_at: localDateTime, ends_at: localDateTime.nullable().optional(), ...details }),
  async (ctx, i) => {
    requirePlanner(ctx);
    const { data: settings } = await ctx.supabase.from("internal_kind_settings").select("default_title, helpers_needed").eq("kind", i.kind).single();
    const { data, error } = await ctx.supabase
      .from("internal_events")
      .insert({
        kind: i.kind,
        title: i.title ?? settings?.default_title ?? i.kind,
        starts_at: i.starts_at,
        ends_at: i.ends_at ?? null,
        location: i.location ?? "",
        note: i.note ?? "",
        presentation_url: i.presentation_url ?? null,
        capacity: i.kind === "internal" ? (i.capacity ?? null) : null,
        helpers_needed: isStaffed(i.kind) ? (i.helpers_needed ?? settings?.helpers_needed ?? 0) : 0,
      })
      .select("id")
      .single();
    dbError(error);
    return { id: data!.id };
  },
  { revalidate: PLANNING }
);

/** "Repeat": the same kind, time and details on several days, e.g. every Thursday of the semester (one series). */
export const createInternalSeries = defineAction(
  z.object({ kind, title, days: z.array(isoDate).min(1).max(200), start: clock, minutes: z.number().int().min(15).max(1440), ...details }),
  async (ctx, i) => {
    requirePlanner(ctx);
    const series = crypto.randomUUID();
    const rows = [...new Set(i.days)].sort().map((day) => {
      const starts = berlinInputToIso(`${day}T${i.start}`);
      return {
        kind: i.kind,
        title: i.title,
        starts_at: starts,
        ends_at: new Date(Date.parse(starts) + i.minutes * 60_000).toISOString(),
        location: i.location ?? "",
        note: i.note ?? "",
        presentation_url: i.presentation_url ?? null,
        capacity: i.kind === "internal" ? (i.capacity ?? null) : null,
        helpers_needed: isStaffed(i.kind) ? (i.helpers_needed ?? 0) : 0,
        series_id: series,
      };
    });
    const { error } = await ctx.supabase.from("internal_events").insert(rows);
    dbError(error);
    return { created: rows.length, series_id: series };
  },
  { revalidate: PLANNING }
);

/** Details, times (moving to another day keeps them) or cancelling. The kind stays. */
export const updateInternalEvent = defineAction(
  z.object({ id: uuid, title: title.optional(), starts_at: localDateTime.optional(), ends_at: localDateTime.nullable().optional(), status: z.enum(["scheduled", "cancelled"]).optional(), ...details }),
  async (ctx, { id, ...patch }) => {
    requirePlanner(ctx);
    const { data: row } = await ctx.supabase.from("internal_events").select("kind").eq("id", id).maybeSingle();
    if (!row) throw notFound();
    if (row.kind !== "internal") delete patch.capacity;
    if (!isStaffed(row.kind)) delete patch.helpers_needed;
    const { error, count } = await ctx.supabase.from("internal_events").update(patch, { count: "exact" }).eq("id", id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: PLANNING }
);

/** Removes a date (or the rest of its series from it on). A date whose cash box was started stays – cancel it instead. */
export const deleteInternalEvent = defineAction(
  z.object({ id: uuid, following: z.boolean().optional() }),
  async (ctx, i) => {
    requirePlanner(ctx);
    const { data: row } = await ctx.supabase.from("internal_events").select("series_id, starts_at").eq("id", i.id).maybeSingle();
    if (!row) throw notFound();
    let query = ctx.supabase.from("internal_events").delete({ count: "exact" });
    query = i.following && row.series_id ? query.eq("series_id", row.series_id).gte("starts_at", row.starts_at) : query.eq("id", i.id);
    const { error, count } = await query;
    if (error?.code === "23503") throw forbidden("Its cash box was used – cancel the date instead.");
    dbError(error);
    return { deleted: count ?? 0 };
  },
  { revalidate: PLANNING }
);

const role = z.enum(["oc", "helper"]);

export const assignInternal = defineAction(
  z.object({ internal_event_id: uuid, profile_id: uuid, role }),
  async (ctx, i) => {
    requirePlanner(ctx);
    const { error } = await ctx.supabase.from("internal_event_people").insert(i);
    if (error?.code === "23505") throw forbidden(i.role === "oc" ? "There is an OC already – move them away first." : "This person is on the list already.");
    dbError(error);
  },
  { revalidate: PLANNING }
);

/** Drag an assigned person to another slot or date. */
export const moveInternalPerson = defineAction(
  z.object({ person_id: uuid, internal_event_id: uuid, role }),
  async (ctx, i) => {
    requirePlanner(ctx);
    const { error, count } = await ctx.supabase.from("internal_event_people").update({ internal_event_id: i.internal_event_id, role: i.role }, { count: "exact" }).eq("id", i.person_id);
    if (error?.code === "23505") throw forbidden(i.role === "oc" ? "There is an OC already – move them away first." : "This person is on the list already.");
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: PLANNING }
);

export const unassignInternal = defineAction(
  z.object({ person_id: uuid }),
  async (ctx, i) => {
    requirePlanner(ctx);
    const { error, count } = await ctx.supabase.from("internal_event_people").delete({ count: "exact" }).eq("id", i.person_id);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: PLANNING }
);

export const updateKindSettings = defineAction(
  z.object({
    kind,
    default_title: title,
    default_start: clock,
    default_minutes: z.number().int().min(15).max(1440),
    helpers_needed: z.number().int().min(0).max(20),
    description: z.string().trim().max(4000),
  }),
  async (ctx, { kind: k, ...patch }) => {
    requirePlanner(ctx);
    const { error, count } = await ctx.supabase.from("internal_kind_settings").update(patch, { count: "exact" }).eq("kind", k);
    dbError(error);
    if (!count) throw notFound();
  },
  { revalidate: PLANNING }
);

export const signUpInternal = defineAction(
  z.object({ internal_event_id: uuid }),
  async (ctx, i) => {
    dbError((await ctx.supabase.rpc("sign_up_internal", { internal_event: i.internal_event_id })).error);
  },
  { revalidate: [PAGES.internalEvent, PAGES.home, PAGES.calendar, PAGES.internal] }
);

export const withdrawInternal = defineAction(
  z.object({ internal_event_id: uuid }),
  async (ctx, i) => {
    dbError((await ctx.supabase.rpc("withdraw_internal", { internal_event: i.internal_event_id })).error);
  },
  { revalidate: [PAGES.internalEvent, PAGES.home, PAGES.calendar, PAGES.internal] }
);


// ── Attendance of Tuesday Talks and internal events (round 2026-11-03 (2)) ──
// Members check in with the rotating code on HR's screen; HR adds and removes
// anyone and closes the list. The database checks every rule again.
const ATTENDANCE = [PAGES.internalEvent, PAGES.activity] as const;

/** The code HR's screen shows now (changes every 20 seconds). */
export const checkinCode = defineAction(
  z.object({ internal_event_id: uuid }),
  async (ctx, i) => {
    const { data, error } = await ctx.supabase.rpc("checkin_code", { internal_event: i.internal_event_id });
    dbError(error);
    const row = (data ?? [])[0];
    if (!row) throw notFound();
    // How many have checked in, for the screen.
    const { count } = await ctx.supabase.from("internal_attendance").select("profile_id", { count: "exact", head: true }).eq("internal_event_id", i.internal_event_id).is("removed_at", null);
    return { token: row.token, code: row.code, secondsLeft: row.seconds_left, count: count ?? 0 };
  },
  { revalidate: [] }
);

/** A member checks in with the scanned token or the typed four digits. */
export const checkInInternal = defineAction(
  z.object({ internal_event_id: uuid, token: z.string().max(200).optional(), code: z.string().trim().regex(/^\d{4}$/, "Type the four digits on the screen").optional() }),
  async (ctx, i) => {
    const { data, error } = await ctx.supabase.rpc("check_in_internal", { internal_event: i.internal_event_id, token: i.token, code: i.code });
    dbError(error);
    // A wrong code is counted by the database (five tries), not raised.
    if (data === "wrong") throw new ActionError("failed", "Wrong or expired code – type the one on the screen now");
    return { result: data as "checked_in" | "already" };
  },
  { revalidate: ATTENDANCE }
);

/** HR adds someone (present) or takes a check-in back. */
export const markInternalAttendance = defineAction(
  z.object({ internal_event_id: uuid, profile_id: uuid, present: z.boolean() }),
  async (ctx, i) => {
    dbError((await ctx.supabase.rpc("mark_internal_attendance", { internal_event: i.internal_event_id, profile: i.profile_id, present: i.present })).error);
  },
  { revalidate: ATTENDANCE }
);

/** HR closes the list (no more check-ins) or opens it again. */
export const closeInternalAttendance = defineAction(
  z.object({ internal_event_id: uuid, closed: z.boolean() }),
  async (ctx, i) => {
    dbError((await ctx.supabase.rpc("close_internal_attendance", { internal_event: i.internal_event_id, closed: i.closed })).error);
  },
  { revalidate: ATTENDANCE }
);
