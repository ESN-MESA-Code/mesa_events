// The Calendar page (redesign 2026-11-04): one list of entries per month,
// grouped by day for the day list (desktop "List" and phones), laid out in
// weeks for the month grid and the phone's mini month. Pure
// (tests/unit/calendarView.test.ts).
import { format } from "date-fns";
import type { InternalKind } from "@/lib/internal";
import { addDays } from "@/lib/month";

/** What colours an entry: an ESN event, a kind of internal event, or a cycle deadline. */
export type Category = "esn" | InternalKind | "deadline";

export interface CalEntry {
  key: string;
  /** Berlin date, "2026-11-04". */
  day: string;
  /** Berlin time, "19:00". */
  time: string;
  /** ISO start, for sorting. */
  at: string;
  title: string;
  /** The event's page; deadlines have none. */
  href: string | null;
  category: Category;
  /** "Day trip", "Stammtisch" … – null when it adds nothing ("Standard", or the title says it). */
  typeLabel: string | null;
  cancelled: boolean;
  /** Before today (Berlin). */
  past: boolean;
  /** The viewer's part: "You: OC", "You: helper", "You: signed up". */
  you: string | null;
  /** What it still needs: "OC needed", "1 helper slot open", "Under-staffed". */
  needs: Array<{ text: string; tone: "amber" | "red" }>;
  /** The full location; the list shows its venue. */
  place: string | null;
  testId?: string;
}

export interface DayGroup {
  day: string;
  entries: CalEntry[];
}

/** Entries by day, in time order. */
export function groupByDay(entries: CalEntry[]): DayGroup[] {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  const groups: DayGroup[] = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last?.day === entry.day) last.entries.push(entry);
    else groups.push({ day: entry.day, entries: [entry] });
  }
  return groups;
}

/** Today always has a group when the month shows it (an empty one says "Nothing planned today"). */
export function withToday(groups: DayGroup[], today: string, month: string): DayGroup[] {
  if (today.slice(0, 7) !== month.slice(0, 7) || groups.some((g) => g.day === today)) return groups;
  return [...groups, { day: today, entries: [] }].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * In the current month the days before today fold away ("Show 1–3 Nov"),
 * unless nothing comes after them.
 */
export function splitEarlier(groups: DayGroup[], today: string, fold: boolean): { earlier: DayGroup[]; rest: DayGroup[] } {
  if (!fold) return { earlier: [], rest: groups };
  const earlier = groups.filter((g) => g.day < today);
  const rest = groups.filter((g) => g.day >= today);
  return rest.length ? { earlier, rest } : { earlier: [], rest: groups };
}

const utc = (day: string) => new Date(`${day}T12:00:00Z`);

/** ISO week number of a day ("2026-11-16" → 47). */
export function isoWeek(day: string): number {
  const d = utc(day);
  const thursday = addDays(day, 3 - ((d.getUTCDay() + 6) % 7));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${jan1}T00:00:00Z`)) / 86_400_000 / 7) + 1;
}

/** "Wed 4 Nov" */
export const dayLabel = (day: string) => format(utc(day), "EEE d MMM");

/** "1–3 Nov", "30 Nov – 2 Dec", "4 Nov". */
export function dayRange(from: string, to: string): string {
  if (from === to) return format(utc(from), "d MMM");
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${format(utc(to), "d MMM")}`;
  return `${format(utc(from), "d MMM")} – ${format(utc(to), "d MMM")}`;
}

/** "Week 47 · 16–22 Nov" for the week a day is in. */
export function weekLabel(day: string): string {
  const monday = addDays(day, -((utc(day).getUTCDay() + 6) % 7));
  return `Week ${isoWeek(day)} · ${dayRange(monday, addDays(monday, 6))}`;
}

/** A grid week (null outside the month, as `calendarWeeks` gives it) with the neighbouring months' days filled in. */
export function fillWeek(week: Array<string | null>): Array<{ day: string; inMonth: boolean }> {
  const i = week.findIndex(Boolean);
  const anchor = week[i]!;
  return week.map((d, j) => ({ day: d ?? addDays(anchor, j - i), inMonth: d !== null }));
}

/** The venue of a location: "Café Puck, Türkenstraße 33, 80799 München" → "Café Puck". */
export function venue(location: string | null | undefined): string | null {
  const v = location?.split(",")[0]?.trim();
  return v || null;
}

/** A kind's label beside a title, unless the title already says it ("Tuesday Talk: …", "Office hour"). */
export function typeLabelFor(title: string, label: string | null): string | null {
  if (!label) return null;
  return title.toLowerCase().startsWith(label.toLowerCase()) ? null : label;
}
