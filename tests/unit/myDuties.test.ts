// Duties at office hours and Stammtisch in My events (round 2026-11-03 (2)):
// the next step from the time and the office hour's cash box.
import { describe, expect, it } from "vitest";
import { dutyStep, dutyTimed, type DutyData } from "@/lib/myDuties";

const NOW = Date.parse("2026-11-03T13:00:00Z"); // 14:00 Berlin
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const office = (startsIn: number, endsIn: number | null = startsIn + 2, status = "scheduled"): DutyData => ({
  id: "o",
  kind: "office_hour",
  title: "Office hour",
  status,
  starts_at: at(startsIn),
  ends_at: endsIn === null ? null : at(endsIn),
  location: "Office",
});

describe("duty steps", () => {
  it("before: nothing to do yet – the OC is reminded of the cash box", () => {
    expect(dutyStep(office(24), "oc", null, NOW)).toMatchObject({ kind: "waiting", label: "You run the office hour – count the cash box at the start" });
    expect(dutyStep(office(24), "helper", null, NOW)).toMatchObject({ kind: "waiting", label: "Help at the office hour" });
  });

  it("during: the OC counts first, then signs off at the end; the helper is on duty", () => {
    expect(dutyStep(office(-1), "oc", null, NOW)).toMatchObject({ kind: "action", cash: true, label: "Count the cash box before you open" });
    expect(dutyStep(office(-1), "oc", { openingCountedAt: at(-1), closedAt: null }, NOW)).toMatchObject({ kind: "waiting", cash: true });
    expect(dutyStep(office(-1), "helper", null, NOW)).toMatchObject({ kind: "waiting", label: "On duty now" });
  });

  it("after: the OC signs off an open box; then it is done", () => {
    expect(dutyStep(office(-5), "oc", { openingCountedAt: at(-5), closedAt: null }, NOW)).toMatchObject({ kind: "action", label: "Count and sign off the cash box" });
    expect(dutyStep(office(-5), "oc", null, NOW)).toMatchObject({ kind: "action" });
    expect(dutyStep(office(-5), "oc", { openingCountedAt: at(-5), closedAt: at(-3) }, NOW)).toMatchObject({ kind: "done", label: "Cash box signed off" });
    expect(dutyStep(office(-5), "helper", null, NOW)).toMatchObject({ kind: "done" });
  });

  it("a Stammtisch has no cash box; a cancelled duty is done; no end means two hours", () => {
    const stammtisch = { ...office(-3, null), kind: "stammtisch" as const };
    expect(dutyStep(stammtisch, "oc", null, NOW)).toMatchObject({ kind: "done", cash: false });
    expect(dutyStep({ ...stammtisch, starts_at: at(-1) }, "oc", null, NOW)).toMatchObject({ kind: "waiting", label: "On duty now" });
    expect(dutyStep(office(-1, 1, "cancelled"), "oc", null, NOW)).toMatchObject({ kind: "done", label: "Cancelled – no duty" });
    expect(dutyTimed({ starts_at: at(0), ends_at: null }).ends_at).toBe(at(2));
  });
});
