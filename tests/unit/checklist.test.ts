import { describe, expect, it } from "vitest";
import { checklistDone, eventChecklist, nextStep, type ChecklistInput } from "@/lib/checklist";

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

describe("checklist links and deadlines", () => {
  it("every item says where it is done; the description carries its deadline until done", () => {
    const items = eventChecklist(base);
    expect(Object.fromEntries(items.map((x) => [x.key, x.tab]))).toEqual({ team: "", chat: "", description: "description", attendance: "attendance", photos: "hand-in", receipts: "hand-in" });
    expect(items.find((x) => x.key === "description")!.due).toBe(base.descriptionDeadline);
    expect(eventChecklist({ ...base, description: "published" }).find((x) => x.key === "description")!.due).toBeUndefined();
    expect(items.find((x) => x.key === "photos")!.detail).toBe("after the event");
  });
});

describe("next step", () => {
  const after = Date.parse("2026-11-21T12:00:00Z");
  const step = (i: Partial<ChecklistInput>, role: "oc" | "helper" = "oc") => nextStep({ ...base, ...i }, role);

  it("the OC: decide, write, wait for Comms, sign off, hand in", () => {
    expect(step({ status: "understaffed" })).toMatchObject({ label: "Decide: run under-staffed or cancel?", tab: "", kind: "action" });
    expect(step({})).toEqual({ label: "Write the description", tab: "description", due: base.descriptionDeadline, kind: "action" });
    expect(step({ description: "changes_requested" }).label).toMatch(/Fix the description/);
    expect(step({ description: "submitted" })).toMatchObject({ kind: "waiting" });
    expect(step({ description: "published" })).toMatchObject({ kind: "done", tab: "attendance" });
    expect(step({ now: after, description: "published" })).toMatchObject({ label: "Sign off the attendance list", tab: "attendance" });
    expect(step({ now: after, listSignedOff: true })).toMatchObject({ label: "Hand in photos and Belege", tab: "hand-in" });
    expect(step({ now: after, listSignedOff: true, photos: 3, receipts: 1, belegeMissing: 1 })).toMatchObject({ label: "Hand in photos and Belege" });
    expect(step({ now: after, listSignedOff: true, photos: 3 })).toMatchObject({ kind: "done" });
  });

  it("a helper: help, then hand in their Belege", () => {
    expect(step({}, "helper")).toMatchObject({ kind: "waiting" });
    expect(step({ now: after, belegeMissing: 1 }, "helper")).toMatchObject({ label: "Hand the paper Belege to Finance", kind: "action" });
    expect(step({ now: after }, "helper")).toMatchObject({ kind: "done" });
  });

  it("cancelled events only need the money sorted out", () => {
    expect(step({ status: "cancelled", receipts: 1, belegeMissing: 1 })).toMatchObject({ kind: "action", tab: "hand-in" });
    expect(step({ status: "cancelled" })).toMatchObject({ kind: "done" });
  });
});
