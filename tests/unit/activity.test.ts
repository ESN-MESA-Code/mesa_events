import { describe, expect, it } from "vitest";
import { describeActivity, type LogEntry } from "@/lib/activity";

const names: Record<string, string> = { p1: "Hugo Helper" };
const say = (e: Partial<LogEntry>) => describeActivity({ entity: "events", action: "update", details: {}, actor_email: null, ...e }, (id) => names[id]);

describe("activity in plain language", () => {
  it("events", () => {
    expect(say({ action: "insert" })).toBe("Event added to the schedule");
    expect(say({ details: { status: "understaffed" } })).toBe("Status: Under-staffed");
    expect(say({ details: { location: "Pub", price_cents: 500 } })).toBe("Changed the location, price");
    expect(say({ details: { chat_space_name: "spaces/x", chat_space_url: "https://chat" } })).toBe("Chat space created");
    expect(say({ details: { updated_by: "x" } })).toBeNull();
  });

  it("roster: names who joined, not who dropped out (no reasons)", () => {
    expect(say({ entity: "assignments", action: "insert", details: { profile_id: "p1", role: "helper", source: "replacement" } })).toBe("Hugo Helper joined as helper (took an open slot)");
    expect(say({ entity: "assignments", details: { status: "dropped_out", dropped_at: "x" } })).toBe("Someone dropped out");
  });

  it("descriptions, reviews, the list; claims never", () => {
    expect(say({ entity: "descriptions", details: { status: "submitted" } })).toBe("Description submitted for Comms review");
    expect(say({ entity: "reviews", action: "insert", details: { decision: "changes_requested" } })).toBe("Comms asked for changes to the description");
    expect(say({ entity: "attendance_lists", details: { signed_off_at: "x", headcount: 12 } })).toBe("Attendance list signed off (12 counted)");
    expect(say({ entity: "reimbursements", action: "insert", details: { amount: 1 } })).toBeNull();
  });
});
