import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE,
  cycleTimeline,
  dayRange,
  firstOpenIdeaMonth,
  ideaDateOpen,
  milestoneDay,
  milestones,
  offStandard,
  parseTimelineDays,
  relativeDue,
  timelineDaysError,
  upcomingCycleMonth,
} from "@/lib/timeline";

const t = (iso: string) => Date.parse(iso);

describe("cycleTimeline", () => {
  it("puts every date in the month before the events, in Berlin", () => {
    expect(cycleTimeline("2026-12-01")).toEqual({
      month: "2026-12-01",
      plannedIn: "2026-11-01",
      ideasDue: "2026-11-07T22:59:00.000Z",
      formOpens: "2026-11-10T08:00:00.000Z",
      formCloses: "2026-11-15T22:59:00.000Z",
      rosterDue: "2026-11-17T22:59:00.000Z",
      descriptionsDue: "2026-11-20T22:59:00.000Z",
    });
  });

  it("crosses the year and summer time", () => {
    expect(cycleTimeline("2027-01-01").ideasDue).toBe("2026-12-07T22:59:00.000Z");
    // April events are planned in March: before the clocks change on the 28th.
    expect(cycleTimeline("2027-04-01").descriptionsDue).toBe("2027-03-20T22:59:00.000Z");
    expect(cycleTimeline("2027-05-01").formOpens).toBe("2027-04-10T07:00:00.000Z");
  });

  it("follows other days; the roster is never due after the descriptions", () => {
    const c = cycleTimeline("2026-12-01", { ideasDue: 3, formOpens: 5, formCloses: 19, descriptionsDue: 20 });
    expect(c.ideasDue).toBe("2026-11-03T22:59:00.000Z");
    expect(c.rosterDue).toBe(c.descriptionsDue);
  });
});

describe("ideas", () => {
  it("are open for next month until its deadline, then from the month after – any later month too", () => {
    expect(firstOpenIdeaMonth(t("2026-11-02T10:00:00Z"))).toBe("2026-12-01");
    expect(firstOpenIdeaMonth(t("2026-11-07T22:58:00Z"))).toBe("2026-12-01");
    expect(firstOpenIdeaMonth(t("2026-11-07T23:00:00Z"))).toBe("2027-01-01");
    expect(firstOpenIdeaMonth(t("2026-12-31T22:00:00Z"))).toBe("2027-02-01");
    expect(ideaDateOpen("2026-12-03", t("2026-11-02T10:00:00Z"))).toBe(true);
    expect(ideaDateOpen("2026-12-03", t("2026-11-08T10:00:00Z"))).toBe(false);
    expect(ideaDateOpen("2026-11-20", t("2026-11-02T10:00:00Z"))).toBe(false);
    expect(ideaDateOpen("2027-01-05", t("2026-11-08T10:00:00Z"))).toBe(true);
    expect(ideaDateOpen("2028-06-01", t("2026-11-08T10:00:00Z"))).toBe(true);
  });
});

describe("upcomingCycleMonth", () => {
  it("is next month until its descriptions are due", () => {
    expect(upcomingCycleMonth(t("2026-11-02T10:00:00Z"))).toBe("2026-12-01");
    expect(upcomingCycleMonth(t("2026-11-20T22:00:00Z"))).toBe("2026-12-01");
    expect(upcomingCycleMonth(t("2026-11-21T10:00:00Z"))).toBe("2027-01-01");
  });
});

describe("milestones", () => {
  it("marks what passed and the next one", () => {
    const m = milestones(cycleTimeline("2026-12-01"), t("2026-11-12T10:00:00Z"));
    expect(m.map((x) => [x.id, x.state])).toEqual([
      ["ideas", "passed"],
      ["formOpens", "passed"],
      ["formCloses", "next"],
      ["descriptions", "later"],
    ]);
    expect(milestones(cycleTimeline("2026-12-01"), t("2026-11-12T10:00:00Z"), { roster: true }).map((x) => x.id)).toContain("roster");
    expect(milestoneDay("2026-11-07T22:59:00.000Z")).toBe("7 Nov");
  });
});

describe("the setting", () => {
  it("falls back to the defaults when invalid", () => {
    expect(parseTimelineDays({ ideas_due: 6, form_opens: 9, form_closes: 14, descriptions_due: 21 })).toEqual({ ideasDue: 6, formOpens: 9, formCloses: 14, descriptionsDue: 21 });
    expect(parseTimelineDays(null)).toEqual(DEFAULT_TIMELINE);
    expect(parseTimelineDays({ ideas_due: 12, form_opens: 10, form_closes: 15, descriptions_due: 20 })).toEqual(DEFAULT_TIMELINE);
    expect(timelineDaysError({ ideasDue: 7, formOpens: 10, formCloses: 15, descriptionsDue: 30 })).toMatch(/1 to 28/);
    expect(timelineDaysError(DEFAULT_TIMELINE)).toBeNull();
  });

  it("tells a deadline off the standard", () => {
    const std = cycleTimeline("2026-12-01").formCloses;
    expect(offStandard(std, std)).toBe(false);
    expect(offStandard(null, std)).toBe(false);
    expect(offStandard("2026-11-14T22:59:00.000Z", std)).toBe(true);
  });
});

describe("labels", () => {
  it("ranges and how far a date is", () => {
    expect(dayRange("2026-11-10T08:00:00Z", "2026-11-15T22:59:00Z")).toBe("10–15 Nov");
    expect(dayRange("2026-11-28T08:00:00Z", "2026-12-02T22:59:00Z")).toBe("28 Nov–2 Dec");
    const due = "2026-11-07T22:59:00.000Z";
    expect(relativeDue(due, t("2026-11-02T10:00:00Z"))).toBe("in 5 days");
    expect(relativeDue(due, t("2026-11-06T09:00:00Z"))).toBe("tomorrow");
    expect(relativeDue(due, t("2026-11-07T08:00:00Z"))).toBe("today");
    expect(relativeDue(due, t("2026-11-07T20:30:00Z"))).toBe("in 2 hours");
    expect(relativeDue(due, t("2026-11-08T00:00:00Z"))).toBe("");
  });
});
