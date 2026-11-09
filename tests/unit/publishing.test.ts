// The publishing schedule for events weeks ahead (round 2026-11-02): the
// list of a month holds the next months' events (big ones first), "Plan…"
// suggests any day before the event, what is still to plan counts the
// months ahead, and a far-ahead post names when its description is due.
import { describe, expect, it } from "vitest";
import { DRAFT_AHEAD_DAYS, advertisable, regularPosts, boardMonthFor, defaultPostDay, isBigEvent, listedAhead, postWarnings, stillToPlan, telegramRefusal, trayGroups, type PostEventFacts } from "@/lib/publishing";
import { defaultPictureOf } from "@/lib/publishingLoad";
import { calendarWeeks } from "@/lib/month";

const ev = (id: string, startsAt: string, type: string | null = "standard") => ({ id, startsAt, type });
const daysOf = (month: string) => calendarWeeks(month).flat().filter((d): d is string => !!d);
const novDays = daysOf("2026-11-01");

describe("the board's event list", () => {
  it("the month's own events by date, then later months grouped, big ones first", () => {
    const events = [
      ev("dec-quiz", "2026-12-03T18:00:00Z"),
      ev("nov-b", "2026-11-20T18:00:00Z"),
      ev("jan-trip", "2027-01-20T07:00:00Z", "weekend_trip"),
      ev("dec-party", "2026-12-19T20:00:00Z", "special"),
      ev("nov-a", "2026-11-04T18:00:00Z"),
      // An October event on one of November's posts stays with the month's own.
      ev("oct", "2026-10-30T18:00:00Z"),
      ev("dec-hike", "2026-12-08T08:00:00Z", "day_trip"),
    ];
    expect(trayGroups(events, "2026-11-01").map((g) => [g.month, g.later, g.events.map((e) => e.id)])).toEqual([
      ["2026-11-01", false, ["oct", "nov-a", "nov-b"]],
      ["2026-12-01", true, ["dec-hike", "dec-party", "dec-quiz"]],
      ["2027-01-01", true, ["jan-trip"]],
    ]);
    // The month's own group is there even when empty.
    expect(trayGroups([ev("dec", "2026-12-03T18:00:00Z")], "2026-11-01")[0]).toEqual({ month: "2026-11-01", later: false, events: [] });
  });

  it("lists up to three months ahead; big events are the specials and the trips", () => {
    expect(listedAhead("2026-12-01", "2026-11-01")).toBe(true);
    expect(listedAhead("2027-02-01", "2026-11-01")).toBe(true);
    expect(listedAhead("2027-03-01", "2026-11-01")).toBe(false);
    expect(listedAhead("2026-11-01", "2026-11-01")).toBe(false);
    expect(["special", "day_trip", "weekend_trip"].every(isBigEvent)).toBe(true);
    expect(isBigEvent("standard")).toBe(false);
    expect(isBigEvent(null)).toBe(false);
  });

  it("an event without posts is planned on the first board that lists it", () => {
    expect(boardMonthFor("2026-10-01", "2026-11-01")).toBe("2026-10-01");
    expect(boardMonthFor("2026-11-01", "2026-11-01")).toBe("2026-11-01");
    expect(boardMonthFor("2027-01-01", "2026-11-01")).toBe("2026-11-01");
    expect(boardMonthFor("2027-05-01", "2026-11-01")).toBe("2027-02-01");
  });
});

describe("the day Plan… suggests", () => {
  it("three days before, on this month's board when the event is later", () => {
    expect(defaultPostDay(novDays, "2026-11-02", "2026-11-20")).toBe("2026-11-17");
    // A January trip planned on the November board: November's last day.
    expect(defaultPostDay(novDays, "2026-11-02", "2027-01-20")).toBe("2026-11-30");
    // An event early next month: three days before it, in this month.
    expect(defaultPostDay(novDays, "2026-11-02", "2026-12-02")).toBe("2026-11-29");
  });

  it("today when three days before has passed, the event's day for a past event, the ideal day off the board", () => {
    expect(defaultPostDay(novDays, "2026-11-02", "2026-11-04")).toBe("2026-11-02");
    expect(defaultPostDay(novDays, "2026-11-10", "2026-11-04")).toBe("2026-11-04");
    // Looking at a past month: no board day is ahead – three days before the event.
    expect(defaultPostDay(daysOf("2026-10-01"), "2026-11-02", "2026-12-10")).toBe("2026-12-07");
  });
});

describe("still to plan", () => {
  const events = [ev("past", "2026-10-30T18:00:00Z"), ev("nov", "2026-11-20T18:00:00Z"), ev("jan", "2027-01-20T07:00:00Z", "weekend_trip"), ev("dec", "2026-12-08T08:00:00Z")];
  it("every upcoming event missing a required channel, in any month; skipped posts do not count", () => {
    const posts = [
      { channel: "telegram", status: "planned", events: ["nov", "jan"] },
      { channel: "instagram", status: "published", events: ["nov"] },
      { channel: "instagram", status: "skipped", events: ["jan"] },
    ];
    expect(stillToPlan(events, posts, ["telegram", "instagram"], "2026-11-02").map((e) => e.id)).toEqual(["jan", "dec"]);
    expect(stillToPlan(events, posts, [], "2026-11-02")).toEqual([]);
  });
});

describe("warnings on a far-ahead post", () => {
  const facts = (extra: Partial<PostEventFacts> = {}): PostEventFacts => ({ id: "e1", title: "Prague", startsAt: "2027-01-20T07:00:00Z", description: "missing", price: "TBA", ...extra });
  const post = { channel: "instagram", scheduledFor: "2026-11-25T09:00:00Z", status: "planned" };
  it("a post weeks before the event is fine; the missing description says when it is due", () => {
    expect(postWarnings(post, [facts({ deadline: "2026-12-20T22:59:00Z" })], new Map())).toEqual(["“Prague”: description not approved yet (due Sun 20 Dec)"]);
    expect(postWarnings(post, [facts()], new Map())).toEqual(["“Prague”: description not approved yet"]);
    expect(postWarnings(post, [facts({ description: "approved", price: "25" })], new Map())).toEqual([]);
  });
});

describe("advertising a month ahead (round 2026-11-09)", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();
  it("drafts only within six weeks; fixed events always; cancelled never", () => {
    expect(advertisable({ status: "draft", startsAt: inDays(30) }, now)).toBe(true);
    expect(advertisable({ status: "draft", startsAt: inDays(DRAFT_AHEAD_DAYS + 1) }, now)).toBe(false);
    expect(advertisable({ status: "scheduled", startsAt: inDays(80) }, now)).toBe(true);
    expect(advertisable({ status: "cancelled", startsAt: inDays(3) }, now)).toBe(false);
  });
  it("a draft is warned about, a cancelled event refused on Telegram", () => {
    const e: PostEventFacts = { id: "a", title: "Hike", startsAt: inDays(20), description: "approved", price: "5 €", eventStatus: "draft" };
    expect(postWarnings({ channel: "instagram", scheduledFor: inDays(1), status: "planned" }, [e], new Map())).toEqual([expect.stringContaining("still a draft")]);
    expect(telegramRefusal([e])).toBeNull();
    expect(telegramRefusal([{ ...e, eventStatus: "cancelled" }])).toBe("“Hike” is cancelled.");
  });
});

describe("default pictures (round 2026-11-09)", () => {
  const rows = [
    { format_id: "f1", category_id: null, event_type: null, picture: "library:f1.png" },
    { format_id: null, category_id: "c1", event_type: null, picture: "library:c1.png" },
    { format_id: null, category_id: null, event_type: "standard", picture: "library:std.png" },
  ];
  it("format, else category, else type", () => {
    expect(defaultPictureOf({ format_id: "f1", category_id: "c1", type: "standard" }, rows)).toBe("library:f1.png");
    expect(defaultPictureOf({ format_id: "f2", category_id: "c1", type: "standard" }, rows)).toBe("library:c1.png");
    expect(defaultPictureOf({ format_id: null, category_id: "c2", type: "standard" }, rows)).toBe("library:std.png");
    expect(defaultPictureOf({ format_id: null, category_id: null, type: "special" }, rows)).toBeNull();
  });
});

describe("regular posts (round 2026-11-09)", () => {
  it("a This week story every Sunday for the coming week, next month's calendar two days before the month ends", () => {
    expect(regularPosts("2026-11-01")).toEqual([
      { day: "2026-11-01", title: "This week 2–8 Nov", format: "story", kind: "weekly" },
      { day: "2026-11-08", title: "This week 9–15 Nov", format: "story", kind: "weekly" },
      { day: "2026-11-15", title: "This week 16–22 Nov", format: "story", kind: "weekly" },
      { day: "2026-11-22", title: "This week 23–29 Nov", format: "story", kind: "weekly" },
      { day: "2026-11-29", title: "This week 30 Nov – 6 Dec", format: "story", kind: "weekly" },
      { day: "2026-11-29", title: "December calendar", format: "post", kind: "calendar" },
    ]);
    expect(regularPosts("2026-11-01", "2026-11-20").map((p) => p.day)).toEqual(["2026-11-22", "2026-11-29", "2026-11-29"]);
  });
});
