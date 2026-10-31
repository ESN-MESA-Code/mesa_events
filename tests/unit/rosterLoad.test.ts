import { describe, expect, it } from "vitest";
import { rosterLoad } from "@/lib/rosterLoad";

describe("roster load (usability review #20)", () => {
  it("counts each person's events and finds same-day ones", () => {
    const load = rosterLoad([
      { id: "quiz", day: "2026-11-04", profileIds: ["olga", "hugo"] },
      { id: "brunch", day: "2026-11-05", profileIds: ["olga"] },
      { id: "karaoke", day: "2026-11-05", profileIds: ["olga", "hugo"] },
    ]);
    expect(load.get("olga")!.count).toBe(3);
    expect(Object.fromEntries(load.get("olga")!.sameDay)).toEqual({ brunch: ["karaoke"], karaoke: ["brunch"] });
    expect(load.get("hugo")!.count).toBe(2);
    expect(load.get("hugo")!.sameDay.size).toBe(0);
  });
});
