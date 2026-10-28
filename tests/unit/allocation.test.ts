import { describe, expect, it } from "vitest";
import { allocate, staffingStatus, type AllocationChoice, type AllocationEvent, type Rank } from "@/lib/allocation";

const ev = (id: string, helpersNeeded = 2, startsAt = "2026-11-05T18:00:00Z", extra: Partial<AllocationEvent> = {}): AllocationEvent => ({
  id,
  startsAt,
  helpersNeeded,
  ...extra,
});

let clock = Date.parse("2026-10-20T10:00:00Z");
/** A choice; each call is one minute later than the previous one (submission order). */
const pick = (profileId: string, eventId: string, ocRank: Rank | null, helperRank: Rank | null, chosenAt?: string): AllocationChoice => ({
  profileId,
  eventId,
  ocRank,
  helperRank,
  chosenAt: chosenAt ?? new Date((clock += 60_000)).toISOString(),
});

const rolesOf = (r: ReturnType<typeof allocate>, eventId: string) => ({
  oc: r.events[eventId].ocId,
  helpers: r.events[eventId].helperIds,
});

describe("allocate: priorities", () => {
  it("gives the OC to the highest OC priority, helpers by helper priority", () => {
    const r = allocate([ev("e1", 2)], [
      pick("ana", "e1", 2, 1),
      pick("ben", "e1", 1, null),
      pick("cem", "e1", null, 3),
      pick("dua", "e1", null, 1),
      pick("eli", "e1", null, 2),
    ]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "ben", helpers: ["ana", "dua"] });
    expect(r.events.e1.status).toBe("staffed");
  });

  it("the chosen OC is not also a helper; the next helper moves up", () => {
    const r = allocate([ev("e1", 1)], [pick("ana", "e1", 1, 1), pick("ben", "e1", null, 2)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "ana", helpers: ["ben"] });
  });

  it("someone who only wants to OC is not made a helper", () => {
    const r = allocate([ev("e1", 2)], [pick("ana", "e1", 1, null), pick("ben", "e1", 2, null)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "ana", helpers: [] });
    expect(r.events.e1.status).toBe("understaffed");
  });

  it("the idea's proposer is OC by default, ahead of everyone", () => {
    const r = allocate([ev("e1", 1, undefined, { defaultOcId: "pia" })], [pick("ana", "e1", 1, 2), pick("ben", "e1", null, 1)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "pia", helpers: ["ben"] });
    expect(r.assignments.find((a) => a.role === "oc")).toMatchObject({ profileId: "pia", source: "proposer" });
  });
});

describe("allocate: first come, first served on ties", () => {
  it("breaks equal ranks by the time the event was chosen", () => {
    const r = allocate([ev("e1", 1)], [
      pick("late", "e1", 1, 1, "2026-10-21T12:00:00Z"),
      pick("early", "e1", 1, 1, "2026-10-21T09:00:00Z"),
      pick("middle", "e1", null, 1, "2026-10-21T10:00:00Z"),
    ]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "early", helpers: ["middle"] });
  });

  it("a better rank beats an earlier submission", () => {
    const r = allocate([ev("e1", 1)], [pick("early", "e1", null, 2, "2026-10-21T09:00:00Z"), pick("late", "e1", null, 1, "2026-10-22T09:00:00Z")]);
    expect(rolesOf(r, "e1").helpers).toEqual(["late"]);
  });

  it("identical rank and time fall back to the id (never the input order)", () => {
    const t = "2026-10-21T09:00:00Z";
    const a = allocate([ev("e1", 1)], [pick("zoe", "e1", null, 1, t), pick("adam", "e1", null, 1, t)]);
    const b = allocate([ev("e1", 1)], [pick("adam", "e1", null, 1, t), pick("zoe", "e1", null, 1, t)]);
    expect(rolesOf(a, "e1").helpers).toEqual(["adam"]);
    expect(b).toEqual(a);
  });
});

describe("allocate: no caps", () => {
  it("one person may OC several events and help others", () => {
    const events = [ev("e1", 0, "2026-11-01T18:00:00Z"), ev("e2", 0, "2026-11-08T18:00:00Z"), ev("e3", 1, "2026-11-15T18:00:00Z")];
    const r = allocate(events, [pick("ana", "e1", 1, null), pick("ana", "e2", 1, null), pick("ana", "e3", null, 1), pick("ben", "e3", 1, null)]);
    expect(r.events.e1.ocId).toBe("ana");
    expect(r.events.e2.ocId).toBe("ana");
    expect(rolesOf(r, "e3")).toEqual({ oc: "ben", helpers: ["ana"] });
    expect(r.assignments.filter((a) => a.profileId === "ana")).toHaveLength(3);
  });

  it("reports overlapping assignments of one person as conflicts", () => {
    const events = [
      ev("e1", 1, "2026-11-05T18:00:00Z"),
      ev("e2", 1, "2026-11-05T19:00:00Z"),
      ev("e3", 1, "2026-11-06T18:00:00Z", { endsAt: "2026-11-06T20:00:00Z" }),
    ];
    const r = allocate(events, [pick("ana", "e1", 1, null), pick("ana", "e2", null, 1), pick("ana", "e3", 1, null)]);
    expect(r.conflicts).toEqual([{ profileId: "ana", eventIds: ["e1", "e2"] }]);
  });
});

describe("allocate: dropping and under-staffing", () => {
  it("drops events nobody signed up for", () => {
    const r = allocate([ev("e1"), ev("e2", 2, "2026-11-06T18:00:00Z")], [pick("ana", "e2", 1, null)]);
    expect(r.events.e1).toMatchObject({ status: "dropped", ocId: null, helperIds: [], signups: 0 });
    expect(r.assignments.every((a) => a.eventId === "e2")).toBe(true);
  });

  it("flags an OC with too few helpers as under-staffed", () => {
    const r = allocate([ev("e1", 3)], [pick("ana", "e1", 1, null), pick("ben", "e1", null, 1)]);
    expect(r.events.e1).toMatchObject({ status: "understaffed", helperIds: ["ben"], helpersNeeded: 3 });
  });

  it("flags helpers without an OC", () => {
    const r = allocate([ev("e1", 1)], [pick("ana", "e1", null, 1)]);
    expect(r.events.e1.status).toBe("no_oc");
  });

  it("an event needing no helpers is staffed with its OC", () => {
    expect(allocate([ev("e1", 0)], [pick("ana", "e1", 1, null)]).events.e1.status).toBe("staffed");
  });

  it.each([
    [false, 0, 2, "dropped"],
    [false, 1, 2, "no_oc"],
    [true, 1, 2, "understaffed"],
    [true, 2, 2, "staffed"],
    [true, 3, 2, "staffed"],
  ] as const)("staffingStatus(oc=%s, helpers=%s, needed=%s) = %s", (oc, helpers, needed, status) => {
    expect(staffingStatus(oc, helpers, needed)).toBe(status);
  });
});

describe("allocate: determinism", () => {
  it("gives the same roster for any order of events and choices", () => {
    const events = [ev("e1", 2, "2026-11-01T18:00:00Z"), ev("e2", 1, "2026-11-02T18:00:00Z"), ev("e3", 3, "2026-11-03T18:00:00Z")];
    const people = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const choices: AllocationChoice[] = [];
    let t = Date.parse("2026-10-20T00:00:00Z");
    for (const [i, p] of people.entries()) {
      for (const [j, e] of events.entries()) {
        if ((i + j) % 3 === 0) continue;
        choices.push(pick(p, e.id, (((i + j) % 3) + 1) as Rank, ((i % 3) + 1) as Rank, new Date((t += 3_600_000)).toISOString()));
      }
    }
    const reference = allocate(events, choices);
    for (let k = 0; k < 10; k++) {
      const shuffledEvents = [...events].sort(() => Math.random() - 0.5);
      const shuffledChoices = [...choices].sort(() => Math.random() - 0.5);
      expect(allocate(shuffledEvents, shuffledChoices)).toEqual(reference);
    }
  });

  it("ignores choices for events not in the cycle", () => {
    const r = allocate([ev("e1", 1)], [pick("ana", "other", 1, 1), pick("ben", "e1", null, 1)]);
    expect(r.assignments).toEqual([{ eventId: "e1", profileId: "ben", role: "helper", source: "auto" }]);
  });
});
