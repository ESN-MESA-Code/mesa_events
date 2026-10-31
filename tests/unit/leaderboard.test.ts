import { describe, expect, it } from "vitest";
import { LEADER_CATEGORIES, leaderboards, top, totals, type LeaderRow } from "@/lib/leaderboard";

const row = (name: string, oc: number, helper: number, newbie = false, officeHours = 0): LeaderRow => ({
  profile_id: name,
  full_name: name,
  oc_count: oc,
  helper_count: helper,
  office_hour_count: officeHours,
  newbie,
});

describe("leaderboard", () => {
  it("ranks by count, then name; ties share a place; nobody with zero", () => {
    const rows = [row("Bea", 2, 0), row("Ada", 2, 1), row("Cem", 1, 3), row("Dan", 0, 3), row("Eva", 0, 1)];
    expect(top(rows, "oc_count")).toEqual([
      { id: "Ada", name: "Ada", count: 2, place: 1 },
      { id: "Bea", name: "Bea", count: 2, place: 1 },
      { id: "Cem", name: "Cem", count: 1, place: 3 },
    ]);
    expect(top(rows, "helper_count").map((r) => [r.name, r.place])).toEqual([
      ["Cem", 1],
      ["Dan", 1],
      ["Ada", 3],
      ["Eva", 3],
    ]);
  });

  it("stops after the top places (a long tie is cut at n + 2 names); Infinity ranks everyone", () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map((n) => row(n, 1, 0));
    expect(top(rows, "oc_count", 3)).toHaveLength(5);
    expect(top(rows, "oc_count", Infinity)).toHaveLength(7);
    expect(top([row("A", 3, 0), row("B", 2, 0), row("C", 1, 0), row("D", 1, 0), row("E", 0, 0)], "oc_count", 2).map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("active members and newbies apart, office hours as a third category", () => {
    const b = leaderboards([row("Ada", 2, 1, false, 1), row("Neo", 1, 4, true), row("Nia", 0, 2, true, 3)]);
    expect(b.active.oc_count.map((r) => r.name)).toEqual(["Ada"]);
    expect(b.newbies.oc_count.map((r) => r.name)).toEqual(["Neo"]);
    expect(b.newbies.helper_count.map((r) => r.name)).toEqual(["Neo", "Nia"]);
    expect(b.active.office_hour_count.map((r) => r.name)).toEqual(["Ada"]);
    expect(b.newbies.office_hour_count).toEqual([{ id: "Nia", name: "Nia", count: 3, place: 1 }]);
  });

  it("totals and units", () => {
    expect(totals([row("Ada", 2, 1, false, 1), row("Neo", 1, 4, true)])).toEqual({ oc_count: 3, helper_count: 5, office_hour_count: 1, people: 2 });
    expect(LEADER_CATEGORIES.map((c) => c.unit(1))).toEqual(["1 OC", "1 helped", "1 office hour"]);
    expect(LEADER_CATEGORIES[2].unit(2)).toBe("2 office hours");
  });
});
