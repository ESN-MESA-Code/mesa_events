// "Get inspired" on /ideas (brief 2026-10-29, D): previous events found with
// the ported bot search (lib/description/search.ts – word starts, synonyms,
// umlauts, repeats grouped "+N earlier"), filtered by type, season or month
// and turnout, and turned into a prefilled idea ("Propose this again").
// Runs of one format are one group; the category filters (round 2026-11-01).
// Pure (tests/unit/inspiration.test.ts).
import { berlinDate } from "@/lib/dates";
import { normalizeHook, paragraph } from "@/lib/description/template";
import { searchEntry, searchTemplates, type SearchEntry } from "@/lib/description/search";
import type { EventType } from "@/lib/labels";
import { formatName } from "@/lib/formats";

/** A row of public.inspiration_events(). */
export interface PastEvent {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  type: EventType;
  hook: string;
  intro: string;
  venue: string;
  price: string;
  headcount: number | null;
  helpers_needed: number | null;
  photo_folder_url: string | null;
  source: string;
  category_id: string | null;
  format_id: string | null;
}

/** "Had a big turnout": at least this many people counted. */
export const BIG_TURNOUT = 30;

export const SEASONS = {
  winter: { label: "Winter (Dec–Feb)", months: [12, 1, 2] },
  spring: { label: "Spring (Mar–May)", months: [3, 4, 5] },
  summer: { label: "Summer (Jun–Aug)", months: [6, 7, 8] },
  autumn: { label: "Autumn (Sep–Nov)", months: [9, 10, 11] },
} as const;

export interface InspirationFilters {
  query: string;
  type: EventType | "";
  /** A category id, "" (any). */
  category?: string;
  /** "" (any time), a season key, or a month "1"–"12". */
  when: string;
  bigTurnout: boolean;
}

const monthOfYear = (iso: string) => Number(berlinDate(iso).slice(5, 7));

export function matchesFilters(e: PastEvent, f: Omit<InspirationFilters, "query">): boolean {
  if (f.type && e.type !== f.type) return false;
  if (f.category && e.category_id !== f.category) return false;
  if (f.bigTurnout && !((e.headcount ?? 0) >= BIG_TURNOUT)) return false;
  if (f.when) {
    const m = monthOfYear(e.starts_at);
    const season = SEASONS[f.when as keyof typeof SEASONS];
    if (season ? !(season.months as readonly number[]).includes(m) : Number(f.when) !== m) return false;
  }
  return true;
}

export interface InspirationResult {
  event: PastEvent;
  /** Earlier runs of the same event (same format, else same name without numbers/years), newest first. */
  earlier: PastEvent[];
  /** How often it ran (this one and the earlier ones). */
  times: number;
}

/** The search: the filters first, then the bot's search and grouping (all matches when there is a query, the 5 most recent without). */
/** `limit`: groups to return (infinite scroll on /ideas loads more as the member scrolls); `groups` = all that match. */
export function searchInspiration(pool: PastEvent[], f: InspirationFilters, limit?: number): { results: InspirationResult[]; total: number; groups: number } {
  const byId = new Map(pool.map((e) => [e.event_id, e]));
  const entries: SearchEntry[] = pool
    .filter((e) => matchesFilters(e, f))
    .map((e) => searchEntry(e.event_id, e.title, { title: e.title, dateIso: berlinDate(e.starts_at), venue: e.venue, price: e.price, hook: e.hook, intro: e.intro }, e.format_id));
  const { rows, total, totalGroups } = searchTemplates(entries, f.query, undefined, undefined, limit);
  return {
    total,
    groups: totalGroups,
    results: rows.map((r) => ({
      event: byId.get(r.rec.eventId)!,
      earlier: r.earlier.map((x) => byId.get(x.eventId)!),
      times: 1 + r.earlier.length,
    })),
  };
}

/** The first lines of the published description: the hook as the template says it, and the intro's first two sentences. */
export function teaser(e: Pick<PastEvent, "hook" | "intro">): string {
  const hook = normalizeHook(e.hook);
  const intro = paragraph(e.intro).split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return [hook && `Are you ready for ${hook}?`, intro].filter(Boolean).join(" ");
}

/**
 * A fresh date for running it again: the same day of the year, from
 * `earliestDay` on (the first day ideas are still open for, lib/timeline.ts
 * firstOpenIdeaMonth – round 2026-11-02), moved to the same weekday as the
 * original (an event that was on a Thursday stays on a Thursday). "YYYY-MM-DD".
 */
export function freshDate(originalIso: string, earliestDay: string): string {
  const day = berlinDate(originalIso);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const earliest = Date.parse(`${earliestDay}T12:00:00Z`);
  let year = Number(earliestDay.slice(0, 4));
  let candidate = Date.parse(`${year}${day.slice(4)}T12:00:00Z`);
  while (Number.isNaN(candidate) || candidate < earliest) {
    year++;
    candidate = Date.parse(`${year}${day.slice(4) === "-02-29" ? "-02-28" : day.slice(4)}T12:00:00Z`);
  }
  // To the nearest day with the original weekday (at most three days off).
  const diff = (weekday - new Date(candidate).getUTCDay() + 7) % 7;
  const shift = diff > 3 ? diff - 7 : diff;
  let result = candidate + shift * 86_400_000;
  if (result < earliest) result += 7 * 86_400_000;
  return new Date(result).toISOString().slice(0, 10);
}

export interface IdeaPrefill {
  title: string;
  proposed_date: string;
  pitch: string;
  helpers_needed: number;
  type_suggestion: EventType;
  category_id: string | null;
  format_id: string | null;
}

/** "Propose this again": the idea form filled from a previous event (named after its format when it has one). */
export function ideaFromEvent(e: PastEvent, earlier: PastEvent[], earliestDay: string, formatTitle?: string): IdeaPrefill {
  const hook = normalizeHook(e.hook);
  const firstSentence = paragraph(e.intro).split(/(?<=[.!?])\s+/)[0] ?? "";
  const pitch = [hook && `${hook.charAt(0).toUpperCase()}${hook.slice(1)}.`, firstSentence].filter(Boolean).join(" ");
  const runs = [e, ...earlier].map((x) => berlinDate(x.starts_at)).join(", ");
  return {
    title: formatTitle || formatName(e.title.replace(/\s*(#\d+|\b(19|20)\d{2}\b)\s*/g, " ").replace(/\s+/g, " ").trim() || e.title),
    proposed_date: freshDate(e.starts_at, earliestDay),
    pitch: `${pitch}\n\nRan before: ${runs}${e.headcount ? ` (${e.headcount} people the last time)` : ""}.`.trim().slice(0, 2000),
    helpers_needed: e.helpers_needed ?? 2,
    type_suggestion: e.type,
    category_id: e.category_id,
    format_id: e.format_id,
  };
}
