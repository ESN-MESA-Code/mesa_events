// Event categories and formats (round 2026-11-01): the Events team keeps
// the categories (never deleted, only hidden) and the formats (recurring
// events), and sorts past events into them. RLS and the RPCs check again.
import { z } from "zod";
import { dbError, defineAction, forbidden, notFound, PAGES, requireRole, uuid, ActionError } from "@/lib/actions/core";
import { EVENT_TYPES } from "@/lib/labels";

const SORTED = [PAGES.eventsTeam, PAGES.ideas, PAGES.event] as const;
const name = z.string().trim().min(1, "Required");
const eventType = z.enum(EVENT_TYPES as [string, ...string[]]).transform((t) => t as (typeof EVENT_TYPES)[number]);
const esnType = z.string().regex(/^\d{1,5}$/).nullable();

function duplicate(error: { code?: string; message: string } | null, what: string) {
  if (error?.code === "23505") throw forbidden(`There is a ${what} with this name already.`);
  if (error?.code === "22023") throw new ActionError("failed", error.message);
  dbError(error);
}

// ── Categories ──────────────────────────────────────────────────────────────

const categoryFields = {
  name: name.max(60),
  emoji: z.string().trim().max(16).default(""),
  esn_type: esnType.default(null),
  keywords: z.string().trim().max(2000).default(""),
};

export const addEventCategory = defineAction(z.object(categoryFields), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data: last } = await ctx.supabase.from("event_categories").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const { error } = await ctx.supabase.from("event_categories").insert({ ...i, sort: Math.min((last?.sort ?? 0) + 10, 32000) });
  duplicate(error, "category");
}, { revalidate: SORTED });

export const updateEventCategory = defineAction(
  z.object({ id: uuid, ...categoryFields, sort: z.number().int().min(0).max(32000).optional() }),
  async (ctx, { id, ...patch }) => {
    requireRole(ctx, "events");
    const { error, count } = await ctx.supabase.from("event_categories").update(patch, { count: "exact" }).eq("id", id);
    duplicate(error, "category");
    if (!count) throw notFound();
  },
  { revalidate: SORTED }
);

/** Categories are never deleted (events keep theirs); hidden ones leave the forms and the suggestions. */
export const setEventCategoryActive = defineAction(z.object({ id: uuid, active: z.boolean() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("event_categories").update({ active: i.active }, { count: "exact" }).eq("id", i.id);
  dbError(error);
  if (!count) throw notFound();
}, { revalidate: SORTED });

// ── Formats ─────────────────────────────────────────────────────────────────

const formatFields = {
  name: name.max(200),
  category_id: uuid.nullable(),
  type: eventType,
  helpers_needed: z.number().int().min(0).max(50),
  location: z.string().trim().max(300).nullable().default(null),
  meeting_point: z.string().trim().max(300).nullable().default(null),
};

export const createFormat = defineAction(z.object(formatFields), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data, error } = await ctx.supabase.from("event_formats").insert({ ...i, location: i.location || null, meeting_point: i.meeting_point || null }).select("id").single();
  duplicate(error, "format");
  return { id: data!.id };
}, { revalidate: SORTED });

export const updateFormat = defineAction(z.object({ id: uuid, ...formatFields }), async (ctx, { id, ...patch }) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("event_formats").update({ ...patch, location: patch.location || null, meeting_point: patch.meeting_point || null }, { count: "exact" }).eq("id", id);
  duplicate(error, "format");
  if (!count) throw notFound();
}, { revalidate: SORTED });

export const setFormatActive = defineAction(z.object({ id: uuid, active: z.boolean() }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error, count } = await ctx.supabase.from("event_formats").update({ active: i.active }, { count: "exact" }).eq("id", i.id);
  dbError(error);
  if (!count) throw notFound();
}, { revalidate: SORTED });

/** Moves the events and ideas of one format to another and hides the first. */
export const mergeFormats = defineAction(z.object({ from: uuid, into: uuid }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data, error } = await ctx.supabase.rpc("merge_formats", { from_format: i.from, into_format: i.into });
  duplicate(error, "format");
  return { moved: data as number };
}, { revalidate: SORTED });

// ── Sorting events ──────────────────────────────────────────────────────────

const sortItem = z.object({
  event_ids: z.array(uuid).min(1).max(500),
  category_id: uuid.nullable(),
  format_id: uuid.nullable(),
  new_format: z.object({ name: name.max(200), type: eventType, helpers_needed: z.number().int().min(0).max(50), location: z.string().trim().max(300).nullable() }).nullable(),
});

/** Events to a category and an existing or new format, many groups at once (one transaction). */
export const sortPastEvents = defineAction(z.object({ items: z.array(sortItem).min(1).max(1000) }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { data, error } = await ctx.supabase.rpc("sort_past_events", { items: i.items });
  duplicate(error, "format");
  return { sorted: data as number };
}, { revalidate: SORTED });

/** Takes events out of their format (they keep their category). */
export const unlinkEvents = defineAction(z.object({ event_ids: z.array(uuid).min(1).max(500) }), async (ctx, i) => {
  requireRole(ctx, "events");
  const { error } = await ctx.supabase.from("events").update({ format_id: null }).in("id", i.event_ids);
  dbError(error);
}, { revalidate: SORTED });
