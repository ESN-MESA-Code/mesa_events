import { describe, expect, it } from "vitest";
import { shownStatus } from "@/lib/labels";

const now = Date.parse("2026-11-03T12:00:00Z");

describe("shownStatus (review 2026-11-03 #10)", () => {
  it("follows the staffing until the event starts", () => {
    expect(shownStatus({ status: "confirmed", startsAt: "2026-11-04T18:00:00Z", short: true }, now)).toBe("understaffed");
    expect(shownStatus({ status: "understaffed", startsAt: "2026-11-04T18:00:00Z", short: false }, now)).toBe("confirmed");
  });

  it("is completed once the event ended; running while it lasts", () => {
    expect(shownStatus({ status: "confirmed", startsAt: "2026-11-02T19:00:00Z", short: false }, now)).toBe("completed");
    expect(shownStatus({ status: "understaffed", startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T20:00:00Z", short: true }, now)).toBe("confirmed");
  });

  it("keeps every other status", () => {
    for (const status of ["cancelled", "scheduled", "completed", "draft"] as const) expect(shownStatus({ status, startsAt: "2026-11-01T10:00:00Z", short: true }, now)).toBe(status);
  });
});
