import { describe, expect, it } from "vitest";
import { listState, signinsCloseAt, signinsOpenAt } from "@/lib/attendance/window";

const HOUR = 3_600_000;
const eventDate = "2026-11-05T18:00:00.000Z";
const at = (hours: number) => new Date(eventDate).getTime() + hours * HOUR;

describe("sign-in window", () => {
  it("opens 2 hours before and closes 24 hours after the event", () => {
    expect(signinsOpenAt(eventDate).toISOString()).toBe("2026-11-05T16:00:00.000Z");
    expect(signinsCloseAt(eventDate).toISOString()).toBe("2026-11-06T18:00:00.000Z");
  });

  it.each([
    [-2.01, "upcoming"],
    [-2, "open"],
    [0, "open"],
    [23.99, "open"],
    [24, "closed"],
  ] as const)("%s hours from the start is %s", (hours, state) => {
    expect(listState({ event_date: eventDate, signed_off_at: null }, at(hours))).toBe(state);
  });

  it("a sign-off closes the list at once", () => {
    expect(listState({ event_date: eventDate, signed_off_at: eventDate }, at(1))).toBe("closed");
  });
});
