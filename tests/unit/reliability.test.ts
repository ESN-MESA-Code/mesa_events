import { describe, expect, it } from "vitest";
import { blacklistAllows, reliability, sortByConcern, type ReliabilityRow } from "@/lib/reliability";

const row = (over: Partial<ReliabilityRow> = {}): ReliabilityRow => ({
  profile_id: over.email ?? "x",
  full_name: "X",
  email: "x@esnmesa.org",
  events_done: 0,
  no_show: 0,
  short_notice: 0,
  late: 0,
  excused: 0,
  late_dropouts: 0,
  last_incident_at: null,
  blacklisted: false,
  blacklist_reason: null,
  blacklisted_by: null,
  blacklisted_at: null,
  ...over,
});

describe("reliability", () => {
  it("no events: no score", () => {
    expect(reliability(row())).toEqual({ commitments: 0, misses: 0, score: null, level: "none" });
  });

  it("everything done: reliable, 100%", () => {
    expect(reliability(row({ events_done: 4 }))).toMatchObject({ score: 100, level: "reliable" });
  });

  it("excused absences do not count", () => {
    expect(reliability(row({ events_done: 4, excused: 2 }))).toMatchObject({ score: 100, level: "reliable" });
  });

  it("one no-show in five: some issues", () => {
    expect(reliability(row({ events_done: 5, no_show: 1 }))).toMatchObject({ misses: 1, score: 80, level: "some_issues" });
  });

  it("late drop-outs are commitments and misses", () => {
    expect(reliability(row({ events_done: 3, late_dropouts: 1 }))).toMatchObject({ commitments: 4, misses: 1, score: 75 });
  });

  it("being late costs half", () => {
    expect(reliability(row({ events_done: 4, late: 1 }))).toMatchObject({ score: 88, level: "some_issues" });
  });

  it("two misses: unreliable, however many events", () => {
    expect(reliability(row({ events_done: 20, no_show: 1, short_notice: 1 })).level).toBe("unreliable");
  });

  it("a low score with enough events: unreliable", () => {
    expect(reliability(row({ events_done: 3, no_show: 1, late: 1 }))).toMatchObject({ score: 50, level: "unreliable" });
  });

  it("sorts the blacklist first, then the lowest score", () => {
    const rows = [
      row({ email: "a", full_name: "A", events_done: 3 }),
      row({ email: "b", full_name: "B", events_done: 3, no_show: 1 }),
      row({ email: "c", full_name: "C", blacklisted: true, events_done: 5 }),
      row({ email: "d", full_name: "D" }),
    ];
    expect(sortByConcern(rows).map((r) => r.email)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("blacklistAllows", () => {
  it("only as a helper on a non-crucial event", () => {
    expect(blacklistAllows("helper", true)).toBe(true);
    expect(blacklistAllows("helper", false)).toBe(false);
    expect(blacklistAllows("oc", true)).toBe(false);
  });
});
