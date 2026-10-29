import { describe, expect, it } from "vitest";
import { eventGroup, groupEvents, handInState } from "@/lib/myEvents";

// 29 Oct 2026, 08:00 Berlin (CET, UTC+1).
const NOW = Date.parse("2026-10-29T07:00:00Z");

describe("eventGroup", () => {
  it("an event that started today early in the morning is Today, not Coming up or Past", () => {
    expect(eventGroup({ starts_at: "2026-10-28T23:13:00Z", ends_at: null }, NOW)).toBe("today"); // 00:13 Berlin
    expect(eventGroup({ starts_at: "2026-10-29T18:00:00Z", ends_at: null }, NOW)).toBe("today");
  });

  it("later days are Coming up, earlier ones Past, by the Berlin calendar day", () => {
    expect(eventGroup({ starts_at: "2026-10-29T23:30:00Z", ends_at: null }, NOW)).toBe("upcoming"); // 00:30 on the 30th
    expect(eventGroup({ starts_at: "2026-10-28T22:30:00Z", ends_at: null }, NOW)).toBe("past"); // 23:30 on the 28th
  });

  it("an event still running (a trip) is Today until it ends", () => {
    expect(eventGroup({ starts_at: "2026-10-27T07:00:00Z", ends_at: "2026-10-30T17:00:00Z" }, NOW)).toBe("today");
    expect(eventGroup({ starts_at: "2026-10-27T07:00:00Z", ends_at: "2026-10-29T06:00:00Z" }, NOW)).toBe("past");
  });

  it("runs in any time zone", () => {
    expect(process.env.TZ).toBe("America/New_York");
  });
});

describe("groupEvents", () => {
  it("sorts each group: Today and Coming up soonest first, Past newest first", () => {
    const list = [
      { id: "p1", starts_at: "2026-10-01T18:00:00Z", ends_at: null },
      { id: "u2", starts_at: "2026-11-20T18:00:00Z", ends_at: null },
      { id: "t1", starts_at: "2026-10-29T18:00:00Z", ends_at: null },
      { id: "p2", starts_at: "2026-10-22T18:00:00Z", ends_at: null },
      { id: "u1", starts_at: "2026-11-02T18:00:00Z", ends_at: null },
    ];
    const g = groupEvents(list, (x) => x, NOW);
    expect(g.today.map((x) => x.id)).toEqual(["t1"]);
    expect(g.upcoming.map((x) => x.id)).toEqual(["u1", "u2"]);
    expect(g.past.map((x) => x.id)).toEqual(["p2", "p1"]);
  });
});

describe("handInState", () => {
  it("open while the person has something to do, else done", () => {
    expect(handInState("completed", { label: "Sign off the attendance list", tab: "attendance", kind: "action" })).toEqual({ label: "Hand-in open", tone: "amber" });
    expect(handInState("completed", { label: "Hand-in complete", tab: "hand-in", kind: "done" })).toEqual({ label: "Done", tone: "green" });
    expect(handInState("confirmed", { label: "Paid for something? Register the receipt", tab: "hand-in", kind: "done" }).label).toBe("Done");
  });

  it("cancelled events: open only while Belege are missing", () => {
    expect(handInState("cancelled", { label: "Hand the Belege to Finance", tab: "hand-in", kind: "action" }).label).toBe("Hand-in open");
    expect(handInState("cancelled", { label: "Event cancelled – nothing left to do", tab: "", kind: "done" })).toEqual({ label: "Cancelled", tone: "red" });
  });
});
