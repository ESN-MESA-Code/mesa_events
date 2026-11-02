// "Get inspired" (brief 2026-10-29, D): filters, the bot's search with
// repeats grouped, the teaser, a fresh date, the prefilled idea.
import { describe, expect, it } from "vitest";
import { freshDate, ideaFromEvent, matchesFilters, searchInspiration, teaser, type PastEvent } from "@/lib/inspiration";

const ev = (id: string, title: string, starts_at: string, extra: Partial<PastEvent> = {}): PastEvent => ({
  event_id: id,
  title,
  starts_at,
  ends_at: null,
  type: "standard",
  hook: "",
  intro: "",
  venue: "",
  price: "",
  headcount: null,
  helpers_needed: 2,
  photo_folder_url: null,
  source: "platform",
  category_id: null,
  format_id: null,
  ...extra,
});

const pool = [
  ev("q1", "Pub Quiz", "2025-11-06T18:00:00Z", { hook: "a night of trivia", intro: "Teams battle it out. Prizes! Bring friends.", headcount: 39, venue: "Shamrock" }),
  ev("q2", "Pub Quiz #2", "2026-03-04T18:00:00Z", { headcount: 22 }),
  ev("q3", "Pub Quiz 2026", "2026-06-10T17:00:00Z", { headcount: 31 }),
  ev("h1", "Wanderung Herzogstand", "2025-11-15T08:00:00Z", { type: "day_trip", headcount: 18 }),
  ev("d1", "International Dinner", "2026-01-20T18:00:00Z", { type: "special", headcount: 55, photo_folder_url: "https://drive.google.com/drive/folders/x" }),
];
const all = { query: "", type: "" as const, when: "", bigTurnout: false };

describe("search and filters", () => {
  it("finds by word starts and synonyms, groups repeats with the newest first", () => {
    const { results } = searchInspiration(pool, { ...all, query: "quiz" });
    expect(results).toHaveLength(1);
    expect(results[0].event.event_id).toBe("q3");
    expect(results[0].earlier.map((e) => e.event_id)).toEqual(["q2", "q1"]);
    expect(results[0].times).toBe(3);
    // "hike" finds "Wanderung" (synonyms), umlauts and case do not matter.
    expect(searchInspiration(pool, { ...all, query: "hike" }).results.map((r) => r.event.event_id)).toEqual(["h1"]);
  });

  it("filters by type, season or month of the year, and big turnout", () => {
    expect(matchesFilters(pool[3], { ...all, type: "day_trip" })).toBe(true);
    expect(matchesFilters(pool[0], { ...all, type: "day_trip" })).toBe(false);
    expect(searchInspiration(pool, { ...all, when: "winter" }).results.map((r) => r.event.event_id)).toEqual(["d1"]);
    expect(searchInspiration(pool, { ...all, when: "11" }).results.map((r) => r.event.event_id).sort()).toEqual(["h1", "q1"]);
    const big = searchInspiration(pool, { ...all, bigTurnout: true }).results;
    expect(big.map((r) => r.event.event_id)).toEqual(["q3", "d1"]);
    expect(big[0].earlier.map((e) => e.event_id)).toEqual(["q1"]);
  });

  it("runs of one format are one group whatever their names; the category filters (round 2026-11-01)", () => {
    const linked = [
      ...pool,
      ev("l1", "Language Café", "2026-02-12T18:00:00Z", { format_id: "f-lang", category_id: "c-lang" }),
      ev("l2", "Sprachcafé im Winter", "2026-01-12T18:00:00Z", { format_id: "f-lang", category_id: "c-lang" }),
    ];
    const lang = searchInspiration(linked, { ...all, category: "c-lang" }).results;
    expect(lang.map((r) => [r.event.event_id, r.earlier.map((e) => e.event_id)])).toEqual([["l1", ["l2"]]]);
    expect(searchInspiration(linked, { ...all, category: "c-other" }).results).toEqual([]);
    expect(ideaFromEvent(linked[5], [], "2026-10-01", "Language Café")).toMatchObject({ title: "Language Café", format_id: "f-lang", category_id: "c-lang" });
    expect(ideaFromEvent(ev("x", "International dinner — Oct WiSe26", "2026-10-16T17:00:00Z"), [], "2026-10-01").title).toBe("International dinner");
  });

  it("without a query: the most recent events", () => {
    expect(searchInspiration(pool, all).results[0].event.event_id).toBe("q3");
  });

  it("the teaser: the hook as the template says it and the first two sentences", () => {
    expect(teaser(pool[0])).toBe("Are you ready for a night of trivia? Teams battle it out. Prizes!");
    expect(teaser(pool[1])).toBe("");
  });
});

describe("Propose this again", () => {
  it("a fresh date: same day of the year, in a month still open for ideas, same weekday", () => {
    // Thursday 6 November 2025 → a Thursday around 6 November 2026 (ideas for November still open).
    expect(freshDate("2025-11-06T18:00:00Z", "2026-11-01")).toBe("2026-11-05");
    // November closed for ideas → next year, still a Thursday.
    expect(freshDate("2025-11-06T18:00:00Z", "2026-12-01")).toBe("2027-11-04");
    expect(new Date(`${freshDate("2025-01-20T18:00:00Z", "2026-12-01")}T12:00:00Z`).getUTCDay()).toBe(new Date("2025-01-20T12:00:00Z").getUTCDay());
  });

  it("fills title, pitch from the hook, helpers and type", () => {
    const q = searchInspiration(pool, { ...all, query: "quiz" }).results[0];
    const idea = ideaFromEvent(pool[0], [], "2026-10-01");
    expect(idea).toEqual({
      title: "Pub Quiz",
      proposed_date: "2026-11-05",
      pitch: "A night of trivia. Teams battle it out.\n\nRan before: 2025-11-06 (39 people the last time).",
      helpers_needed: 2,
      type_suggestion: "standard",
      category_id: null,
      format_id: null,
    });
    expect(ideaFromEvent(q.event, q.earlier, "2026-10-29")).toMatchObject({ title: "Pub Quiz", pitch: "Ran before: 2026-06-10, 2026-03-04, 2025-11-06 (31 people the last time)." });
    expect(ideaFromEvent({ ...pool[3], helpers_needed: null }, [], "2026-10-29")).toMatchObject({ helpers_needed: 2, type_suggestion: "day_trip" });
  });
});
