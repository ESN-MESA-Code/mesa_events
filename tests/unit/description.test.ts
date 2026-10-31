// The description template ported from the Apps Script bot: normalisers,
// rendering, the 4,096-character limit, TBA, validation, ESN fields, search.
import { describe, expect, it } from "vitest";
import {
  CONFIG,
  applyEsnDefaults,
  bullets,
  coerceFields,
  countSentences,
  descriptionLength,
  emptyFields,
  formatLongDate,
  formatPrice,
  fromTemplate,
  importantHeading,
  lengthError,
  normalizeClosing,
  normalizeHook,
  normalizeTime,
  paragraph,
  renderDescription,
  splitPriceText,
  validateAll,
  validateStep,
  type DescriptionFields,
} from "@/lib/description/template";
import { searchAlternatives, searchEntry, searchFold, searchStem, searchTemplates, searchWords } from "@/lib/description/search";

const filled = (over: Partial<DescriptionFields> = {}): DescriptionFields => ({
  ...emptyFields("Pub Quiz"),
  dateIso: "2025-09-29",
  time: "19.30",
  venue: "LMU Main Building",
  price: "9,5",
  priceNote: "ESNcard holders € 7.50",
  hook: "Are you ready for a night of trivia?! 🎉",
  intro: "Test your knowledge in teams.\nPrizes for the best three teams!",
  program: "- Teams of four\n2. Six rounds",
  bring: "Good mood 😄\nWater 💧",
  closing: "We can't wait to see you there! ✨",
  esnType: "10",
  esnObjectives: "413,426",
  esnGoal: "Bring international and local students together over a fun quiz night.",
  ...over,
});

describe("normalisers (README table of the bot)", () => {
  it.each([
    ["19:30", "19:30"],
    ["19.30", "19:30"],
    ["1930", "19:30"],
    ["19h30", "19:30"],
    ["7:30pm", "19:30"],
    ["7 pm", "19:00"],
    ["19 Uhr", "19:00"],
    ["19:30-22:00", "19:30 – 22:00"],
    ["19:30 bis 22", "19:30 – 22:00"],
    ["tba", "TBA"],
    ["To be announced", "TBA"],
  ])("time %s → %s", (raw, value) => {
    expect(normalizeTime(raw)).toEqual({ value });
  });

  it.each(["", "25:00", "19:75", "13pm", "evening", "1-2-3"])("time %j is an error", (raw) => {
    expect(normalizeTime(raw).error).toBeTruthy();
  });

  it.each([
    ["9,5", "", "€ 9.50"],
    ["€9.50", "", "€ 9.50"],
    ["9.50 EUR", "", "€ 9.50"],
    ["0", "", "FREE"],
    ["free", "", "FREE"],
    ["kostenlos", "", "FREE"],
    ["tba", "", "TBA"],
    ["???", "", "TBA"],
    ["12", "(ESNcard 10)", "€ 12.00 (ESNcard 10)"],
    ["12", "ESNcard 10", "€ 12.00 (ESNcard 10)"],
  ])("price %s / %s → %s", (raw, note, value) => {
    expect(formatPrice(raw, note)).toEqual({ value });
  });

  it.each(["", "ten euros", "9.999", "-3"])("price %j is an error", (raw) => {
    expect(formatPrice(raw, "").error).toBeTruthy();
  });

  it("hook and closing accept the full sentence or just the core", () => {
    expect(normalizeHook("Are you ready for X?! 🎉")).toBe("X");
    expect(normalizeHook("X")).toBe("X");
    expect(normalizeClosing("We can't wait to X ✨")).toBe("X");
    expect(normalizeClosing("We can’t wait to see you!")).toBe("see you!");
  });

  it("bullets drop typed markers; paragraphs join wrapped lines", () => {
    expect(bullets("- a\n* b\n• c\n1. d\n2) e\n\n  f  ")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(paragraph("one\ntwo\n\nthree")).toBe("one two\n\nthree");
    expect(countSentences("One. Two! Three?")).toBe(3);
  });

  it("the important heading is in capitals with a default", () => {
    expect(importantHeading(filled({ importantHeading: "⚠️ meeting point" }))).toBe("MEETING POINT");
    expect(importantHeading(filled())).toBe(CONFIG.DEFAULT_IMPORTANT_HEADING);
  });

  it("long dates", () => {
    expect(formatLongDate("2025-09-29")).toBe("Monday, 29 September 2025");
    expect(formatLongDate("2025-02-30")).toBeNull();
    expect(formatLongDate("29.09.2025")).toBeNull();
  });

  it("splits a formatted price back", () => {
    expect(splitPriceText("€ 9.50 (ESNcard € 7.50)")).toEqual({ price: "€ 9.50", priceNote: "ESNcard € 7.50" });
  });
});

describe("rendering the house template", () => {
  it("renders exactly the bot's template", () => {
    const r = renderDescription(filled({ importantHeading: "meeting point", important: "Main entrance", weather: true }));
    expect(r.chat).toBe(
      [
        "🗓️ Monday, 29 September 2025",
        "⏰ 19:30",
        "📍 LMU Main Building",
        "💸 € 9.50 (ESNcard holders € 7.50)",
        "",
        "*Dear Internationals,*",
        "",
        "Are you ready for a night of trivia? 🎉",
        "",
        "Test your knowledge in teams. Prizes for the best three teams!",
        "",
        "*🤔 WHAT DOES THE EVENT LOOK LIKE?*",
        "",
        "• Teams of four",
        "• Six rounds",
        "",
        "*🎒 WHAT SHOULD I BRING?*",
        "",
        "• Good mood 😄",
        "• Water 💧",
        "",
        "*⚠️ MEETING POINT*",
        "",
        "• Main entrance",
        "",
        CONFIG.WEATHER_NOTE,
        "",
        "We can’t wait to see you there! ✨",
        "",
        "With lots of love,",
        "Team ESN MESA",
        "#MESAlovesYOU 🥨🩷💜",
      ].join("\n")
    );
    expect(r.plain).not.toContain("*");
    expect(r.html).toContain("<b>Dear Internationals,</b>");
    expect(r.markdown).toContain("**Dear Internationals,**");
    expect(r.bold).toHaveLength(4);
  });

  it("shows placeholders for missing parts, so the preview always works", () => {
    const r = renderDescription(emptyFields());
    expect(r.plain).toContain("[DAY], [DATE] [MONTH] [YEAR]");
    expect(r.plain).toContain("⏰ [TIME]");
    expect(r.plain).toContain("[EXCITING HOOK]");
    expect(r.plain).not.toContain("IMPORTANT INFORMATION");
  });

  it("renders TBA time and price", () => {
    const r = renderDescription(filled({ time: "tba", price: "TBA" }));
    expect(r.chat).toContain("⏰ TBA");
    expect(r.chat).toContain("💸 TBA (ESNcard holders € 7.50)");
    const v = validateAll(filled({ time: "tba", price: "TBA" }), "2025-01-01");
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual(expect.arrayContaining(['The time is still "TBA" – update it once it is fixed.']));
  });

  it("escapes HTML in the preview", () => {
    expect(renderDescription(filled({ venue: "<script>alert(1)</script>" })).html).toContain("&lt;script&gt;");
  });
});

describe("the 4,096-character limit", () => {
  it("counts the Chat message as posted, bold markers included", () => {
    const d = filled();
    expect(descriptionLength(d)).toBe(renderDescription(d).chat.length);
    expect(renderDescription(d).chat.length).toBe(renderDescription(d).plain.length + 2 * 3);
  });

  it("is an error just above the limit, not at it", () => {
    const base = filled({ intro: "" });
    const room = CONFIG.MAX_CHARS - descriptionLength({ ...base, intro: "x" }) + 1;
    expect(descriptionLength({ ...base, intro: "x".repeat(room) })).toBe(CONFIG.MAX_CHARS);
    expect(lengthError({ ...base, intro: "x".repeat(room) })).toBeNull();
    const err = lengthError({ ...base, intro: "x".repeat(room + 10) });
    expect(err).toBe("The description is 4,106 characters long – the maximum is 4,096. Please shorten it by 10 characters.");
    expect(validateStep({ ...base, intro: "x".repeat(room + 10) }, "intro").errors).toContain(err);
  });
});

describe("validation", () => {
  it("a complete description is valid", () => {
    expect(validateAll(filled(), "2025-01-01")).toMatchObject({ ok: true, firstInvalid: null });
  });

  it("names the missing parts per step", () => {
    const v = validateAll(emptyFields());
    expect(v.ok).toBe(false);
    expect(v.firstInvalid).toBe("basics");
    expect(v.errors.basics).toEqual(expect.arrayContaining(["The event name is missing.", "Pick the event date.", "The venue is missing."]));
    expect(v.errors.intro).toContain("Describe the event in 2–4 sentences.");
    expect(v.errors.program).toHaveLength(2);
    // What ESN Activities needs has its own step below the preview (round 2026-10-30).
    expect(v.errors.esn).toEqual(expect.arrayContaining(["Pick the ESN activity type (needed for ESN Activities).", "Describe the goal of the event (needed for ESN Activities)."]));
    expect(v.errors.extras).not.toContain("Pick the ESN activity type (needed for ESN Activities).");
  });

  it("refuses the example programme until it is replaced (usability review #2)", () => {
    const v = validateAll(filled({ program: "Welcome and introductions\nThe main part\nDrinks afterwards" }), "2025-01-01");
    expect(v.ok).toBe(false);
    expect(v.errors.program[0]).toMatch(/still has the example text \("Welcome and introductions"\)/);
    expect(validateAll(filled({ program: "- the main part." }), "2025-01-01").ok).toBe(false);
    expect(validateAll(filled({ program: "The main part of the hike is the ridge\nDrinks afterwards at the hut" }), "2025-01-01").ok).toBe(true);
  });

  it("the goal must say something; ratings are optional (the type's defaults)", () => {
    expect(validateAll(filled({ esnGoal: "Fun." })).errors.esn).toContain("The goal is very short – say in a sentence what the event wants to achieve.");
    expect(validateAll(filled({ esnAccess: "" })).errors.esn).toEqual([]);
  });

  it("warns without blocking", () => {
    const v = validateAll(filled({ intro: "Only one sentence.", bring: "Water", dateIso: "2020-01-01" }), "2025-01-01");
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/1 sentence\(s\).*past|past.*1 sentence/s);
    expect(v.warnings.some((w) => w.includes("emoji"))).toBe(true);
  });

  it("ESN objectives follow the type unless changed by hand", () => {
    const d = applyEsnDefaults({ ...filled(), esnType: "9", esnObjectives: "413,426" }, "10");
    expect(d.esnObjectives).toBe("424,425,428");
    const kept = applyEsnDefaults({ ...filled(), esnType: "9", esnObjectives: "413" }, "10");
    expect(kept.esnObjectives).toBe("413");
  });

  it("coerces stored data and templates keep the date", () => {
    expect(coerceFields({ title: 3, weather: "true", extra: "x" })).toEqual({ ...emptyFields(), weather: true });
    expect(fromTemplate(filled({ dateIso: "2024-01-01", title: "Old quiz" }), filled({ dateIso: "2026-11-05", title: "" }))).toMatchObject({
      dateIso: "2026-11-05",
      title: "Old quiz",
    });
  });
});

describe("template search (Search.gs)", () => {
  const pool = [
    searchEntry("1", "Hiking Tegernsee", { title: "Hiking Tegernsee", dateIso: "2025-05-01", venue: "Tegernsee" }),
    searchEntry("2", "Hiking Tegernsee", { title: "Hiking Tegernsee 2", dateIso: "2025-09-01" }),
    searchEntry("3", "Pubquiz", { title: "Pubquiz", dateIso: "2025-06-01", venue: "Shamrock" }),
    searchEntry("4", "Wanderung Zugspitze", { title: "Wanderung Zugspitze", dateIso: "2025-07-01" }),
    searchEntry("5", "Stammtisch", { title: "Stammtisch", dateIso: "2025-08-01", intro: "We go hiking afterwards" }),
    searchEntry("6", "München bei Nacht", { title: "München bei Nacht", dateIso: "2025-04-01" }),
  ];

  it("folds umlauts and stems words", () => {
    expect(searchFold("München")).toBe("muenchen");
    expect(searchFold("München", true)).toBe("munchen");
    expect(searchStem("hiking")).toBe("hik");
    expect(searchStem("wanderung")).toBe("wander");
    expect(searchWords("pub quiz")).toContain("pubquiz");
  });

  it("finds by word start, synonyms, joined words; name matches first", () => {
    const r = searchTemplates(pool, "hike");
    expect(r.rows.map((x) => x.rec.eventId)).toEqual(["2", "4", "5"]);
    expect(r.rows[0].earlier.map((x) => x.eventId)).toEqual(["1"]);
    expect(searchAlternatives("hike")).toContain("wander");
    expect(searchTemplates(pool, "pub quiz").rows.map((x) => x.rec.eventId)).toEqual(["3"]);
    expect(searchTemplates(pool, "munchen").rows.map((x) => x.rec.eventId)).toEqual(["6"]);
    expect(searchTemplates(pool, "muenchen").rows.map((x) => x.rec.eventId)).toEqual(["6"]);
  });

  it("without a query shows the most recent, grouped, and can expand a group", () => {
    const r = searchTemplates(pool, "", "3");
    expect(r.rows).toHaveLength(4);
    expect(r.rows.some((x) => x.rec.eventId === "3")).toBe(false);
    const expanded = searchTemplates(pool, "tegernsee", undefined, "hiking tegernsee");
    expect(expanded.rows.map((x) => x.rec.eventId)).toEqual(["2", "1"]);
  });
});
