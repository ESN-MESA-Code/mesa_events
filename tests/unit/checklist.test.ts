import { describe, expect, it } from "vitest";
import { checklistDone, eventChecklist, type ChecklistInput } from "@/lib/checklist";

const now = Date.parse("2026-11-10T12:00:00Z");
const base: ChecklistInput = {
  status: "confirmed",
  startsAt: "2026-11-20T18:00:00Z",
  now,
  hasOc: true,
  helpers: 2,
  helpersNeeded: 2,
  chatSpace: "created",
  description: "draft",
  descriptionDeadline: "2026-11-15T20:00:00Z",
  listSignedOff: false,
  photos: 0,
  receipts: 0,
  belegeMissing: 0,
};
const state = (i: Partial<ChecklistInput>) => Object.fromEntries(eventChecklist({ ...base, ...i }).map((x) => [x.key, x.state]));

describe("event checklist", () => {
  it("before the event: team and space done, description to do, hand-in later", () => {
    expect(state({})).toEqual({ team: "done", chat: "done", description: "todo", attendance: "later", photos: "later", receipts: "later" });
  });

  it("flags a missing OC or helpers, and a late description", () => {
    expect(state({ hasOc: false }).team).toBe("todo");
    expect(state({ helpers: 1 }).team).toBe("todo");
    expect(state({ now: Date.parse("2026-11-16T00:00:00Z") }).description).toBe("late");
    expect(state({ description: "published", now: Date.parse("2026-11-16T00:00:00Z") }).description).toBe("done");
  });

  it("after the event: the hand-in is due, Belege count", () => {
    const after = { now: Date.parse("2026-11-21T10:00:00Z"), description: "published" as const };
    expect(state(after)).toMatchObject({ attendance: "todo", photos: "todo", receipts: "todo" });
    expect(state({ ...after, listSignedOff: true, photos: 12, receipts: 3, belegeMissing: 1 })).toMatchObject({ attendance: "done", photos: "done", receipts: "todo" });
    const done = eventChecklist({ ...base, ...after, listSignedOff: true, photos: 12, receipts: 3, belegeMissing: 0 });
    expect(checklistDone(done)).toBe(true);
  });

  it("cancelled events only keep open money matters", () => {
    expect(eventChecklist({ ...base, status: "cancelled" })).toEqual([]);
    expect(eventChecklist({ ...base, status: "cancelled", receipts: 1, belegeMissing: 1 }).map((x) => x.key)).toEqual(["receipts"]);
  });
});
