// The Calendar page's grouping, folding, week labels and venue (redesign 2026-11-04).
import { describe, expect, it } from "vitest";
import { dayLabel, dayRange, fillWeek, groupByDay, isoWeek, splitEarlier, typeLabelFor, venue, weekLabel, withToday, type CalEntry } from "@/lib/calendarView";
import { calendarWeeks } from "@/lib/month";

const entry = (day: string, time: string, o: Partial<CalEntry> = {}): CalEntry => ({
  key: `${day}-${time}-${o.title ?? ""}`,
  day,
  time,
  at: `${day}T${time}:00Z`,
  title: "x",
  href: "/x",
  category: "esn",
  typeLabel: null,
  cancelled: false,
  past: false,
  you: null,
  needs: [],
  place: null,
  ...o,
});

describe("calendar view", () => {
  it("groups by day in time order", () => {
    const groups = groupByDay([entry("2026-11-05", "20:00", { title: "b" }), entry("2026-11-04", "19:00"), entry("2026-11-05", "08:00", { title: "a" }), entry("2026-11-05", "23:59", { category: "deadline", title: "due" })]);
    expect(groups.map((g) => g.day)).toEqual(["2026-11-04", "2026-11-05"]);
    expect(groups[1].entries.map((e) => e.title)).toEqual(["a", "b", "due"]);
  });

  it("gives today a group in its own month only", () => {
    const g = groupByDay([entry("2026-11-02", "10:00"), entry("2026-11-09", "10:00")]);
    expect(withToday(g, "2026-11-04", "2026-11-01").map((x) => x.day)).toEqual(["2026-11-02", "2026-11-04", "2026-11-09"]);
    expect(withToday(g, "2026-12-04", "2026-11-01")).toBe(g);
  });

  it("folds the days before today, unless nothing follows", () => {
    const g = groupByDay([entry("2026-11-02", "10:00"), entry("2026-11-04", "10:00"), entry("2026-11-09", "10:00")]);
    const { earlier, rest } = splitEarlier(g, "2026-11-04", true);
    expect(earlier.map((x) => x.day)).toEqual(["2026-11-02"]);
    expect(rest.map((x) => x.day)).toEqual(["2026-11-04", "2026-11-09"]);
    expect(splitEarlier(g, "2026-11-30", true).earlier).toEqual([]);
    expect(splitEarlier(g, "2026-11-04", false).rest).toHaveLength(3);
  });

  it("names weeks and days", () => {
    expect(isoWeek("2026-11-16")).toBe(47);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2024-12-30")).toBe(1);
    expect(weekLabel("2026-11-18")).toBe("Week 47 · 16–22 Nov");
    expect(weekLabel("2026-12-01")).toBe("Week 49 · 30 Nov – 6 Dec");
    expect(dayLabel("2026-11-04")).toBe("Wed 4 Nov");
    expect(dayRange("2026-11-01", "2026-11-03")).toBe("1–3 Nov");
    expect(dayRange("2026-11-01", "2026-11-01")).toBe("1 Nov");
  });

  it("fills the grid's first and last weeks with the neighbouring months", () => {
    const weeks = calendarWeeks("2026-11-01");
    expect(fillWeek(weeks[0]).map((d) => d.day)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(fillWeek(weeks[0])[6].inMonth).toBe(true);
    expect(fillWeek(weeks[weeks.length - 1]).map((d) => d.day).slice(0, 2)).toEqual(["2026-11-30", "2026-12-01"]);
  });

  it("shortens places and drops labels the title already says", () => {
    expect(venue("Café Puck, Türkenstraße 33, 80799 München")).toBe("Café Puck");
    expect(venue("Online (Google Meet)")).toBe("Online (Google Meet)");
    expect(venue("  ")).toBeNull();
    expect(venue(null)).toBeNull();
    expect(typeLabelFor("Tuesday Talk: Inclusion", "Tuesday Talk")).toBeNull();
    expect(typeLabelFor("Office hour", "Office hour")).toBeNull();
    expect(typeLabelFor("Team bowling", "Internal event")).toBe("Internal event");
    expect(typeLabelFor("Pub quiz", null)).toBeNull();
  });
});
