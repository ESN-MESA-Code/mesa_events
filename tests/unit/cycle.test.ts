import { describe, expect, it } from "vitest";
import { cycleProgress, monthNote, stepHref, type CycleFacts } from "@/lib/cycle";
import { cycleTimeline } from "@/lib/timeline";

const base: CycleFacts = {
  status: "planning",
  events: 0,
  openIdeas: 0,
  responses: 0,
  formClosesAt: null,
  descriptionDeadline: null,
  descriptions: { total: 0, in: 0, published: 0, upcomingMissing: 0 },
  handIn: { total: 0, happened: 0, done: 0 },
};
const states = (f: CycleFacts) => cycleProgress(f).steps.map((s) => `${s.id}:${s.state}`).join(" ");

describe("cycle steps", () => {
  it("planning without events: ideas first", () => {
    const p = cycleProgress({ ...base, openIdeas: 2 });
    expect(p.current).toBe("ideas");
    expect(p.action).toBe("Accept or reject the 2 ideas, or add events");
    expect(states({ ...base })).toBe("ideas:current schedule:todo form:todo allocation:todo roster:todo descriptions:todo handin:todo done:todo");
  });

  it("planning with events: the schedule, then the form", () => {
    expect(cycleProgress({ ...base, events: 3, openIdeas: 1 })).toMatchObject({ current: "schedule", summary: "3 events planned · 1 idea waiting" });
    expect(cycleProgress({ ...base, status: "form_open", events: 3, responses: 1 })).toMatchObject({ current: "form", summary: "form open · 1 answer" });
  });

  it("closed form → allocation; allocated → confirm the roster", () => {
    expect(cycleProgress({ ...base, status: "form_closed" })).toMatchObject({ current: "allocation", action: "Run the allocation" });
    expect(states({ ...base, status: "allocated" })).toBe("ideas:done schedule:done form:done allocation:done roster:current descriptions:todo handin:todo done:todo");
  });

  const confirmed: CycleFacts = { ...base, status: "confirmed", handIn: { total: 8, happened: 0, done: 0 } };

  it("confirmed: descriptions while upcoming events miss theirs", () => {
    const p = cycleProgress({ ...confirmed, descriptions: { total: 8, in: 5, published: 3, upcomingMissing: 3 } });
    expect(p).toMatchObject({ current: "descriptions", summary: "roster confirmed · 5 of 8 descriptions in", action: "Set the description deadline", done: false });
    expect(cycleProgress({ ...confirmed, descriptionDeadline: "2026-11-30T23:00:00Z", descriptions: { total: 8, in: 5, published: 3, upcomingMissing: 3 } }).action).toBe("3 descriptions are not in yet – the OCs are reminded automatically");
  });

  it("all descriptions in: the hand-in, opening on each event's day", () => {
    const p = cycleProgress({ ...confirmed, descriptions: { total: 8, in: 8, published: 8, upcomingMissing: 0 } });
    expect(p).toMatchObject({ current: "handin", action: "Hand-in opens on each event's day", summary: "hand-in · 0 of 8 events handed in" });
  });

  it("no more reminders for descriptions once the events have happened (review 2026-10-29 A4)", () => {
    // Two events happened without a description: nothing to remind any more.
    const p = cycleProgress({ ...confirmed, descriptionDeadline: "2026-10-03T19:00:00Z", descriptions: { total: 5, in: 3, published: 3, upcomingMissing: 0 }, handIn: { total: 5, happened: 5, done: 3 } });
    expect(p.current).toBe("handin");
    expect(p.action).toBe("2 events are not handed in yet – the OCs are reminded automatically");
    expect(p.summary).toBe("hand-in · 3 of 5 events handed in");
    expect(cycleProgress({ ...confirmed, handIn: { total: 5, happened: 2, done: 1 } }).action).toBe("1 event is not handed in yet – the OCs are reminded automatically");
    expect(p.steps.map((s) => `${s.id}:${s.state}`).join(" ")).toBe("ideas:done schedule:done form:done allocation:done roster:done descriptions:done handin:current done:todo");
  });

  it("a running month: descriptions and hand-ins open at once (review 2026-11-03 #8)", () => {
    const p = cycleProgress({
      ...confirmed,
      now: Date.parse("2026-11-03T12:00:00Z"),
      descriptionDeadline: "2026-10-30T07:30:00Z",
      descriptions: { total: 12, in: 10, published: 8, upcomingMissing: 1 },
      handIn: { total: 12, happened: 6, done: 1 },
    });
    expect(p.current).toBe("descriptions");
    expect(p.todos).toEqual([
      { step: "descriptions", action: "1 description is not in yet – the OCs are reminded automatically" },
      { step: "handin", action: "5 events are not handed in yet – the OCs are reminded automatically" },
    ]);
    expect(p.summary).toBe("running · 10 of 12 descriptions in · 1 of 12 events handed in");
    expect(p.steps.map((s) => `${s.id}:${s.state}`).join(" ")).toBe("ideas:done schedule:done form:done allocation:done roster:done descriptions:current handin:current done:todo");
    expect(monthNote(p)).toBe("to do: descriptions, hand-in");
  });

  it("month notes say what is open, not a state", () => {
    expect(monthNote(cycleProgress({ ...base, status: "allocated" }))).toBe("to do: roster");
    expect(monthNote(cycleProgress({ ...confirmed, handIn: { total: 0, happened: 0, done: 0 } }))).toBe("done");
  });

  it("steps link to their tab; a done cycle to its hand-in", () => {
    expect(stepHref("c1", "ideas")).toBe("/team/events/cycles/c1/ideas");
    expect(stepHref("c1", "schedule")).toBe("/team/events/cycles/c1/schedule");
    expect(stepHref("c1", "handin")).toBe("/team/events/cycles/c1/hand-in");
    expect(stepHref("c1", "done")).toBe("/team/events/cycles/c1/hand-in");
  });

  it("every event happened and is handed in: done", () => {
    const done = cycleProgress({ ...confirmed, descriptions: { total: 2, in: 1, published: 1, upcomingMissing: 0 }, handIn: { total: 2, happened: 2, done: 2 } });
    expect(done).toMatchObject({ current: null, done: true, summary: "done · 2 of 2 events handed in" });
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    // Handed in early but an event is still ahead: not done.
    expect(cycleProgress({ ...confirmed, handIn: { total: 2, happened: 1, done: 1 } }).done).toBe(false);
    // Every event dropped or cancelled: nothing left.
    expect(cycleProgress({ ...confirmed, handIn: { total: 0, happened: 0, done: 0 } })).toMatchObject({ done: true, summary: "done · no events ran" });
  });

  describe("the timeline (round 2026-11-02)", () => {
    const timeline = cycleTimeline("2026-12-01");
    it("dates each step; the form opens by itself", () => {
      const p = cycleProgress({ ...base, events: 3, timeline, now: Date.parse("2026-11-08T10:00:00Z") });
      expect(p.steps.map((s) => s.note)).toEqual(["ideas by 7 Nov", "by 10 Nov", "10–15 Nov", undefined, "by 17 Nov", "by 20 Nov", undefined, undefined]);
      expect(p).toMatchObject({ late: false, action: "Set the event types – the form opens by itself on Tue 10 Nov, 09:00 (or open it earlier)" });
    });

    it("a form opened early: no standard dates running backwards (review 2026-11-03 #17)", () => {
      const p = cycleProgress({ ...base, status: "form_open", events: 3, formClosesAt: "2026-11-07T22:59:00Z", timeline, now: Date.parse("2026-11-03T10:00:00Z") });
      expect(p.steps.map((s) => s.note).slice(0, 3)).toEqual([undefined, undefined, "opened early · until 7 Nov"]);
    });

    it("is late when the form did not open, or the roster is not confirmed in time", () => {
      const p = cycleProgress({ ...base, timeline, now: Date.parse("2026-11-11T10:00:00Z") });
      expect(p).toMatchObject({ late: true, due: timeline.formOpens });
      expect(p.action).toMatch(/^Overdue since Tue 10 Nov: Add events/);
      expect(p.steps.find((s) => s.state === "current")?.late).toBe(true);
      expect(cycleProgress({ ...base, status: "allocated", timeline, now: Date.parse("2026-11-18T10:00:00Z") }).late).toBe(true);
      expect(cycleProgress({ ...base, status: "allocated", timeline, now: Date.parse("2026-11-16T10:00:00Z") }).late).toBe(false);
    });
  });
});
