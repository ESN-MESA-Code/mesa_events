// Event categories and formats (round 2026-11-01): the seeded categories
// sort every event of the last three semesters (the bot's registry,
// tests/fixtures/registry-titles.json – titles and hooks only), runs of one
// event share a key, and the past events are grouped for sorting.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatKey, formatName, formatStats, suggestCategory, unsortedGroups, type Category, type SortableEvent } from "@/lib/formats";

// The categories exactly as the migration seeds them.
const SQL = readFileSync("supabase/migrations/20261101000100_categories_formats.sql", "utf8");
const CATEGORIES: Category[] = [...SQL.matchAll(/^ {2}\('([^']+)', '([^']*)', '(\d+)', (\d+), '([^']*)'\)/gm)].map((m) => ({
  id: m[1],
  name: m[1],
  emoji: m[2],
  esn_type: m[3],
  sort: Number(m[4]),
  keywords: m[5],
  active: true,
}));
const REGISTRY: Array<{ title: string; hook: string }> = JSON.parse(readFileSync("tests/fixtures/registry-titles.json", "utf8"));
const category = (title: string, hook = "") => suggestCategory({ title, hook }, CATEGORIES)?.name ?? null;

describe("suggestCategory", () => {
  it("the seed has 16 categories with an ESN type each", () => {
    expect(CATEGORIES).toHaveLength(16);
    expect(new Set(CATEGORIES.map((c) => c.sort)).size).toBe(16);
  });

  it("sorts every event of the last three semesters", () => {
    expect(REGISTRY.length).toBeGreaterThan(150);
    expect(REGISTRY.filter((e) => !category(e.title, e.hook)).map((e) => e.title)).toEqual([]);
  });

  it.each([
    ["Language Café", "Language & Meet-ups"],
    ["Speed Friending", "Language & Meet-ups"],
    ["Swedish Get-Together", "Language & Meet-ups"],
    ["Football World Cup Watch Party: MEX - RSA", "Movies & Watch parties"],
    ["Isar Cleanup", "Social impact"],
    ["CSD Parade Munich", "Social impact"],
    ["Bar Rallye", "Rally & Scavenger hunt"],
    ["Queer Bar Rally", "Rally & Scavenger hunt"],
    ["Sticker Hunt Easter Edition", "Rally & Scavenger hunt"],
    ["Singing Workshop: Disney Edition", "Karaoke & Music"],
    ["Late Halloween Karaoke Night", "Karaoke & Music"],
    ["Oktoberfrest with Erasmi — Oct WiSe26", "Festivals & Traditions"],
    ["Schäffler Tanz", "Festivals & Traditions"],
    ["Christmas Market Hopping", "Festivals & Traditions"],
    ["Latin Dance Session", "Dance & Yoga"],
    ["Yoga Flux", "Dance & Yoga"],
    ["Weißwurst Breakfast", "Food & Drinks"],
    ["Vegan Baking Workshop", "Food & Drinks"],
    ["Paintball Oct WiSe26", "Sports"],
    ["Cycling Tour along the Isar", "Sports"],
    ["Bouldering", "Sports"],
    ["ESN MESA 3D-NeonGolf", "Sports"],
    ["Sip & Paint", "Creative workshops"],
    ["Drawing at the museum", "Creative workshops"],
    ["Deutsches Museum", "Museums & Culture"],
    ["Long Night of Munich Museums", "Museums & Culture"],
    ["NS City Tour", "City tours & Visits"],
    ["KZ Dachau", "City tours & Visits"],
    ["Partnachklamm Hike", "Hiking & Outdoors"],
    ["Overnight Hiking Weekend Trip", "Hiking & Outdoors"],
    ["Chess Tournament", "Games & Quiz"],
    ["Flunkyball", "Games & Quiz"],
    ["Board Games Night", "Games & Quiz"],
    ["ESN MESA Welcome Night", "Party & Nightlife"],
    ["ESN MESA Tram Night", "Party & Nightlife"],
    ["Day Trip Regensburg", "Trips & Excursions"],
    ["Day Trip to Neuschwanstein Castle", "Trips & Excursions"],
    ["Hiking Trip to Leutaschklamm", "Hiking & Outdoors"],
    ["Residenz Visit", "Museums & Culture"],
    ["Beer Garden Evening at the Chinese Tower", "Food & Drinks"],
    ["Escape Room Evening", "Games & Quiz"],
    ["Rafting on the Isar", "Sports"],
    ["Stammtisch at the Augustiner", "Language & Meet-ups"],
    ["ESN MESA Prague WeekendTrip", "Trips & Excursions"],
  ])("%s → %s", (title, expected) => {
    expect(category(title)).toBe(expected);
  });

  it("falls back to the hook, and ignores hidden categories", () => {
    expect(category("Garmisch Partenkirchen — Nov WiSe26", "a magical hike through the Partnachklamm gorge")).toBe("Hiking & Outdoors");
    expect(suggestCategory({ title: "Bouldering" }, CATEGORIES.map((c) => (c.name === "Sports" ? { ...c, active: false } : c)))).toBeNull();
    expect(category("Something completely different")).toBeNull();
  });
});

describe("formatKey and formatName", () => {
  it("runs of one event meet", () => {
    const same = (...titles: string[]) => expect(new Set(titles.map(formatKey)).size).toBe(1);
    same("Hike to Leutaschklamm", "Hiking Trip to Leutaschklamm");
    same("Day Trip Regensburg", "Day Trip to Regensburg");
    same("Day Trip Salzburg", "Trip to Salzburg");
    same("International Dinner", "International dinner — WiSe26", "International dinner — Oct WiSe26");
    same("Speedfriending", "Speed Friending");
    same("Museum Fünf Kontinente (Five Continents)", "Museum Fünf Kontinente");
    same("Football World Cup Watch Party: MEX - RSA", "Football World Cup Watch Party: ESP - CPV");
    same("Flunkyball", "Flunkyball Tournament");
    same("Board Game Night", "Board Games Night");
    same("ESN MESA x TUMi Semester Closing Night", "Semester Closing Night");
    same("Pottery and Paint", "Pottery Painting");
    expect(formatKey("Bouldering")).not.toBe(formatKey("Bowling"));
  });

  it("a clean name for a new format", () => {
    expect(formatName("International dinner — Oct WiSe26")).toBe("International dinner");
    expect(formatName("Paintball Oct WiSe26")).toBe("Paintball");
    expect(formatName("Singing Workshop: Pride Edition")).toBe("Singing Workshop");
    expect(formatName("ESN MESA Welcome Night")).toBe("Welcome Night");
    expect(formatName("ESN MESA x TUMi Semester Closing Night")).toBe("Semester Closing Night");
    expect(formatName("Pub Quiz #2")).toBe("Pub Quiz");
  });
});

describe("unsortedGroups", () => {
  const ev = (id: string, title: string, starts_at: string, extra: Partial<SortableEvent> = {}): SortableEvent => ({ id, title, starts_at, type: "standard", location: null, hook: "", intro: "", category_id: null, format_id: null, ...extra });
  const events = [
    ev("a", "Hike to Leutaschklamm", "2026-05-03T08:00:00Z"),
    ev("b", "Hiking Trip to Leutaschklamm", "2025-11-01T08:00:00Z"),
    ev("c", "Language Café", "2026-01-12T18:00:00Z"),
    ev("d", "Language Café", "2026-02-12T18:00:00Z"),
    ev("e", "Language Café", "2026-03-12T18:00:00Z", { format_id: "f-lang" }),
    ev("f", "Real Life Cluedo", "2026-05-22T18:00:00Z", { category_id: "Games & Quiz" }),
  ];

  it("groups by key, names by the most used title, suggests a category and an existing format", () => {
    const groups = unsortedGroups(events, [{ id: "f-lang", name: "Language Café", category_id: "Language & Meet-ups", active: true }], CATEGORIES);
    expect(groups.map((g) => [g.name, g.events.map((e) => e.id), g.categoryId, g.formatId])).toEqual([
      ["Hike to Leutaschklamm", ["a", "b"], "Hiking & Outdoors", null],
      ["Language Café", ["d", "c"], "Language & Meet-ups", "f-lang"],
      // A category set by hand wins over the suggestion.
      ["Real Life Cluedo", ["f"], "Games & Quiz", null],
    ]);
  });

  it("formatStats: runs, average headcount of the counted runs, last run", () => {
    expect(formatStats([{ starts_at: "2026-01-01", headcount: 20 }, { starts_at: "2026-03-01", headcount: null }, { starts_at: "2026-02-01", headcount: 31 }])).toEqual({ runs: 3, avgHeadcount: 26, last: "2026-03-01" });
    expect(formatStats([])).toEqual({ runs: 0, avgHeadcount: null, last: null });
  });
});
