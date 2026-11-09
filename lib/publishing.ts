// Publishing (brief 2026-10-29, E): the rules of the schedule board and the
// per-event channel status. Pure (tests/unit/publishing.test.ts).
import { addMonths, berlinDate, formatShortDate, monthLabel, monthOf } from "@/lib/dates";
import { addDays, calendarWeeks } from "@/lib/month";
import { isTbaPrice } from "@/lib/description/template";

export type ChannelState = "published" | "planned" | "skipped" | "not_planned";

/** The chip on the Comms row and the event page: ✓ published, ⏰ planned, – not planned, ⨯ skipped. */
export const STATE_MARK: Record<ChannelState, string> = { published: "✓", planned: "⏰", not_planned: "–", skipped: "⨯" };
export const STATE_LABEL: Record<ChannelState, string> = { published: "published", planned: "planned", not_planned: "not planned", skipped: "skipped" };

/**
 * A channel's state in words (round 2026-11-03): "published" is the
 * description in the Chat space; on the advertising channels a post is
 * "posted", and the pretix page is "set up".
 */
export function stateLabel(channel: string, state: ChannelState): string {
  if (state !== "published" || channel === "chat") return STATE_LABEL[state];
  return channel === "pretix" ? "set up" : "posted";
}

export interface PostEventFacts {
  id: string;
  title: string;
  startsAt: string;
  /** Description status ("missing" when none). */
  description: string;
  /** The price as written in the description (TBA while not fixed). */
  price: string;
  /** When the description is due (the cycle's deadline), if known. */
  deadline?: string | null;
  /** The pretix page is up (or pretix is off); unknown when left out. */
  pretix?: boolean;
  /** The event's own status (draft, scheduled, cancelled …); unknown when left out. */
  eventStatus?: string;
}

/** Why the platform will not post this to Telegram (the bot's rules): a cancelled event, an unapproved description or a TBA price. */
export function telegramRefusal(events: PostEventFacts[]): string | null {
  const off = events.filter((e) => e.eventStatus === "cancelled" || e.eventStatus === "dropped");
  if (off.length) return `${off.map((e) => `“${e.title}”`).join(", ")} ${off.length > 1 ? "are" : "is"} cancelled.`;
  const unapproved = events.filter((e) => !["approved", "published"].includes(e.description));
  if (unapproved.length) return `The description of ${unapproved.map((e) => `“${e.title}”`).join(", ")} is not approved yet.`;
  const tba = events.filter((e) => isTbaPrice(e.price));
  if (tba.length) return `The price of ${tba.map((e) => `“${e.title}”`).join(", ")} is still TBA.`;
  return null;
}

/**
 * Warnings on a post card: planned before the description is approved,
 * after the event, a TBA price on Telegram, no pretix page yet, an event
 * planned twice on the same channel. `plannedOnChannel`: how many posts of this channel hold
 * the event (all of them, this one included).
 */
export function postWarnings(post: { channel: string; scheduledFor: string; status: string }, events: PostEventFacts[], plannedOnChannel: Map<string, number>): string[] {
  if (post.status !== "planned") return [];
  const out: string[] = [];
  const day = berlinDate(post.scheduledFor);
  for (const e of events) {
    if (e.eventStatus === "cancelled" || e.eventStatus === "dropped") out.push(`“${e.title}”: cancelled – skip this post`);
    // Advertised a month ahead (round 2026-11-09): the cycle is still being planned.
    if (e.eventStatus === "draft") out.push(`“${e.title}”: still a draft – the date may change until the Events team fixes the month`);
    if (!["approved", "published"].includes(e.description)) out.push(`“${e.title}”: description not approved yet${e.deadline ? ` (due ${formatShortDate(e.deadline)})` : ""}`);
    if (day > berlinDate(e.startsAt)) out.push(`“${e.title}”: planned after the event`);
    if (post.channel === "telegram" && isTbaPrice(e.price)) out.push(`“${e.title}”: price still TBA`);
    // pretix comes before the advertising (round 2026-11-03): the posts link to it.
    if (e.pretix === false) out.push(`“${e.title}”: pretix page not set up yet`);
    if ((plannedOnChannel.get(e.id) ?? 0) > 1) out.push(`“${e.title}”: planned more than once on this channel`);
  }
  return out;
}

/** 10:00 Berlin of a day ("2026-11-05") – the time a post dropped on a day gets. */
export const DEFAULT_POST_HOUR = "10:00";

/** The events Comms may post about (private.check_post_event): from the volunteer form on, so next month's and later ones too. */
export const PUBLISHABLE_STATUSES = ["scheduled", "confirmed", "understaffed", "completed"] as const;

/**
 * Drafts – their cycle is still being planned – may be advertised once they
 * are this close (round 2026-11-09, private.check_post_event): an event
 * early next month is advertised a month ahead, before its volunteer form.
 */
export const DRAFT_AHEAD_DAYS = 42;

/** Whether an event may be put on a post: a publishable status, or a draft at most DRAFT_AHEAD_DAYS away. */
export function advertisable(e: { status: string; startsAt: string }, now: number): boolean {
  if ((PUBLISHABLE_STATUSES as readonly string[]).includes(e.status)) return true;
  return e.status === "draft" && Date.parse(e.startsAt) < now + DRAFT_AHEAD_DAYS * 86_400_000;
}

/** How many months after its own the board lists events (round 2026-11-02): big events are advertised a month or two ahead. */
export const AHEAD_MONTHS = 3;

/** Whether an event of `eventMonth` is listed ahead on the board of `month` (up to AHEAD_MONTHS later). */
export const listedAhead = (eventMonth: string, month: string) => eventMonth > month && eventMonth <= addMonths(month, AHEAD_MONTHS);

/**
 * The board an event's posts are planned on when it has none yet: its own
 * month once that has come, else the earliest board from this month on
 * that lists it (AHEAD_MONTHS before its month).
 */
export function boardMonthFor(eventMonth: string, thisMonth: string): string {
  if (eventMonth <= thisMonth) return eventMonth;
  const earliest = addMonths(eventMonth, -AHEAD_MONTHS);
  return earliest > thisMonth ? earliest : thisMonth;
}

/** Big events (parties, trips) are advertised weeks ahead: they lead their month in the list (round 2026-11-02). */
export const BIG_EVENT_TYPES = ["special", "day_trip", "weekend_trip"] as const;
export const isBigEvent = (type: string | null | undefined) => (BIG_EVENT_TYPES as readonly string[]).includes(type ?? "");

/**
 * The event list of the board for `month` (round 2026-11-02): the month's
 * own events (and any other on its posts) by date, then the events of later
 * months, grouped by their month, big ones first – so posts for an event
 * weeks ahead are planned on this month's days.
 */
export function trayGroups<E extends { startsAt: string; type?: string | null }>(events: E[], month: string): Array<{ month: string; later: boolean; events: E[] }> {
  const byDate = (a: E, b: E) => a.startsAt.localeCompare(b.startsAt);
  const isLater = (ev: E) => monthOf(ev.startsAt) > month;
  const months = [...new Set(events.filter(isLater).map((ev) => monthOf(ev.startsAt)))].sort();
  return [
    { month, later: false, events: events.filter((ev) => !isLater(ev)).sort(byDate) },
    ...months.map((m) => ({
      month: m,
      later: true,
      events: events.filter((ev) => monthOf(ev.startsAt) === m).sort((a, b) => Number(isBigEvent(b.type)) - Number(isBigEvent(a.type)) || byDate(a, b)),
    })),
  ];
}

/**
 * The day "Plan…" suggests for a post of an event on `eventDay`: the last
 * day of the board's month (`days`) at least three days before the event,
 * else three days before it in whichever month – today when that has
 * passed, the event's day for a past event.
 */
export function defaultPostDay(days: string[], today: string, eventDay: string): string {
  const ideal = addDays(eventDay, -3);
  if (ideal < today) return today <= eventDay ? today : eventDay;
  return [...days].reverse().find((d) => d <= ideal && d >= today) ?? ideal;
}

/**
 * Upcoming events still missing a required channel of the schedule (a
 * planned or published post; skipped ones do not count) – Home's Comms
 * figure. `today` is a Berlin date.
 */
export function stillToPlan<E extends { id: string; startsAt: string }>(events: E[], posts: Array<{ channel: string; status: string; events: string[] }>, required: string[], today: string): E[] {
  const on = new Set(posts.filter((p) => p.status !== "skipped").flatMap((p) => p.events.map((id) => `${id}|${p.channel}`)));
  return events.filter((ev) => berlinDate(ev.startsAt) >= today && required.some((c) => !on.has(`${ev.id}|${c}`)));
}

// ── Content planning (round 2026-11-09): what Comms kept in a spreadsheet ──

/** What kind of content a post is (Instagram mostly): a feed post, a story, a reel. */
export const POST_FORMATS = ["post", "story", "reel"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export const FORMAT_LABEL: Record<PostFormat, string> = { post: "Post", story: "Story", reel: "Reel" };

/** How far a planned post is: to do → in progress → ready (then posted, the post's status). */
export const PROGRESS = ["todo", "in_progress", "ready"] as const;
export type Progress = (typeof PROGRESS)[number];
export const PROGRESS_LABEL: Record<Progress, string> = { todo: "To do", in_progress: "In progress", ready: "Ready" };

/** Instagram's caption limit. */
export const CAPTION_MAX = 2200;

/**
 * The posts Comms makes every month (their planning sheet): a "This week"
 * story every Sunday with the coming Monday to Sunday, and the next month's
 * calendar post two days before the month ends. Days of `month`
 * ("2026-11-01"); `from` (a Berlin date) leaves out the days before it.
 */
export function regularPosts(month: string, from = ""): Array<{ day: string; title: string; format: PostFormat; kind: "weekly" | "calendar" }> {
  const days = calendarWeeks(month).flat().filter((d): d is string => !!d);
  const short = (d: string) => `${Number(d.slice(8))} ${formatShortDate(`${d}T12:00:00Z`).split(" ").pop()}`;
  const out: Array<{ day: string; title: string; format: PostFormat; kind: "weekly" | "calendar" }> = [];
  for (const d of days) {
    if (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0) continue;
    const mon = addDays(d, 1);
    const sun = addDays(d, 7);
    const span = mon.slice(5, 7) === sun.slice(5, 7) ? `${Number(mon.slice(8))}–${short(sun)}` : `${short(mon)} – ${short(sun)}`;
    out.push({ day: d, title: `This week ${span}`, format: "story", kind: "weekly" });
  }
  const next = addMonths(month, 1);
  out.push({ day: addDays(next, -2), title: `${monthLabel(next).split(" ")[0]} calendar`, format: "post", kind: "calendar" });
  return out.filter((p) => p.day >= from).sort((a, b) => a.day.localeCompare(b.day));
}

/** "Ana, Ben" – the people on a post, by their names. */
export const namesOf = (emails: string[], team: Array<{ email: string; name: string }>) => emails.map((e) => team.find((t) => t.email === e)?.name ?? e.split("@")[0]).join(", ");

/**
 * A promo series for a trip or big event (round 2026-11-09, as Comms ran
 * them in their sheet: "Prague PROMO – sales date", "sales NOW", the last
 * call): the posts with their suggested day and time. `sales` is when
 * ticket sales open ("2026-11-20T18:00", Berlin), empty when not known –
 * then the two sales steps are left out. Steps before `today` or after the
 * event are left out. `on`: ticked by default.
 */
export type PromoStep = { key: "save_the_date" | "sales_date" | "sales_now" | "last_chance" | "today"; title: string; format: PostFormat; day: string; time: string; on: boolean };
export function promoSeries(eventStart: string, sales: string, today: string): PromoStep[] {
  const eventDay = berlinDate(eventStart);
  const salesDay = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(sales) ? sales.slice(0, 10) : null;
  const steps: PromoStep[] = [
    { key: "save_the_date", title: "Save the date", format: "post", day: addDays(eventDay, -21) < today ? today : addDays(eventDay, -21), time: DEFAULT_POST_HOUR, on: true },
  ];
  if (salesDay) {
    steps.push({ key: "sales_date", title: `Sales open ${formatShortDate(`${salesDay}T12:00:00Z`)}`, format: "story", day: addDays(salesDay, -2), time: DEFAULT_POST_HOUR, on: true });
    steps.push({ key: "sales_now", title: "Sales NOW", format: "story", day: salesDay, time: sales.slice(11, 16), on: true });
  }
  steps.push({ key: "last_chance", title: "Last chance", format: "story", day: addDays(eventDay, -2), time: DEFAULT_POST_HOUR, on: true });
  steps.push({ key: "today", title: "Today!", format: "story", day: eventDay, time: "09:00", on: false });
  return steps.filter((s) => s.day >= today && s.day <= eventDay).sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time));
}
