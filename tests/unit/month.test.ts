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
  const base: StageInput = { description: "missing", startsAt: ahead, now, late: false, missed: false, reportIn: false, pretix: false, advertised: false };
  const stage = (i: Partial<StageInput>) => eventStage({ ...base, ...i });

  it("follows the description, pretix, the advertising, the event and the report (round 2026-11-03)", () => {
    expect(stage({}).current).toBe("write");
    expect(stage({ description: "changes_requested" }).current).toBe("write");
    expect(stage({ description: "submitted" })).toMatchObject({ current: "review", filter: "review", needsComms: true, position: 2 });
    // Approved goes to the Chat space by itself: next is the pretix page, then the posts.
    expect(stage({ description: "approved" })).toMatchObject({ current: "pretix", filter: "pretix", needsComms: true, position: 4 });
    expect(stage({ description: "published" })).toMatchObject({ current: "pretix", filter: "pretix", needsComms: true });
    expect(stage({ description: "published", pretix: true })).toMatchObject({ current: "advertise", filter: "advertise", needsComms: true, position: 5 });
    // pretix comes first even when the posts are out.
    expect(stage({ description: "published", advertised: true })).toMatchObject({ current: "pretix" });
    expect(stage({ description: "published", pretix: true, advertised: true })).toMatchObject({ current: "happened", filter: "waiting", needsComms: false });
    expect(stage({ description: "published", startsAt: past })).toMatchObject({ current: "report", filter: "report", needsComms: false, position: 7 });
    const done = stage({ description: "published", startsAt: past, reportIn: true, pretix: true, advertised: true });
    expect(done).toMatchObject({ current: null, filter: "done", position: 7 });
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    expect(done.steps.map((s) => s.label)).toEqual(["To write", "In review", "Approved · in the Chat space", "pretix page", "Advertised", "Event happened", "Report"]);
  });

  it("highlights the current stage, ticks what is behind it", () => {
    expect(stage({ description: "approved" }).steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo", "todo", "todo"]);
    expect(stage({ description: "approved", pretix: true }).steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current", "todo", "todo"]);
  });

  it("late and missed are marks; late descriptions need Comms (chasing), missed ones move on", () => {
    expect(stage({ late: true })).toMatchObject({ marks: ["late"], needsComms: true });
    const missed = stage({ description: "draft", startsAt: past, missed: true });
    expect(missed).toMatchObject({ current: "report", marks: ["missed"] });
    expect(missed.steps.map((s) => s.state)).toEqual(["todo", "todo", "todo", "todo", "todo", "done", "current"]);
  });

  it("counts per filter and 'Needs Comms'; unknown filters fall back to it", () => {
    const counts = stageCounts([stage({ description: "submitted" }), stage({ description: "submitted" }), stage({ description: "approved" }), stage({ description: "approved", pretix: true }), stage({})]);
    expect(counts).toMatchObject({ review: 2, pretix: 1, advertise: 1, write: 1, needs: 4, all: 5 });
    expect(parseFilter("advertise")).toBe("advertise");
    expect(parseFilter("all")).toBe("all");
    // Gone since round 2026-11-03: publishing is automatic, ESN Activities has its own tab.
    expect(parseFilter("publish")).toBe("needs");
    expect(parseFilter("esn")).toBe("needs");
    expect(parseFilter("nonsense")).toBe("needs");
    expect(parseFilter(undefined)).toBe("needs");
  });
});

describe("calendar grid (round 2026-10-30)", () => {
  it("lays a month out in Monday-first weeks", async () => {
    const { calendarWeeks } = await import("@/lib/month");
    const weeks = calendarWeeks("2026-11-01");
    // 1 Nov 2026 is a Sunday: six blanks, then the 1st.
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(calendarWeeks("2027-02-01")).toHaveLength(4); // Feb 2027 starts on a Monday, 28 days
  });

  it("moves an event to another day, keeping the times (also across months)", async () => {
    const { moveToDay, dayDiff } = await import("@/lib/month");
    expect(moveToDay("2026-11-05T19:00", null, "2026-11-12")).toEqual({ start: "2026-11-12T19:00", end: null });
    expect(moveToDay("2026-11-28T09:00", "2026-11-29T18:00", "2026-11-30")).toEqual({ start: "2026-11-30T09:00", end: "2026-12-01T18:00" });
    expect(dayDiff("2026-10-31", "2026-11-01")).toBe(1);
  });
});
