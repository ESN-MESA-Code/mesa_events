// Template search ("Start from a previous event?"), ported from the bot's
// src/Search.gs: finds published descriptions by name, venue and text.
//
// - Word-based: every search word must match the start of a word ("hike" →
//   "Hiking Tegernsee"), endings like -ing/-ung/-s are ignored, umlauts are
//   folded (ä = ae), "pub quiz" = "Pubquiz".
// - Synonyms: SEARCH_SYNONYMS (one line per group, lower case).
// - Name matches come first, then events that match only in venue/text.
// - Repeats of the same event are grouped: newest shown, "+N earlier".
// The pool comes from the database (published descriptions) instead of the
// bot's cache and hidden sheet.

export const SEARCH_SYNONYMS = [
  "hike hiking hikes wandern wanderung wandertag trek trekking",
  "pubquiz quiz",
  "dinner potluck cooking kochen",
  "party parties clubbing club",
  "ski skiing snowboard",
  "bike biking bicycle cycling radtour fahrrad",
  "boulder bouldering climbing klettern",
  "oktoberfest wiesn",
  "museum exhibition ausstellung",
  "trip excursion ausflug daytrip",
  "games boardgame boardgames spieleabend",
  "stammtisch regulars",
];

export const SEARCH_MAX_GROUPS = 30;
export const SEARCH_RECENT = 5;
export const SEARCH_TEXT_MAX = 400;

export interface SearchEntry {
  eventId: string;
  eventTitle: string;
  published: { title: string; dateIso: string; venue: string; price: string; priceNote: string; hook: string; intro: string; program: string };
}

export interface SearchRow {
  rec: SearchEntry;
  earlier: SearchEntry[];
  key: string;
  expanded?: boolean;
}

export function searchEntry(eventId: string, eventTitle: string, p: Partial<SearchEntry["published"]>): SearchEntry {
  const short = (s?: string) => String(s || "").slice(0, SEARCH_TEXT_MAX);
  return {
    eventId: String(eventId),
    eventTitle: String(eventTitle || ""),
    published: {
      title: p.title || "",
      dateIso: p.dateIso || "",
      venue: p.venue || "",
      price: p.price || "",
      priceNote: p.priceNote || "",
      hook: short(p.hook),
      intro: short(p.intro),
      program: short(p.program),
    },
  };
}

/** Lower case, umlauts/accents folded (ä → ae, or → a with plain), only letters and digits. */
export function searchFold(s: unknown, plain = false): string {
  let out = String(s ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss");
  if (!plain) out = out.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
  return out
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude stemmer: hiking/hikes/hike → hik, wanderung → wander. */
export function searchStem(w: string): string {
  const m = w.match(/^(.{3,}?)(ings|ing|ung|ers|er|es|s|e)$/);
  return m ? m[1] : w;
}

/** Stemmed words of a text plus adjacent pairs joined ("pub quiz" → "pubquiz"), both umlaut spellings. */
export function searchWords(text: string): string[] {
  const out: string[] = [];
  for (const plain of [false, true]) {
    const words = searchFold(text, plain).split(" ").filter(Boolean);
    words.forEach((w) => out.push(searchStem(w)));
    for (let i = 0; i + 1 < words.length; i++) out.push(searchStem(words[i] + words[i + 1]));
  }
  return out.filter((w, i) => out.indexOf(w) === i);
}

/** The stems a search word stands for: itself plus its synonym group. */
export function searchAlternatives(term: string): string[] {
  const stem = searchStem(term);
  const alts = [stem];
  for (const line of SEARCH_SYNONYMS) {
    const group = line.split(/\s+/).map(searchStem);
    if (group.some((g) => g === stem || (stem.length >= 3 && g.indexOf(stem) === 0))) {
      group.forEach((g) => {
        if (alts.indexOf(g) < 0) alts.push(g);
      });
    }
  }
  return alts;
}

/** A word matches when it starts with the term, or contains it (terms of 4+ letters: "quiz" in "pubquiz"). */
export function searchTermMatches(alts: string[], words: string[]): boolean {
  return alts.some((a) => words.some((w) => w.indexOf(a) === 0 || (a.length >= 4 && w.indexOf(a) >= 0)));
}

/** Grouping key: the name without numbers/years ("Hike #2 2025" = "Hike"). */
export function searchGroupKey(rec: SearchEntry): string {
  return searchFold(rec.published.title || rec.eventTitle)
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchTemplates(pool: SearchEntry[], query: string, excludeId?: string, expandKey?: string) {
  const terms = searchFold(query).split(" ").filter(Boolean);
  const alts = terms.map(searchAlternatives);
  const byDate = (a: SearchEntry, b: SearchEntry) => ((a.published.dateIso || "") < (b.published.dateIso || "") ? 1 : -1);
  const all = pool.filter((r) => r.eventId !== excludeId);

  let hits: SearchEntry[];
  if (terms.length) {
    const scored = all
      .map((r) => {
        const p = r.published;
        const name = searchWords(`${p.title} ${r.eventTitle}`);
        if (alts.every((a) => searchTermMatches(a, name))) return { r, rank: 0 };
        const text = name.concat(searchWords([p.venue, p.hook, p.intro, p.program].join(" ")));
        return { r, rank: alts.every((a) => searchTermMatches(a, text)) ? 1 : -1 };
      })
      .filter((x) => x.rank >= 0);
    hits = scored.sort((a, b) => a.rank - b.rank || byDate(a.r, b.r)).map((x) => x.r);
  } else {
    hits = all.slice().sort(byDate);
  }

  const groups: Array<{ key: string; members: SearchEntry[] }> = [];
  const index: Record<string, number> = {};
  for (const r of hits) {
    const key = searchGroupKey(r);
    if (!(key in index)) {
      index[key] = groups.length;
      groups.push({ key, members: [] });
    }
    groups[index[key]].members.push(r);
  }
  const max = terms.length ? SEARCH_MAX_GROUPS : SEARCH_RECENT;
  const rows: SearchRow[] = [];
  for (const g of groups.slice(0, max)) {
    if (g.key === expandKey) g.members.forEach((rec) => rows.push({ rec, earlier: [], key: g.key, expanded: true }));
    else rows.push({ rec: g.members[0], earlier: g.members.slice(1), key: g.key });
  }
  return { rows, total: hits.length, totalGroups: groups.length, shownGroups: Math.min(max, groups.length) };
}
