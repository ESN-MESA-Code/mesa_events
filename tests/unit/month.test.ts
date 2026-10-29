// One month at a time (brief 2026-10-29, C): the month parameter, the
// default month, the arrows; the Comms page's stages, filters and marks.
import { describe, expect, it } from "vitest";
import { monthParam, neighbours, parseMonthParam, pickMonth } from "@/lib/month";
import { eventStage, parseFilter, stageCounts, type StageInput } from "@/lib/commsStages";

describe("months", () => {
  it("reads ?month=YYYY-MM and nothing else", () => {
    expect(parseMonthParam("2026-11")).toBe("2026-11-01");
    expect(parseMonthParam(["2026-12", "x"])).toBe("2026-12-01");
    for (const bad of ["2026-13", "2026-1", "2026-11-01", "", undefined, null, "../x"]) expect(parseMonthParam(bad as string)).toBeNull();
    expect(monthParam("2026-11-01")).toBe("2026-11");
  });

  it("opens on the asked month, else the first with work, else this month, else the latest before it", () => {
    const opts = [
      { month: "2026-10-01", hasWork: false },
      { month: "2026-11-01", hasWork: true },
      { month: "2026-12-01", hasWork: true },
    ];
    expect(pickMonth(opts, "2026-12-01", "2026-10-01")).toBe("2026-12-01");
    expect(pickMonth(opts, "2027-05-01", "2026-10-01")).toBe("2026-11-01");
    expect(pickMonth(opts, null, "2026-10-01")).toBe("2026-11-01");
    const idle = opts.map((o) => ({ ...o, hasWork: false }));
    expect(pickMonth(idle, null, "2026-10-01")).toBe("2026-10-01");
    expect(pickMonth(idle, null, "2027-03-01")).toBe("2026-12-01");
    expect(pickMonth(idle, null, "2025-01-01")).toBe("2026-10-01");
    expect(pickMonth([], "2026-11-01", "2026-10-01")).toBe("2026-11-01");
  });

  it("the arrows go to the neighbouring months that exist", () => {
    const m = ["2026-12", "2026-10", "2026-11"];
    expect(neighbours(m, "2026-11")).toEqual({ prev: "2026-10", next: "2026-12" });
    expect(neighbours(m, "2026-10")).toEqual({ prev: null, next: "2026-11" });
    expect(neighbours(m, "2027-02")).toEqual({ prev: "2026-12", next: null });
  });
});

describe("Comms stages", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const ahead = "2026-11-20T18:00:00Z";
  const past = "2026-11-05T18:00:00Z";
  const base: StageInput = { description: "missing", startsAt: ahead, now, late: false, missed: false, reportIn: false, esn: "not_ready" };
  const stage = (i: Partial<StageInput>) => eventStage({ ...base, ...i });

  it("follows the description, the event, the report and ESN Activities", () => {
    expect(stage({}).current).toBe("write");
    expect(stage({ description: "changes_requested" }).current).toBe("write");
    expect(stage({ description: "submitted" })).toMatchObject({ current: "review", filter: "review", needsComms: true, position: 2 });
    expect(stage({ description: "approved" })).toMatchObject({ current: "approved", filter: "publish", needsComms: true });
    expect(stage({ description: "published" })).toMatchObject({ current: "published", filter: "waiting", needsComms: false });
    expect(stage({ description: "published", startsAt: past })).toMatchObject({ current: "report", filter: "report", needsComms: false, position: 6 });
    expect(stage({ description: "published", startsAt: past, reportIn: true, esn: "ready" })).toMatchObject({ current: "esn", filter: "esn", needsComms: true });
    expect(stage({ description: "published", startsAt: past, reportIn: true, esn: "not_ready" })).toMatchObject({ current: "esn", needsComms: false });
    const done = stage({ description: "published", startsAt: past, reportIn: true, esn: "uploaded" });
    expect(done).toMatchObject({ current: null, filter: "done", position: 7 });
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
  });

  it("highlights the current stage, ticks what is behind it", () => {
    expect(stage({ description: "approved" }).steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo", "todo", "todo"]);
  });

  it("late and missed are marks; late descriptions need Comms (chasing), missed ones move on", () => {
    expect(stage({ late: true })).toMatchObject({ marks: ["late"], needsComms: true });
    const missed = stage({ description: "draft", startsAt: past, missed: true });
    expect(missed).toMatchObject({ current: "report", marks: ["missed"] });
    expect(missed.steps.map((s) => s.state)).toEqual(["todo", "todo", "todo", "todo", "done", "current", "todo"]);
  });

  it("counts per filter and 'Needs Comms'; unknown filters fall back to it", () => {
    const counts = stageCounts([stage({ description: "submitted" }), stage({ description: "submitted" }), stage({ description: "approved" }), stage({})]);
    expect(counts).toMatchObject({ review: 2, publish: 1, write: 1, needs: 3, all: 4, esn: 0 });
    expect(parseFilter("esn")).toBe("esn");
    expect(parseFilter("all")).toBe("all");
    expect(parseFilter("nonsense")).toBe("needs");
    expect(parseFilter(undefined)).toBe("needs");
  });
});
