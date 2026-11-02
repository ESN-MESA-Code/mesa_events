// Event categories and formats (round 2026-11-01): what kind of event it is
// (hiking, party, city tour, rally …) and which recurring event it is
// another run of (Language Café, Partnachklamm hike, Bouldering).
//
// - suggestCategory(): the first category (in `sort` order) one of whose
//   keywords matches the title – else the hook, else the intro. Keywords
//   are folded and stemmed like the template search (lib/description/
//   search.ts); up to 4 letters they match whole words only ("tour" is not
//   "Tournament"), longer ones the start of a word ("museum" → "Museums").
// - formatKey(): the name a run shares with the others – without semester
//   tags, numbers, "ESN MESA" and filler words, so "Hike to Leutaschklamm",
//   "Hiking Trip to Leutaschklamm" and "Day Trip to Regensburg" /
//   "Day Trip Regensburg" meet.
// - unsortedGroups(): past events without a format, grouped by that key,
//   with a suggested name, category and an existing format of the same name.
// Pure (tests/unit/formats.test.ts).
import { searchFold, searchStem, searchWords } from "@/lib/description/search";
import type { EventType } from "@/lib/labels";

export interface Category {
  id: string;
  name: string;
  emoji: string;
  esn_type: string | null;
  keywords: string;
  active: boolean;
  sort: number;
}

export interface Format {
  id: string;
  name: string;
  category_id: string | null;
  type: EventType;
  helpers_needed: number;
  location: string | null;
  /** The usual meeting point when it is not the location (round 2026-11-02). */
  meeting_point: string | null;
  active: boolean;
}

export const categoryLabel = (c: Pick<Category, "emoji" | "name">) => `${c.emoji} ${c.name}`.trim();

/** Categories in their order (the form's and the suggestion's), active ones only unless `all`. */
export function sortedCategories<C extends Pick<Category, "sort" | "name" | "active">>(categories: readonly C[], all = false): C[] {
  return categories.filter((c) => all || c.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function keywordStems(keywords: string): string[] {
  return searchFold(keywords)
    .split(" ")
    .filter(Boolean)
    .map(searchStem);
}

function matches(stems: string[], words: string[]): boolean {
  return stems.some((k) => (k.length <= 4 ? words.includes(k) : words.some((w) => w.startsWith(k))));
}

/** The suggested category for an event or idea, or null. */
export function suggestCategory<C extends Category>(text: { title: string; hook?: string; intro?: string }, categories: readonly C[]): C | null {
  const order = sortedCategories(categories).map((c) => ({ c, stems: keywordStems(c.keywords) }));
  for (const part of [text.title, text.hook, text.intro]) {
    if (!part?.trim()) continue;
    const words = searchWords(part);
    const hit = order.find((o) => matches(o.stems, words));
    if (hit) return hit.c;
  }
  return null;
}

const FILLERS = new Set(["esn", "mesa", "x", "to", "the", "at", "a", "an", "of", "and", "in", "day", "trip", "hike", "hiking", "edition", "tournament"]);
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)$/;

/** "International dinner – Oct WiSe26" → "International dinner"; "Football Watch Party: MEX - RSA" → "Football Watch Party". */
export function formatName(title: string): string {
  return (
    title
      .split(/\s[–—-]\s|:/)[0]
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+)?(wise|sose)\s*\d{2}(\/\d{2})?\s*$/i, "")
      .replace(/\s+(#\d+|(19|20)\d{2})\s*$/, "")
      .replace(/^(esn\s+)?mesa\s+(x\s+\S+\s+)?/i, "")
      .replace(/\s+/g, " ")
      .trim() || title.trim()
  );
}

/** The key runs of one event share (see the top of the file): the clean name's stemmed words ("Board Game Night" = "Board Games Night"). */
export function formatKey(title: string): string {
  const base = searchFold(formatName(title));
  const words = base.split(" ").filter((w) => w && !/^\d+$/.test(w) && !/^(wise|sose)\d*$/.test(w) && !MONTHS.test(w) && !FILLERS.has(w));
  return words.map(searchStem).join("") || base.replace(/ /g, "");
}

export interface SortableEvent {
  id: string;
  title: string;
  starts_at: string;
  type: EventType;
  location: string | null;
  hook: string;
  intro: string;
  category_id: string | null;
  format_id: string | null;
}

export interface UnsortedGroup<E extends SortableEvent = SortableEvent> {
  key: string;
  /** The name for a new format: the most used cleaned title, the newest on a tie. */
  name: string;
  /** Newest first. */
  events: E[];
  categoryId: string | null;
  /** An existing format with the same key, to join. */
  formatId: string | null;
}

/** Events without a format, grouped (largest groups first). */
export function unsortedGroups<E extends SortableEvent>(events: readonly E[], formats: readonly Pick<Format, "id" | "name" | "category_id" | "active">[], categories: readonly Category[]): UnsortedGroup<E>[] {
  const byKey = new Map<string, E[]>();
  for (const e of [...events].filter((e) => !e.format_id).sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1))) {
    const k = formatKey(e.title);
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const formatOf = new Map<string, (typeof formats)[number]>();
  for (const f of formats) if (f.active || !formatOf.has(formatKey(f.name))) formatOf.set(formatKey(f.name), f);
  return [...byKey.entries()]
    .map(([key, list]) => {
      const counts = new Map<string, number>();
      for (const e of list) counts.set(formatName(e.title), (counts.get(formatName(e.title)) ?? 0) + 1);
      const name = [...counts.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
      const format = formatOf.get(key) ?? null;
      const known = list.find((e) => e.category_id)?.category_id ?? null;
      const suggested = known ?? format?.category_id ?? list.map((e) => suggestCategory(e, categories)?.id).find(Boolean) ?? null;
      return { key, name, events: list, categoryId: suggested, formatId: format?.id ?? null };
    })
    .sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name));
}

/** How a format did: runs, average headcount (of the runs counted), the last run. */
export function formatStats(runs: readonly { starts_at: string; headcount: number | null }[]) {
  const counted = runs.filter((r) => r.headcount !== null);
  return {
    runs: runs.length,
    avgHeadcount: counted.length ? Math.round(counted.reduce((s, r) => s + (r.headcount ?? 0), 0) / counted.length) : null,
    last: runs.reduce<string | null>((m, r) => (m === null || r.starts_at > m ? r.starts_at : m), null),
  };
}
