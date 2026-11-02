// The advertising still to do, as Home loads it (round 2026-11-02, -03):
// upcoming events of this month and those the board lists ahead
// (AHEAD_MONTHS) still to plan on a channel, or without their pretix page.
// RLS: Comms, Events and executives read posts.
import type { Db } from "@/lib/supabase/session";
import { addMonths, berlinDate, monthOf, monthStartIso } from "@/lib/dates";
import { AHEAD_MONTHS, PUBLISHABLE_STATUSES, stillToPlan } from "@/lib/publishing";

export interface AdvertisingWork {
  /** Upcoming events still missing a required advertising channel. */
  toPlan: Array<{ id: string; startsAt: string }>;
  /** Upcoming events whose pretix page is not ticked yet (none while pretix is switched off). */
  pretix: Array<{ id: string; startsAt: string }>;
}

export async function loadStillToPlan(supabase: Db, now: number): Promise<AdvertisingWork> {
  const nowIso = new Date(now).toISOString();
  const [{ data: events }, { data: channels }] = await Promise.all([
    supabase
      .from("events")
      .select("id, starts_at")
      .in("status", [...PUBLISHABLE_STATUSES])
      .eq("source", "platform")
      .gt("starts_at", nowIso)
      .lt("starts_at", monthStartIso(addMonths(monthOf(nowIso), AHEAD_MONTHS + 1)))
      .order("starts_at"),
    supabase.from("publication_channels").select("key, schedulable, required").eq("enabled", true),
  ]);
  const required = (channels ?? []).filter((c) => c.schedulable && c.required).map((c) => c.key);
  const pretixOn = (channels ?? []).some((c) => c.key === "pretix");
  const list = (events ?? []).map((e) => ({ id: e.id, startsAt: e.starts_at }));
  if (!list.length) return { toPlan: [], pretix: [] };
  const { data: rows } = await supabase.from("publication_post_events").select("event_id, publication_posts!inner(channel, status)").in("event_id", list.map((e) => e.id));
  const posts = (rows ?? []).map((r) => ({ channel: r.publication_posts.channel, status: r.publication_posts.status, events: [r.event_id] }));
  const ticked = new Set(posts.filter((p) => p.channel === "pretix" && p.status === "published").flatMap((p) => p.events));
  return {
    toPlan: required.length ? stillToPlan(list, posts, required, berlinDate(nowIso)) : [],
    // pretix comes before the advertising (round 2026-11-03).
    pretix: pretixOn ? list.filter((e) => !ticked.has(e.id)) : [],
  };
}

/**
 * The default picture of each event (round 2026-11-03): its format's, else
 * its type's (the Pictures tab); null when neither has one.
 */
export async function loadDefaultPictures(db: Db, events: Array<{ id: string; format_id: string | null; type: string }>): Promise<Map<string, string | null>> {
  if (!events.length) return new Map();
  const { data } = await db.from("advertising_pictures").select("format_id, event_type, picture");
  const byFormat = new Map((data ?? []).filter((d) => d.format_id).map((d) => [d.format_id!, d.picture]));
  const byType = new Map((data ?? []).filter((d) => d.event_type).map((d) => [d.event_type as string, d.picture]));
  return new Map(events.map((e) => [e.id, (e.format_id ? byFormat.get(e.format_id) : undefined) ?? byType.get(e.type) ?? null]));
}
