import { describe, expect, it } from "vitest";
import { cycleProgress, type CycleFacts } from "@/lib/cycle";

const base: CycleFacts = {
  status: "planning",
  events: 0,
  openIdeas: 0,
  responses: 0,
  formClosesAt: null,
  descriptionDeadline: null,
  descriptions: { total: 0, in: 0, published: 0 },
};
const states = (f: CycleFacts) => cycleProgress(f).steps.map((s) => `${s.id}:${s.state}`).join(" ");

describe("cycle steps", () => {
  it("planning without events: ideas first", () => {
    const p = cycleProgress({ ...base, openIdeas: 2 });
    expect(p.current).toBe("ideas");
    expect(p.action).toBe("Accept or reject the 2 ideas, or add events");
    expect(states({ ...base })).toBe("ideas:current schedule:todo form:todo allocation:todo roster:todo descriptions:todo");
  });

  it("planning with events: the schedule, then the form", () => {
    expect(cycleProgress({ ...base, events: 3, openIdeas: 1 })).toMatchObject({ current: "schedule", summary: "3 events planned · 1 idea waiting" });
    expect(cycleProgress({ ...base, status: "form_open", events: 3, responses: 1 })).toMatchObject({ current: "form", summary: "form open · 1 answer" });
  });

  it("closed form → allocation; allocated → confirm the roster", () => {
    expect(cycleProgress({ ...base, status: "form_closed" })).toMatchObject({ current: "allocation", action: "Run the allocation" });
    expect(states({ ...base, status: "allocated" })).toBe("ideas:done schedule:done form:done allocation:done roster:current descriptions:todo");
  });

  it("confirmed: descriptions until all are in", () => {
    const p = cycleProgress({ ...base, status: "confirmed", descriptions: { total: 8, in: 5, published: 3 } });
    expect(p).toMatchObject({ current: "descriptions", summary: "roster confirmed · 5 of 8 descriptions in", action: "Set the description deadline" });
    expect(cycleProgress({ ...base, status: "confirmed", descriptionDeadline: "2026-11-30T23:00:00Z", descriptions: { total: 8, in: 5, published: 3 } }).action).toMatch(/Remind/);
    const done = cycleProgress({ ...base, status: "confirmed", descriptions: { total: 2, in: 2, published: 2 } });
    expect(done.current).toBeNull();
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
  });
});
