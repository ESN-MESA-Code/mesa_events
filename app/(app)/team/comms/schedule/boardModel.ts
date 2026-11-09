// The advertisement schedule's shapes and pure helpers (round 2026-11-09 (5):
// the schedule is one board – a row per event, the days left to right).
// Shared by the server page and the client board; no React here.
import { berlinDate, formatShortDate } from "@/lib/dates";
import { addDays, dayDiff } from "@/lib/month";
import type { PostFormat, Progress } from "@/lib/publishing";

export interface BoardChannel {
  key: string;
  name: string;
  kind: "auto" | "manual";
  /** Every event is published here (Telegram, Instagram). */
  required: boolean;
}

export interface BoardEvent {
  id: string;
  title: string;
  startsAt: string;
  /** Description status ("missing" when none). */
  description: string;
  /** standard, special, day_trip, weekend_trip – the big ones are advertised weeks ahead. */
  type: string | null;
  /** Its cycle is still being planned (round 2026-11-09): it may be advertised early, but its date may still change. */
  draft?: boolean;
  /** Its category (event_categories), for the filter and the emoji on its row. */
  categoryId?: string | null;
  /** It gets a row (the server's pick for the window); the others are on posts only, for their titles. */
  listed?: boolean;
  /** Its colour on the board (set by the board): the dot on its row and its campaign line. */
  color?: string;
}

export interface BoardCategory {
  id: string;
  name: string;
  emoji: string | null;
}

/** An event's best post per channel, from every month (published wins over planned). */
export type Coverage = Record<string, Record<string, { status: "planned" | "published"; at: string }>>;

/** pretix as a checklist: the events whose pretix page is up, with its link when given. */
export interface PretixChecklist {
  enabled: boolean;
  done: Record<string, { link: string | null }>;
}

/** One Telegram message of a post as the preview shows it (round 2026-11-03). */
export interface PreviewMessage {
  /** Plain text. */
  text: string;
  /** The event of the message; null for the heading. */
  eventId: string | null;
  /** Its picture: its own, else the default of its format or type. */
  picture: string | null;
  /** The picture is a default (Pictures tab), not one of this post. */
  isDefault: boolean;
}

export interface BoardPost {
  id: string;
  channel: string;
  scheduledFor: string;
  status: "planned" | "published" | "skipped";
  /** Telegram: Comms confirmed it after the preview (only then it goes out). */
  confirmed: boolean;
  link: string | null;
  picture: string | null;
  note: string;
  skipReason: string | null;
  lastError: string | null;
  publishedAt: string | null;
  /** Event ids in the post's order. */
  events: string[];
  warnings: string[];
  /** Telegram, planned: why the job would not post it (description not approved, TBA price) – nothing to confirm yet. */
  refusal: string | null;
  /** Telegram: the messages as they will be posted, one per event, each with its picture (round 2026-11-03). */
  preview: PreviewMessage[] | null;
  /** Content planning (round 2026-11-09): a title (needed without events), post / story / reel, who, how far, caption, design. */
  title: string | null;
  format: PostFormat | null;
  assignees: string[];
  progress: Progress;
  caption: string;
  designLink: string | null;
}

/** The weeks the board shows at once, and how far ← / → move it. */
export const BOARD_WEEKS = 8;
export const BOARD_STEP_WEEKS = 4;

/** The Monday of `day`'s week ("2026-11-12" → "2026-11-09"). */
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

/** "Thu 12 Nov" for a Berlin date. */
export const dayLabel = (day: string) => formatShortDate(`${day}T12:00:00Z`);

export const SHORT: Record<string, string> = { telegram: "TG", instagram: "IG" };
export const shortOf = (channel: string, name?: string) => SHORT[channel] ?? name ?? channel;

/**
 * An event's colour (round 2026-11-03): its dot and its campaign line, so a
 * row reads at a glance. By date order, so neighbours differ.
 */
export const EVENT_COLORS = ["bg-rose-500", "bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500", "bg-teal-500", "bg-fuchsia-500", "bg-lime-600", "bg-indigo-500"];

/** A marker's colour per channel: solid once posted, light while planned. */
const CHANNEL_DOT: Record<string, { solid: string; light: string }> = {
  telegram: { solid: "bg-sky-500 border-sky-600", light: "bg-sky-100 border-sky-500" },
  instagram: { solid: "bg-pink-500 border-pink-600", light: "bg-pink-100 border-pink-500" },
};
export const dotOf = (channel: string) => CHANNEL_DOT[channel] ?? { solid: "bg-gray-500 border-gray-600", light: "bg-gray-100 border-gray-500" };

/** The status filter's buckets. */
export type PostState = "planned" | "unconfirmed" | "posted" | "skipped";
export const isUnconfirmed = (p: Pick<BoardPost, "channel" | "status" | "confirmed">) => p.channel === "telegram" && p.status === "planned" && !p.confirmed;
export const stateOf = (p: BoardPost): PostState => (p.status === "published" ? "posted" : p.status === "skipped" ? "skipped" : isUnconfirmed(p) ? "unconfirmed" : "planned");
export const STATE_TEXT: Record<PostState, string> = { planned: "planned", unconfirmed: "not confirmed", posted: "posted", skipped: "skipped" };

/** "in 3 days", "on the day", "2 days after!" – a post's day relative to its event. */
export function leadTime(postDay: string, eventStart: string): { text: string; late: boolean } {
  const d = dayDiff(postDay, berlinDate(eventStart));
  if (d === 0) return { text: "on the event day", late: false };
  if (d < 0) return { text: `${-d} d after the event`, late: true };
  return { text: `${d} d before`, late: false };
}

/**
 * A post's lead time (round 2026-11-09): "−3d", "−2w", "day of", "+1d"
 * (after – late), counted to its next event (the last one when all are
 * before the post); null for a post without events.
 */
export function leadOf(post: BoardPost, byId: Map<string, BoardEvent>): { short: string; text: string; late: boolean } | null {
  const day = berlinDate(post.scheduledFor);
  const evs = post.events
    .map((id) => byId.get(id))
    .filter((e): e is BoardEvent => !!e)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (!evs.length) return null;
  const ev = evs.find((e) => berlinDate(e.startsAt) >= day) ?? evs[evs.length - 1];
  const d = dayDiff(day, berlinDate(ev.startsAt));
  const short = d === 0 ? "day of" : d < 0 ? `+${-d}d` : d < 14 ? `−${d}d` : `−${Math.round(d / 7)}w`;
  return { short, text: `${leadTime(day, ev.startsAt).text} – ${ev.title}`, late: d < 0 };
}

/** An event's state per channel for its row: posted, planned (with the day) or missing. */
export function channelMark(coverage: Coverage, eventId: string, channel: string): { state: "posted" | "planned" | "missing"; at: string | null } {
  const c = coverage[eventId]?.[channel];
  if (!c) return { state: "missing", at: null };
  return { state: c.status === "published" ? "posted" : "planned", at: c.at };
}

/** Upcoming (not a draft) and missing a required channel – the "Needs posts" filter and the red marks. */
export function needsPosts(e: BoardEvent, required: BoardChannel[], coverage: Coverage, today: string): boolean {
  return !e.draft && berlinDate(e.startsAt) >= today && required.some((c) => !coverage[e.id]?.[c.key]);
}
