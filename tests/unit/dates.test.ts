// Dates are entered and shown in Europe/Berlin, whatever the machine's zone.
import { describe, expect, it } from "vitest";
import {
  berlinDate,
  berlinInputToIso,
  berlinTime,
  daysSpanned,
  dueUrgency,
  formatCents,
  formatDateTime,
  isoToBerlinInput,
  cycleLabel,
  cyclePlannedIn,
  monthLabel,
  monthOf,
  monthStartIso,
  nextMonthStartIso,
  parseEuroToCents,
} from "@/lib/dates";

describe("Berlin wall clock ↔ UTC", () => {
  it("winter time is UTC+1", () => {
    expect(berlinInputToIso("2026-11-05T19:00")).toBe("2026-11-05T18:00:00.000Z");
    expect(isoToBerlinInput("2026-11-05T18:00:00.000Z")).toBe("2026-11-05T19:00");
  });

  it("summer time is UTC+2", () => {
    expect(berlinInputToIso("2026-07-01T19:00")).toBe("2026-07-01T17:00:00.000Z");
    expect(isoToBerlinInput("2026-07-01T17:00:00Z")).toBe("2026-07-01T19:00");
  });

  it("round-trips around the March change (02:00 → 03:00)", () => {
    expect(berlinInputToIso("2027-03-28T01:30")).toBe("2027-03-28T00:30:00.000Z");
    expect(berlinInputToIso("2027-03-28T03:30")).toBe("2027-03-28T01:30:00.000Z");
  });

  it("round-trips around the October change (03:00 → 02:00)", () => {
    expect(berlinInputToIso("2026-10-25T01:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(berlinInputToIso("2026-10-25T04:00")).toBe("2026-10-25T03:00:00.000Z");
    expect(isoToBerlinInput("2026-10-25T03:00:00Z")).toBe("2026-10-25T04:00");
  });

  it("a late-evening UTC time is the next day in Berlin", () => {
    expect(berlinDate("2026-11-05T23:30:00Z")).toBe("2026-11-06");
    expect(berlinTime("2026-11-05T23:30:00Z")).toBe("00:30");
  });

  it("rejects malformed input", () => {
    expect(() => berlinInputToIso("05.11.2026 19:00")).toThrow();
  });

  it("formats in Berlin", () => {
    expect(formatDateTime("2026-11-05T18:00:00Z")).toBe("Thu, 5 Nov 2026, 19:00");
  });
});

describe("months", () => {
  it("labels and finds months in Berlin", () => {
    expect(monthLabel("2026-11-01")).toBe("November 2026");
    // A cycle is named by the month of its events, planned the month before.
    expect(cycleLabel("2026-12-01")).toBe("December 2026 events");
    expect(cyclePlannedIn("2026-12-01")).toBe("planned in November");
    expect(cyclePlannedIn("2027-01-01")).toBe("planned in December");
    // 23:30 UTC on 31 Oct is already November in Berlin.
    expect(monthOf("2026-10-31T23:30:00Z")).toBe("2026-11-01");
    expect(monthStartIso("2026-11-01")).toBe("2026-10-31T23:00:00.000Z");
    expect(nextMonthStartIso("2026-12-01")).toBe("2026-12-31T23:00:00.000Z");
  });

  it("counts the days a trip spans (Berlin calendar days)", () => {
    expect(daysSpanned("2026-11-06T16:00:00Z", "2026-11-08T18:00:00Z")).toBe(3);
    expect(daysSpanned("2026-11-06T16:00:00Z", null)).toBe(1);
    // 00:30 and 09:00 on 7 November in Berlin: one day.
    expect(daysSpanned("2026-11-06T23:30:00Z", "2026-11-07T08:00:00Z")).toBe(1);
    // 23:30 on 6 November to 09:00 on 7 November: two days.
    expect(daysSpanned("2026-11-06T22:30:00Z", "2026-11-07T08:00:00Z")).toBe(2);
  });
});

describe("money", () => {
  it.each([
    ["12,50", 1250],
    ["12.5", 1250],
    ["€ 12", 1200],
    ["0", 0],
    ["99.99", 9999],
    ["12 EUR", 1200],
  ])("parses %s", (raw, cents) => {
    expect(parseEuroToCents(raw)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "-5", "12.555", "1e3"])("refuses %j", (raw) => {
    expect(parseEuroToCents(raw)).toBeNull();
  });

  it("formats cents", () => {
    expect(formatCents(1250)).toBe("€ 12.50");
    expect(formatCents(5)).toBe("€ 0.05");
    expect(formatCents(null)).toBe("–");
  });
});

describe("deadline urgency (usability review #1)", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("amber within 48 hours, red within 24 hours or once passed", () => {
    expect(dueUrgency("2026-11-04T12:00:00Z", now)).toBe("later");
    expect(dueUrgency("2026-11-03T11:00:00Z", now)).toBe("soon");
    expect(dueUrgency("2026-11-02T11:00:00Z", now)).toBe("urgent");
    expect(dueUrgency("2026-10-31T12:00:00Z", now)).toBe("urgent");
  });
});
