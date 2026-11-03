import { describe, expect, it } from "vitest";
import { checklistDone, eventChecklist, nextStep, stepLink, understaffedNote, type ChecklistInput } from "@/lib/checklist";

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
  photos: null,
  photosIn: false,
  reportIn: false,
  receipts: 0,
  belegeMissing: 0,
  myBelegeMissing: 0,
};
const state = (i: Partial<ChecklistInput>) => Object.fromEntries(eventChecklist({ ...base, ...i }).map((x) => [x.key, x.state]));

describe("event checklist", () => {
  it("before the event: team and space done, description to do, hand-in later", () => {
    expect(state({})).toEqual({ team: "done", chat: "done", description: "todo", attendance: "later", photos: "later", report: "later", receipts: "later" });
  });

  it("flags a missing OC or helpers, and a late description", () => {
    expect(state({ hasOc: false }).team).toBe("todo");
    expect(state({ helpers: 1 }).team).toBe("todo");
    expect(state({ now: Date.parse("2026-11-16T00:00:00Z") }).description).toBe("late");
    expect(state({ description: "published", now: Date.parse("2026-11-16T00:00:00Z") }).description).toBe("done");
  });

  it("after the event: the hand-in is due, Belege count", () => {
    const after = { now: Date.parse("2026-11-21T10:00:00Z"), description: "published" as const };
    expect(state(after)).toMatchObject({ attendance: "todo", photos: "todo", report: "todo", receipts: "todo" });
    expect(state({ ...after, listSignedOff: true, photos: 12, photosIn: true, receipts: 3, belegeMissing: 1 })).toMatchObject({ attendance: "done", photos: "done", receipts: "todo" });
    expect(checklistDone(eventChecklist({ ...base, ...after, listSignedOff: true, photos: 12, photosIn: true, receipts: 3, belegeMissing: 0 }))).toBe(false);
    const done = eventChecklist({ ...base, ...after, listSignedOff: true, photos: 12, photosIn: true, reportIn: true, receipts: 3, belegeMissing: 0 });
    expect(checklistDone(done)).toBe(true);
  });

  it("photos: the Drive count, or the OC's tick when Drive cannot be read", () => {
    const after = { now: Date.parse("2026-11-21T10:00:00Z") };
    const photos = (i: Partial<ChecklistInput>) => eventChecklist({ ...base, ...after, ...i }).find((x) => x.key === "photos")!;
    expect(photos({ photos: 0 })).toMatchObject({ state: "todo", label: "Photos in Drive" });
    expect(photos({ photos: 7, photosIn: true })).toMatchObject({ state: "done", detail: "7 in the folder" });
    expect(photos({ photos: null, photosIn: true })).toMatchObject({ state: "done", detail: "ticked by hand" });
  });

  it("cancelled events only keep open money matters", () => {
    expect(eventChecklist({ ...base, status: "cancelled" })).toEqual([]);
    expect(eventChecklist({ ...base, status: "cancelled", receipts: 1, belegeMissing: 1 }).map((x) => x.key)).toEqual(["receipts"]);
  });
});

describe("checklist links and deadlines", () => {
  it("every item says where it is done; the description carries its deadline until done", () => {
    const items = eventChecklist(base);
    expect(Object.fromEntries(items.map((x) => [x.key, x.tab]))).toEqual({ team: "", chat: "", description: "description", attendance: "attendance", photos: "hand-in", report: "hand-in", receipts: "hand-in" });
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
    expect(step({})).toEqual({ label: "Write the description", tab: "description", anchor: "description", due: base.descriptionDeadline, dueNote: "after that the event is cancelled", kind: "action" });
    expect(step({ description: "changes_requested" }).label).toMatch(/Fix the description/);
    expect(step({ description: "submitted" })).toMatchObject({ kind: "waiting" });
    expect(step({ description: "published" })).toMatchObject({ kind: "done", tab: "attendance" });
    expect(step({ now: after, description: "published" })).toMatchObject({ label: "Sign off the attendance list", tab: "attendance" });
    expect(step({ now: after, listSignedOff: true })).toMatchObject({ label: "Upload the photos to Drive and write the event report", tab: "hand-in" });
    expect(step({ now: after, listSignedOff: true, belegeMissing: 1, myBelegeMissing: 1 })).toMatchObject({ label: "Upload the photos to Drive, write the event report and hand in your paper receipts" });
    expect(step({ now: after, listSignedOff: true, photos: 3, photosIn: true, receipts: 1, belegeMissing: 1, myBelegeMissing: 1, reportIn: true })).toMatchObject({ label: "Hand in your paper receipts" });
    expect(step({ now: after, listSignedOff: true, photos: 3, photosIn: true })).toMatchObject({ label: "Write the event report", anchor: "hand-in-status" });
    expect(step({ now: after, listSignedOff: true, photos: 3, photosIn: true, reportIn: true })).toMatchObject({ kind: "done" });
  });

  it("says what the description deadline means (usability review #1)", () => {
    expect(step({ description: "missing" }).dueNote).toBe("after that the event is cancelled");
    // Submitted once (changes requested): late, never cancelled.
    expect(step({ description: "changes_requested" }).dueNote).toBeUndefined();
    expect(step({ descriptionDeadline: null }).dueNote).toBeUndefined();
  });

  it("the OC is not asked for someone else's Beleg (usability review #5)", () => {
    const done = { now: after, listSignedOff: true, photos: 3, photosIn: true, reportIn: true, receipts: 2 };
    expect(step({ ...done, belegeMissing: 1, myBelegeMissing: 0 })).toEqual({
      label: "The rest of the team still has to hand in 1 paper receipt – remind them in the Chat space",
      tab: "hand-in",
      anchor: "hand-in-status",
      kind: "waiting",
    });
    expect(step({ ...done, reportIn: false, belegeMissing: 1, myBelegeMissing: 0 })).toMatchObject({ label: "Write the event report", kind: "action" });
    expect(step({ status: "cancelled", receipts: 1, belegeMissing: 1, myBelegeMissing: 0 })).toMatchObject({ kind: "waiting" });
    expect(step({ status: "cancelled", receipts: 1, belegeMissing: 1, myBelegeMissing: 0 }, "helper")).toMatchObject({ kind: "done" });
  });

  it("a helper: help, then hand in their Belege", () => {
    expect(step({}, "helper")).toMatchObject({ kind: "waiting" });
    expect(step({ now: after, belegeMissing: 1, myBelegeMissing: 1 }, "helper")).toMatchObject({ label: "Hand the paper receipts to Finance", kind: "action" });
    expect(step({ now: after, belegeMissing: 1, myBelegeMissing: 0 }, "helper")).toMatchObject({ kind: "done" });
    expect(step({ now: after }, "helper")).toMatchObject({ kind: "done" });
  });

  it("cancelled events only need the money sorted out", () => {
    expect(step({ status: "cancelled", receipts: 1, belegeMissing: 1, myBelegeMissing: 1 })).toMatchObject({ kind: "action", tab: "hand-in" });
    expect(step({ status: "cancelled" })).toMatchObject({ kind: "done" });
  });
});

describe("next-step banner link (review 2026-10-29 B4)", () => {
  const id = "e1";
  it("on another tab: to the tab and the section", () => {
    expect(stepLink(id, { tab: "description", anchor: "description" }, "/events/e1")).toEqual({ href: "/events/e1/description#description", label: "Description →" });
    expect(stepLink(id, { tab: "", anchor: "decide" }, "/events/e1/hand-in")).toEqual({ href: "/events/e1#decide", label: "Overview →" });
  });
  it("on the step's own tab: down to the section, not a link to itself", () => {
    expect(stepLink(id, { tab: "", anchor: "decide" }, "/events/e1")).toEqual({ href: "#decide", label: "Go to it ↓" });
    expect(stepLink(id, { tab: "hand-in", anchor: "hand-in-status" }, "/events/e1/hand-in")).toEqual({ href: "#hand-in-status", label: "Go to it ↓" });
  });
});

describe("under-staffed banner (review 2026-10-29 B6)", () => {
  it("tells the OC they decide, everyone else who does", () => {
    expect(understaffedNote(true, "oc")).toBe("As OC you can run it as it is, or ask the Events team to cancel it.");
    expect(understaffedNote(true, "events")).toBe("The OC decides whether it runs; the Events team can decide in their place.");
    expect(understaffedNote(true, "other")).toBe("The OC decides whether it runs.");
  });
  it("without an OC, the Events team decides", () => {
    expect(understaffedNote(false, "events")).toMatch(/^Without an OC the Events team decides: find an OC/);
    expect(understaffedNote(false, "other")).toBe("Without an OC the Events team decides whether it runs.");
    // Even the former OC's view (they dropped out) does not say "As OC".
    expect(understaffedNote(false, "oc")).not.toContain("As OC");
  });
});
