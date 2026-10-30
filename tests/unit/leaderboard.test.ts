import { describe, expect, it } from "vitest";
import { leaderboards, top, type LeaderRow } from "@/lib/leaderboard";

const row = (name: string, oc: number, helper: number, newbie = false): LeaderRow => ({ profile_id: name, full_name: name, oc_count: oc, helper_count: helper, newbie });

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

  it("stops after the top places (a long tie is cut at n + 2 names)", () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map((n) => row(n, 1, 0));
    expect(top(rows, "oc_count", 3)).toHaveLength(5);
    expect(top([row("A", 3, 0), row("B", 2, 0), row("C", 1, 0), row("D", 1, 0), row("E", 0, 0)], "oc_count", 2).map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("active members and newbies apart", () => {
    const b = leaderboards([row("Ada", 2, 1), row("Neo", 1, 4, true), row("Nia", 0, 2, true)]);
    expect(b.active.oc.map((r) => r.name)).toEqual(["Ada"]);
    expect(b.newbies.oc.map((r) => r.name)).toEqual(["Neo"]);
    expect(b.newbies.helper.map((r) => r.name)).toEqual(["Neo", "Nia"]);
  });
});
