// The personal calendar feed (round 2026-10-30): /api/calendar/<token>.ics,
// resolved with public.calendar_feed_items() (service role), which returns
// only what the token's owner may see.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { appBaseUrl } from "@/lib/env";
import { buildCalendar, type IcalItem } from "@/lib/ical";
import { INTERNAL_KIND_LABELS, type InternalKind } from "@/lib/internal";

const TOKEN = /^mesa_cal_[A-Za-z0-9_-]{43}$/;

export function feedUrl(token: string, base = appBaseUrl()): string {
  return `${base}/api/calendar/${token}.ics`;
}

/** The token from the route's segment ("mesa_cal_….ics"), null if it cannot be one. */
export function parseFeedSegment(segment: string): string | null {
  const token = segment.replace(/\.ics$/, "");
  return TOKEN.test(token) ? token : null;
}

/** The iCalendar text of a feed, or null when the token is unknown or its owner lost access. */
export async function renderFeed(admin: SupabaseClient<Database>, token: string, now = new Date()): Promise<string | null> {
  const { data, error } = await admin.rpc("calendar_feed_items", { token });
  // An unknown token, or its owner no longer has access.
  if (error?.code === "P0002") return null;
  if (error) throw new Error(error.message);
  const base = appBaseUrl();
  const items: IcalItem[] = (data ?? []).map((r) => ({
    uid: r.uid,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    location: r.location,
    description: r.description || null,
    url: `${base}${r.path}`,
    cancelled: r.cancelled,
    updatedAt: r.updated_at,
    category: r.kind === "event" ? "ESN event" : INTERNAL_KIND_LABELS[r.kind as InternalKind],
  }));
  return buildCalendar(items, { name: "ESN MESA", now });
}
