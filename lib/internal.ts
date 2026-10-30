// Internal events, meetings and office hours (round 2026-10-30): not ESN
// activities, planned by HR and the Vice President. The kinds and what each
// has, and the dates "Repeat" creates. Pure (tests/unit/internal.test.ts).
import type { Database } from "@/types/database";
import { addDays, calendarWeeks } from "@/lib/month";
import { semesterOf } from "@/lib/photos";

export type InternalKind = Database["public"]["Enums"]["internal_kind"];

export const INTERNAL_KINDS: InternalKind[] = ["internal", "stammtisch", "tuesday_talk", "board_meeting", "office_hour"];

export const INTERNAL_KIND_LABELS: Record<InternalKind, string> = {
  internal: "Internal event",
  stammtisch: "Stammtisch",
  tuesday_talk: "Tuesday Talk",
  board_meeting: "Executive board meeting",
  office_hour: "Office hour",
};

export const INTERNAL_KIND_TONES: Record<InternalKind, "gray" | "blue" | "green" | "amber" | "red" | "purple"> = {
  internal: "green",
  stammtisch: "amber",
  tuesday_talk: "blue",
  board_meeting: "purple",
  office_hour: "gray",
};

/** Chip colours on the calendars (one per kind; ESN events keep the brand colour). */
export const INTERNAL_KIND_CHIPS: Record<InternalKind, string> = {
  internal: "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  stammtisch: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
  tuesday_talk: "border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100",
  board_meeting: "border-purple-300 bg-purple-50 text-purple-900 hover:bg-purple-100",
  office_hour: "border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200",
};

/** Solid dots for the small calendar on Home. */
export const INTERNAL_KIND_DOTS: Record<InternalKind, string> = {
  internal: "bg-emerald-500",
  stammtisch: "bg-amber-500",
  tuesday_talk: "bg-sky-500",
  board_meeting: "bg-purple-500",
  office_hour: "bg-gray-500",
};

/** Kinds with an OC and helpers (assigned by the planners). */
export const STAFFED_KINDS: InternalKind[] = ["stammtisch", "office_hour"];
export const isStaffed = (kind: InternalKind) => STAFFED_KINDS.includes(kind);

/** Meetings link their presentation. */
export const MEETING_KINDS: InternalKind[] = ["tuesday_talk", "board_meeting"];
export const hasPresentation = (kind: InternalKind) => MEETING_KINDS.includes(kind);

/** Members sign themselves up to internal events. */
export const takesSignUps = (kind: InternalKind) => kind === "internal";

/** Office hours (and Stammtisch) count a cash box. */
export const hasCashBox = (kind: InternalKind) => STAFFED_KINDS.includes(kind);

/** The page of an internal event: office hours have their own. */
export function internalPath(kind: InternalKind, id: string): string {
  return kind === "office_hour" ? `/office-hours/${id}` : `/internal/${id}`;
}

/** Which occurrences of a weekday in a month "Repeat" picks: every one, or the 1st–4th / last. */
export type Occurrence = "every" | 1 | 2 | 3 | 4 | "last";

export const OCCURRENCE_LABELS: Record<string, string> = { every: "every", 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", last: "last" };

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The days of `month` ("2026-11-01") on `weekday` (0 = Monday … 6 = Sunday)
 * that `which` picks: "every" Tuesday, the 2nd and 4th Tuesday ([2, 4]),
 * the "last" Monday …, in order, without duplicates.
 */
export function weekdaysInMonth(month: string, weekday: number, which: Occurrence[]): string[] {
  const days = calendarWeeks(month)
    .map((w) => w[weekday])
    .filter((d): d is string => !!d);
  if (which.includes("every")) return days;
  const picked = new Set<string>();
  for (const w of which) {
    const day = w === "last" ? days.at(-1) : w === "every" ? undefined : days[w - 1];
    if (day) picked.add(day);
  }
  return [...picked].sort();
}

/** First days of the months from `from` to `to` ("2026-10-01" … "2027-03-01"). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const end = to.slice(0, 7);
  while (`${y}-${String(m).padStart(2, "0")}` <= end) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export interface Semester {
  /** "2026-2" (winter) / "2026-1" (summer), as lib/photos.ts. */
  key: string;
  /** "WiSe 26/27" */
  name: string;
  /** First and last day: SoSe April–September, WiSe October–March. */
  from: string;
  to: string;
  months: string[];
}

/** The semester of a day ("2026-11-05" → WiSe 26/27, 2026-10-01 … 2027-03-31). */
export function semesterFor(day: string): Semester {
  const { key, name } = semesterOf(day);
  return semesterByKey(key, name);
}

/** "2026-2" → WiSe 26/27; null when not a semester key. */
export function parseSemesterKey(raw: string | string[] | undefined | null): Semester | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const m = String(s ?? "").match(/^(\d{4})-([12])$/);
  return m ? semesterByKey(`${m[1]}-${m[2]}`) : null;
}

function semesterByKey(key: string, name?: string): Semester {
  const [y, half] = key.split("-").map(Number);
  const from = half === 1 ? `${y}-04-01` : `${y}-10-01`;
  const to = half === 1 ? `${y}-09-30` : `${y + 1}-03-31`;
  return { key, name: name ?? semesterOf(from).name, from, to, months: monthsBetween(from, to) };
}

/** The semester before or after (`n` = −1 / +1). */
export function shiftSemester(s: Semester, n: number): Semester {
  return semesterFor(n < 0 ? addDays(s.from, -1) : addDays(s.to, 1));
}

/**
 * "Repeat" over a whole period: the days from `from` to `to` (inclusive) on
 * `weekday` that `which` picks in each month – every Thursday of the
 * semester, the 2nd and 4th Tuesday of each month, the last Monday …
 */
export function repeatDates(from: string, to: string, weekday: number, which: Occurrence[]): string[] {
  if (!which.length || from > to) return [];
  return monthsBetween(from, to)
    .flatMap((m) => weekdaysInMonth(m, weekday, which))
    .filter((d) => d >= from && d <= to);
}

/** Minutes → "2 h" / "1 h 30 min" / "45 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

/** "19:00" + 90 minutes on "2026-11-05" → Berlin datetime-local start and end values. */
export function defaultTimes(day: string, start: string, minutes: number): { start: string; end: string } {
  const [h, m] = start.slice(0, 5).split(":").map(Number);
  const total = h * 60 + m + minutes;
  const endDay = new Date(Date.parse(`${day}T00:00:00Z`) + Math.floor(total / 1440) * 86_400_000).toISOString().slice(0, 10);
  const rest = total % 1440;
  return { start: `${day}T${start.slice(0, 5)}`, end: `${endDay}T${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}` };
}

/** OC / helper staffing of a staffed internal event. */
export function internalStaffing(hasOc: boolean, helpers: number, needed: number): "staffed" | "no_oc" | "short" {
  if (!hasOc) return "no_oc";
  return helpers < needed ? "short" : "staffed";
}
