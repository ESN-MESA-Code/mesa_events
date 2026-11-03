import { describe, expect, it } from "vitest";
import { descriptionDueAt, describeDescriptionReminders, describeHandinReminders, REMINDER_DEFAULTS, reminderDaysError } from "@/lib/reminders";

const base = { deadline: "2026-11-20T22:59:00Z", status: "missing", submittedAt: null, sentBackAt: null, startsAt: "2026-12-10T18:00:00Z", fixDays: 4 };

describe("descriptionDueAt (round 2026-11-03)", () => {
  it("never sent: the deadline; in: nothing", () => {
    expect(descriptionDueAt(base)).toBe(base.deadline);
    expect(descriptionDueAt({ ...base, status: "submitted", submittedAt: "2026-11-15T10:00:00Z" })).toBeNull();
    expect(descriptionDueAt({ ...base, deadline: null })).toBeNull();
  });

  it("sent back: 4 days after, not before the deadline, at the latest a day before the start", () => {
    const back = { ...base, status: "changes_requested", submittedAt: "2026-11-10T10:00:00Z" };
    expect(descriptionDueAt({ ...back, sentBackAt: "2026-11-12T10:00:00Z" })).toBe("2026-11-20T22:59:00.000Z");
    expect(descriptionDueAt({ ...back, sentBackAt: "2026-11-25T10:00:00Z" })).toBe("2026-11-29T10:00:00.000Z");
    expect(descriptionDueAt({ ...back, sentBackAt: "2026-12-08T10:00:00Z" })).toBe("2026-12-09T18:00:00.000Z");
  });
});

describe("the reminder setting", () => {
  it("describes itself and checks the ranges", () => {
    expect(describeDescriptionReminders(REMINDER_DEFAULTS)).toBe("OCs whose description is not in get a Chat reminder from 3 days before the deadline, every day, until it is in.");
    expect(describeHandinReminders({ ...REMINDER_DEFAULTS, handinDaysAfter: 0 })).toBe("Automatic hand-in reminders are off.");
    expect(reminderDaysError({ ...REMINDER_DEFAULTS, handinMax: 0 })).toMatch(/at most/);
    expect(reminderDaysError(REMINDER_DEFAULTS)).toBeNull();
  });
});
