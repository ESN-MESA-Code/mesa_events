// The upcoming events still to plan on the schedule, as Home loads them
// (round 2026-11-02): this month's and those the board lists ahead
// (AHEAD_MONTHS) – big events are advertised weeks before. RLS: Comms,
// Events and executives read posts.
import type { Db } from "@/lib/supabase/session";
import { addMonths, berlinDate, monthOf, monthStartIso } from "@/lib/dates";
import { AHEAD_MONTHS, PUBLISHABLE_STATUSES, stillToPlan } from "@/lib/publishing";

export async function loadStillToPlan(supabase: Db, now: number): Promise<Array<{ id: string; startsAt: string }>> {
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
    supabase.from("publication_channels").select("key").eq("enabled", true).eq("schedulable", true).eq("required", true),
  ]);
  const required = (channels ?? []).map((c) => c.key);
  const list = (events ?? []).map((e) => ({ id: e.id, startsAt: e.starts_at }));
  if (!required.length || !list.length) return [];
  const { data: rows } = await supabase.from("publication_post_events").select("event_id, publication_posts!inner(channel, status)").in("event_id", list.map((e) => e.id));
  const posts = (rows ?? []).map((r) => ({ channel: r.publication_posts.channel, status: r.publication_posts.status, events: [r.event_id] }));
  return stillToPlan(list, posts, required, berlinDate(nowIso));
}
