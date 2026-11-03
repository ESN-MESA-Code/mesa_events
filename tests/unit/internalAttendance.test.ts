// Attendance of Tuesday Talks and internal events (round 2026-11-03 (2)).
import { describe, expect, it } from "vitest";
import { activityCsv, checkinUrl, checkinWindow, sortActivity, takesAttendance, type ActivityRow } from "@/lib/internalAttendance";

const NOW = Date.parse("2026-11-03T18:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const talk = (startsIn: number, endsIn: number | null, extra: Partial<{ status: string; attendance_closed_at: string | null }> = {}) => ({
  starts_at: at(startsIn),
  ends_at: endsIn === null ? null : at(endsIn),
  status: "scheduled",
  attendance_closed_at: null,
  ...extra,
});

describe("checking in", () => {
  it("only Tuesday Talks and internal events have a list", () => {
    expect(takesAttendance("tuesday_talk")).toBe(true);
    expect(takesAttendance("internal")).toBe(true);
    expect(takesAttendance("office_hour")).toBe(false);
    expect(takesAttendance("board_meeting")).toBe(false);
  });

  it("is open from 30 minutes before the start to 30 minutes after the end", () => {
    expect(checkinWindow(talk(31, 90), NOW).state).toBe("before");
    expect(checkinWindow(talk(29, 90), NOW).state).toBe("open");
    expect(checkinWindow(talk(-120, -29), NOW).state).toBe("open");
    expect(checkinWindow(talk(-120, -31), NOW).state).toBe("after");
    // Without an end: two hours.
    expect(checkinWindow(talk(-149, null), NOW).state).toBe("open");
    expect(checkinWindow(talk(-151, null), NOW).state).toBe("after");
  });

  it("closed by HR or cancelled wins over the time", () => {
    expect(checkinWindow(talk(-10, 60, { attendance_closed_at: at(-1) }), NOW).state).toBe("closed");
    expect(checkinWindow(talk(-10, 60, { status: "cancelled" }), NOW).state).toBe("cancelled");
  });

  it("the QR code opens the check-in page with its token", () => {
    expect(checkinUrl("https://x.test", "e1", "88.ab+")).toBe("https://x.test/checkin/e1?t=88.ab%2B");
  });
});

describe("activity", () => {
  const row = (full_name: string, n: Partial<ActivityRow> = {}): ActivityRow => ({ profile_id: full_name, full_name, email: `${full_name}@x`, oc_count: 0, helper_count: 0, office_hour_count: 0, talk_count: 0, meeting_count: 0, newbie: false, ...n });
  it("sorts numbers highest first, names A–Z", () => {
    const rows = [row("Bea", { talk_count: 2 }), row("Ali", { talk_count: 2 }), row("Cem", { talk_count: 5 })];
    expect(sortActivity(rows, "talk_count").map((r) => r.full_name)).toEqual(["Cem", "Ali", "Bea"]);
    expect(sortActivity(rows, "full_name").map((r) => r.full_name)).toEqual(["Ali", "Bea", "Cem"]);
  });
  it("exports a spreadsheet, quoting where needed", () => {
    const csv = activityCsv([row('Doe, "Jo"', { oc_count: 1, newbie: true })]).split("\n");
    expect(csv[0]).toBe("Name,Email,OC of an event,Helped at an event,Office hours,Tuesday Talks,Other meetings,Newbie");
    expect(csv[1]).toBe('"Doe, ""Jo""","Doe, ""Jo""@x",1,0,0,0,0,yes');
  });
});
