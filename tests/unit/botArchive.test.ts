// The bot archive import (brief 2026-10-29, D): reading the exported Sheet
// (CSV per semester tab, or JSON), one row → a history event with its
// published description and report.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { berlinToIso, mapRecord, parseBotDescription, parseCsv, parseSheetDate, parseSheetPrice, parseSheetTime, recordsFromFile, reportFromEsnData, rowsToRecords } from "../../scripts/bot-archive.mjs";

const FIXTURE = "tests/fixtures/bot-archive/WiSe_25-26.csv";

describe("reading the export", () => {
  it("parses CSV with quotes, doubled quotes and line breaks in cells", () => {
    expect(parseCsv('a,"b ""c""",d\r\n1,"two\nlines",3\n\n')).toEqual([
      ["a", 'b "c"', "d"],
      ["1", "two\nlines", "3"],
    ]);
  });

  it("finds the columns by their headers, in any order; refuses other sheets", () => {
    expect(rowsToRecords([["Event", "Date"], ["Quiz", "06.11.2025"]])[0]).toMatchObject({ title: "Quiz", date: "06.11.2025", venue: "" });
    expect(() => rowsToRecords([["Name", "When"], ["x", "y"]])).toThrow(/Not a semester tab/);
  });

  it("reads a semester tab CSV and the same data as JSON", () => {
    const csv = recordsFromFile(FIXTURE, readFileSync(FIXTURE, "utf8"));
    expect(csv.map((r: { title: string }) => r.title)).toEqual(["Pub Quiz", "Hike to the Herzogstand", "Pub Quiz #2", "Future event"]);
    const json = recordsFromFile("sheet.json", JSON.stringify({ "WiSe 25/26": parseCsv(readFileSync(FIXTURE, "utf8")) }));
    expect(json).toEqual(csv);
  });
});

describe("cells", () => {
  it("dates, times and prices as the bot wrote them", () => {
    expect(parseSheetDate("Thu, 06.11.2025")).toBe("2025-11-06");
    expect(parseSheetDate("2025-11-06")).toBe("2025-11-06");
    expect(parseSheetDate("11/6/2025")).toBe("2025-11-06");
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetTime("19:00–22:00")).toBe("19:00");
    expect(parseSheetTime("7 pm")).toBe("19:00");
    expect(parseSheetTime("TBA")).toBeNull();
    expect(parseSheetPrice("€ 12.50 (incl. drink)")).toBe(1250);
    expect(parseSheetPrice("€ 5")).toBe(500);
    expect(parseSheetPrice("FREE")).toBe(0);
    expect(parseSheetPrice("TBA")).toBeNull();
  });

  it("Berlin wall-clock times, summer and winter", () => {
    expect(berlinToIso("2025-11-06", "19:00")).toBe("2025-11-06T18:00:00.000Z");
    expect(berlinToIso("2026-07-01", "19:00")).toBe("2026-07-01T17:00:00.000Z");
  });

  it("reads the template's fields back from the rendered description", () => {
    const [quiz] = recordsFromFile(FIXTURE, readFileSync(FIXTURE, "utf8"));
    expect(parseBotDescription(quiz.description)).toEqual({
      hook: "a night of trivia",
      intro: "Teams of four battle it out over six rounds. Prizes for the best three teams!",
      program: "Six rounds of questions\nPrizes for the top three",
      bring: "Your smartest friends",
      closing: "see you there!",
    });
    expect(parseBotDescription("")).toEqual({ hook: "", intro: "", program: "", bring: "", closing: "" });
  });

  it("the report from the ESN form data, when there was one", () => {
    expect(reportFromEsnData('{"intl":34,"local":5,"coord":3,"reached":true,"positive":"Fun","improve":"Room"}')).toMatchObject({ intl_participants: 34, local_participants: 5, organizers: 3, went_well: "Fun" });
    expect(reportFromEsnData('{"types":["9"]}')).toBeNull();
    expect(reportFromEsnData("not json")).toBeNull();
  });
});

describe("a row → a history event", () => {
  const records = recordsFromFile(FIXTURE, readFileSync(FIXTURE, "utf8"));
  const today = "2026-10-29";

  it("event, description, report and ESN link", () => {
    const m = mapRecord(records[0], today);
    expect(m).toMatchObject({
      ref: "spaces/TESTARCHIVEQUIZ1",
      event: { title: "Pub Quiz", type: "standard", starts_at: "2025-11-06T18:00:00.000Z", location: "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich", price_cents: 500 },
      description: { title: "Pub Quiz", dateIso: "2025-11-06", time: "19:00", price: "5.00", priceNote: "incl. a drink", hook: "a night of trivia", esnType: "10", esnObjectives: "413,426" },
      report: { intl_participants: 34, went_well: "Great mix of teams, lots of laughs." },
      esnLink: "https://activities.esn.org/activity/pub-quiz-mesa-1111",
      publishedAt: "2025-11-01T11:00:00.000Z",
    });
  });

  it("a trip outside the city is a day trip; TBA time at noon; free", () => {
    expect(mapRecord(records[1], today)).toMatchObject({ event: { type: "day_trip", starts_at: "2025-11-15T11:00:00.000Z", price_cents: 0 }, description: { time: "TBA" }, report: null, esnLink: null });
  });

  it("skips rows without a date or title and events still ahead", () => {
    expect(mapRecord({ date: "", title: "x" }, today)).toMatchObject({ skip: expect.stringMatching(/no date or title/) });
    expect(mapRecord(records[3], today)).toMatchObject({ skip: expect.stringMatching(/not past yet/) });
  });
});
