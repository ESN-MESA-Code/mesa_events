import { describe, expect, it } from "vitest";
import { allocate, staffingStatus, type AllocationChoice, type AllocationEvent, type AllocationPerson, type Rank } from "@/lib/allocation";

const ev = (id: string, helpersNeeded = 2, startsAt = "2026-11-05T18:00:00Z", extra: Partial<AllocationEvent> = {}): AllocationEvent => ({
  id,
  startsAt,
  helpersNeeded,
  ...extra,
});
/** Events on different days, so they never overlap. */
const day = (id: string, d: number, helpersNeeded = 1, extra: Partial<AllocationEvent> = {}) => ev(id, helpersNeeded, `2026-11-${String(d).padStart(2, "0")}T18:00:00Z`, extra);

const pick = (profileId: string, eventId: string, ocRank: Rank | null, helperRank: Rank | null): AllocationChoice => ({ profileId, eventId, ocRank, helperRank });
const run = (events: AllocationEvent[], choices: AllocationChoice[], people: AllocationPerson[] = [], seed = "cycle-1") => allocate(events, choices, { seed, people });

const rolesOf = (r: ReturnType<typeof allocate>, eventId: string) => ({
  oc: r.events[eventId].ocIds[0] ?? null,
  helpers: r.events[eventId].helperIds,
});
const eventsOf = (r: ReturnType<typeof allocate>, profileId: string) => r.assignments.filter((a) => a.profileId === profileId).map((a) => a.eventId);

describe("allocate: priorities", () => {
  it("gives the OC to the best OC rank, helpers by helper rank", () => {
    const r = run([ev("e1", 2)], [pick("ana", "e1", 3, 1), pick("ben", "e1", 1, null), pick("cem", "e1", null, 5), pick("dua", "e1", null, 1), pick("eli", "e1", null, 3)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "ben", helpers: ["ana", "dua"] });
    expect(r.events.e1.status).toBe("staffed");
  });

  it("a lone top choice beats a lone if needed", () => {
    const r = run([ev("e1", 1)], [pick("cem", "e1", null, 5), pick("dua", "e1", null, 1)]);
    expect(rolesOf(r, "e1").helpers).toEqual(["dua"]);
  });

  it("marking everything top choice makes each count for less", () => {
    const events = [day("e1", 1), day("e2", 2), day("e3", 3)];
    const choices = [...events.map((e) => pick("ana", e.id, null, 1)), pick("ben", "e1", null, 1), pick("ben", "e2", null, 5), pick("ben", "e3", null, 5)];
    const limits = [{ profileId: "ana", maxEvents: 1 }, { profileId: "ben", maxEvents: 1 }];
    // Both want one event and both said "top choice" for e1: ben's honest answers beat ana's "everything is top", whatever the lottery.
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) expect(rolesOf(run(events, choices, limits, seed), "e1").helpers).toEqual(["ben"]);
  });

  it("the chosen OC is not also a helper; the next helper moves up", () => {
    const r = run([ev("e1", 1)], [pick("ana", "e1", 1, 1), pick("ben", "e1", null, 3)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "ana", helpers: ["ben"] });
  });

  it("someone who only wants to OC is not made a helper", () => {
    const r = run([ev("e1", 2)], [pick("ana", "e1", 1, null), pick("ben", "e1", 3, null)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "ana", helpers: [] });
    expect(r.events.e1.status).toBe("understaffed");
  });
});

describe("allocate: the idea's proposer", () => {
  it("is OC by default, ahead of everyone, and not also its helper", () => {
    const r = run([ev("e1", 1, undefined, { fixed: [{ profileId: "pia", role: "oc" }] })], [pick("ana", "e1", 1, 3), pick("ben", "e1", null, 1), pick("pia", "e1", null, 1)]);
    expect(rolesOf(r, "e1")).toEqual({ oc: "pia", helpers: ["ben"] });
    expect(r.assignments.find((a) => a.role === "oc")).toMatchObject({ profileId: "pia", source: "proposer" });
  });

  it("counts towards the proposer's limits", () => {
    const r = run([day("e1", 1, 1, { fixed: [{ profileId: "pia", role: "oc" }] }), day("e2", 2)], [pick("pia", "e2", null, 1)], [{ profileId: "pia", maxEvents: 1 }]);
    expect(eventsOf(r, "pia")).toEqual(["e1"]);
    expect(r.events.e2.status).toBe("dropped");
  });

  it("keeps the earlier of two overlapping ideas and reports the other", () => {
    const r = run([ev("e1", 1, "2026-11-05T18:00:00Z", { fixed: [{ profileId: "pia", role: "oc" }] }), ev("e2", 1, "2026-11-05T19:00:00Z", { fixed: [{ profileId: "pia", role: "oc" }] })], [pick("ben", "e2", null, 1)]);
    expect(rolesOf(r, "e1").oc).toBe("pia");
    expect(r.events.e2).toMatchObject({ status: "no_oc", ocIds: [], helperIds: ["ben"] });
    expect(r.issues).toEqual([{ kind: "fixed_clash", eventId: "e2", profileId: "pia", role: "oc", otherEventId: "e1" }]);
    expect(r.conflicts).toEqual([]);
  });
});

describe("allocate: partners and several OCs", () => {
  it("places the partners who said yes: a co-OC and a helper", () => {
    const r = run([ev("e1", 2, undefined, { ocsNeeded: 2, fixed: [{ profileId: "pia", role: "oc" }, { profileId: "max", role: "oc" }, { profileId: "hal", role: "helper" }] })], [
      pick("ana", "e1", null, 1),
      pick("ben", "e1", null, 3),
    ]);
    expect(r.events.e1).toMatchObject({ status: "staffed", ocIds: ["max", "pia"], ocsNeeded: 2 });
    expect(r.events.e1.helperIds).toEqual(["hal", "ana"]);
    expect(r.assignments.filter((a) => a.source === "proposer").map((a) => a.profileId)).toEqual(["max", "pia", "hal"]);
  });

  it("fills open OC slots from the form, next to the fixed OC", () => {
    const r = run([ev("e1", 0, undefined, { ocsNeeded: 2, fixed: [{ profileId: "pia", role: "oc" }] })], [pick("ana", "e1", 1, null), pick("ben", "e1", 5, null)]);
    expect(r.events.e1.ocIds).toEqual(["pia", "ana"]);
  });

  it("fills several OC slots without a proposer; too few OCs is under-staffed", () => {
    const r = run([ev("e1", 0, undefined, { ocsNeeded: 3 })], [pick("ana", "e1", 1, null), pick("ben", "e1", 3, null)]);
    expect(r.events.e1).toMatchObject({ status: "understaffed", ocIds: expect.arrayContaining(["ana", "ben"]) });
    expect(r.events.e1.ocIds).toHaveLength(2);
  });

  it("the event short of most OCs per slot gets its OC first", () => {
    // ana is the only OC candidate for e2 (2 slots) and one of two for e1: she goes to e2.
    const r = run([day("e1", 1, 0), day("e2", 2, 0, { ocsNeeded: 2 })], [pick("ana", "e1", 1, null), pick("ben", "e1", 1, null), pick("ana", "e2", 1, null)], [{ profileId: "ana", maxOc: 1 }]);
    expect(r.events.e2.ocIds).toEqual(["ana"]);
    expect(r.events.e1.ocIds).toEqual(["ben"]);
  });
});

describe("allocate: limits and overlaps", () => {
  it("never puts anyone on two overlapping events", () => {
    const events = [ev("e1", 1, "2026-11-05T18:00:00Z"), ev("e2", 1, "2026-11-05T19:00:00Z"), ev("e3", 1, "2026-11-06T18:00:00Z", { endsAt: "2026-11-06T20:00:00Z" })];
    const r = run(events, [pick("ana", "e1", 1, null), pick("ana", "e2", null, 1), pick("ana", "e3", 1, null)]);
    expect(eventsOf(r, "ana")).toEqual(["e1", "e3"]);
    expect(r.conflicts).toEqual([]);
  });

  it("an event without an end lasts three hours", () => {
    const r = run([ev("e1", 1, "2026-11-05T18:00:00Z"), ev("e2", 1, "2026-11-05T21:00:00Z")], [pick("ana", "e1", null, 1), pick("ana", "e2", null, 1)]);
    expect(eventsOf(r, "ana")).toEqual(["e1", "e2"]);
  });

  it("gives nobody more events than they can do", () => {
    const events = [day("e1", 1), day("e2", 2), day("e3", 3)];
    const r = run(events, events.map((e) => pick("ana", e.id, null, 1)), [{ profileId: "ana", maxEvents: 2 }]);
    expect(eventsOf(r, "ana")).toHaveLength(2);
  });

  it("without limits, one person may OC several events and help others", () => {
    const r = run([day("e1", 1, 0), day("e2", 2, 0), day("e3", 3, 1)], [pick("ana", "e1", 1, null), pick("ana", "e2", 1, null), pick("ana", "e3", null, 1), pick("ben", "e3", 1, null)]);
    expect(r.events.e1.ocIds[0]).toBe("ana");
    expect(r.events.e2.ocIds[0]).toBe("ana");
    expect(rolesOf(r, "e3")).toEqual({ oc: "ben", helpers: ["ana"] });
  });

  it("maxOc 1: a second OC role goes to the next candidate", () => {
    const r = run([day("e1", 1, 0), day("e2", 2, 0)], [pick("ana", "e1", 1, null), pick("ana", "e2", 1, null), pick("ben", "e2", 5, null)], [{ profileId: "ana", maxOc: 1 }]);
    expect([r.events.e1.ocIds[0], r.events.e2.ocIds[0]]).toEqual(["ana", "ben"]);
  });

  it("nobody OCs a second event while someone without an OC role can take it", () => {
    // ana is the only OC for e1 and the keener one for e2: e1 goes to her, e2 to ben.
    const r = run([day("e1", 1, 0), day("e2", 2, 0)], [pick("ana", "e1", 1, null), pick("ana", "e2", 1, null), pick("ben", "e2", 3, null)]);
    expect([r.events.e1.ocIds[0], r.events.e2.ocIds[0]]).toEqual(["ana", "ben"]);
  });
});

describe("allocate: fair rounds", () => {
  it("everyone gets one event before anyone gets a second", () => {
    const events = [day("e1", 1), day("e2", 2), day("e3", 3)];
    const r = run(events, [...events.map((e) => pick("ana", e.id, null, 1)), pick("ben", "e1", null, 5)]);
    expect(rolesOf(r, "e1").helpers).toEqual(["ben"]);
    expect(eventsOf(r, "ana")).toEqual(["e2", "e3"]);
  });

  it("an OC is not a helper elsewhere in round 1", () => {
    const r = run([day("e1", 1, 0), day("e2", 2, 1)], [pick("ana", "e1", 1, null), pick("ana", "e2", null, 1), pick("ben", "e2", null, 5)]);
    expect(rolesOf(r, "e2").helpers).toEqual(["ben"]);
  });

  it("fills the scarcest event first: an if needed goes where nobody else can", () => {
    const r = run([day("a", 1), day("b", 2)], [pick("pat", "a", null, 1), pick("pat", "b", null, 5), pick("quinn", "a", null, 3)], [{ profileId: "pat", maxEvents: 1 }]);
    expect(rolesOf(r, "b").helpers).toEqual(["pat"]);
    expect(rolesOf(r, "a").helpers).toEqual(["quinn"]);
  });

  it("someone who got nothing last month wins a tie; many recent events lose it", () => {
    const tie = [pick("ana", "e1", null, 1), pick("ben", "e1", null, 1)];
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      expect(rolesOf(run([ev("e1", 1)], tie, [{ profileId: "ben", unplacedLastCycle: true }], seed), "e1").helpers).toEqual(["ben"]);
      expect(rolesOf(run([ev("e1", 1)], tie, [{ profileId: "ana", recentEvents: 4 }], seed), "e1").helpers).toEqual(["ben"]);
    }
  });

  it("prefers experience for the OC and next to a first-time OC", () => {
    const r = run([ev("e1", 1)], [pick("new", "e1", 1, null), pick("old", "e1", 1, null), pick("h1", "e1", null, 1), pick("h2", "e1", null, 1)], [
      { profileId: "old", pastEvents: 5 },
      { profileId: "h2", pastEvents: 1 },
    ]);
    expect(rolesOf(r, "e1").oc).toBe("old");
    // The OC is experienced: no bonus for h2, so the lottery decides – but a first-time OC gets h2.
    const r2 = run([ev("e1", 1)], [pick("new", "e1", 1, null), pick("h1", "e1", null, 1), pick("h2", "e1", null, 1)], [{ profileId: "h2", pastEvents: 1 }]);
    expect(rolesOf(r2, "e1")).toEqual({ oc: "new", helpers: ["h2"] });
  });
});

describe("allocate: ties", () => {
  it("are drawn by the cycle's lottery, never by the input order", () => {
    const choices = ["p1", "p2", "p3", "p4", "p5", "p6"].map((p) => pick(p, "e1", null, 1));
    const winners = new Set(["s1", "s2", "s3", "s4", "s5", "s6"].map((seed) => rolesOf(run([ev("e1", 1)], choices, [], seed), "e1").helpers[0]));
    // Different cycles, different winners (not always the smallest id).
    expect(winners.size).toBeGreaterThan(1);
    expect(run([ev("e1", 1)], [...choices].reverse(), [], "s1")).toEqual(run([ev("e1", 1)], choices, [], "s1"));
  });
});

describe("allocate: dropping and under-staffing", () => {
  it("drops events nobody signed up for", () => {
    const r = run([ev("e1"), ev("e2", 2, "2026-11-06T18:00:00Z")], [pick("ana", "e2", 1, null)]);
    expect(r.events.e1).toMatchObject({ status: "dropped", ocIds: [], helperIds: [], signups: 0 });
    expect(r.assignments.every((a) => a.eventId === "e2")).toBe(true);
  });

  it("flags an OC with too few helpers as under-staffed", () => {
    const r = run([ev("e1", 3)], [pick("ana", "e1", 1, null), pick("ben", "e1", null, 1)]);
    expect(r.events.e1).toMatchObject({ status: "understaffed", helperIds: ["ben"], helpersNeeded: 3 });
  });

  it("flags helpers without an OC", () => {
    expect(run([ev("e1", 1)], [pick("ana", "e1", null, 1)]).events.e1.status).toBe("no_oc");
  });

  it("an event needing no helpers is staffed with its OC", () => {
    expect(run([ev("e1", 0)], [pick("ana", "e1", 1, null)]).events.e1.status).toBe("staffed");
  });

  it.each([
    [0, 1, 0, 2, "dropped"],
    [0, 1, 1, 2, "no_oc"],
    [1, 1, 1, 2, "understaffed"],
    [1, 1, 2, 2, "staffed"],
    [1, 1, 3, 2, "staffed"],
    [1, 2, 2, 2, "understaffed"],
    [2, 2, 2, 2, "staffed"],
  ] as const)("staffingStatus(ocs=%s of %s, helpers=%s of %s) = %s", (ocs, ocsNeeded, helpers, needed, status) => {
    expect(staffingStatus(ocs, ocsNeeded, helpers, needed)).toBe(status);
  });
});

describe("allocate: summary", () => {
  it("lists who got nothing and counts the top choices met", () => {
    const r = run([ev("e1", 1)], [pick("ana", "e1", 1, null), pick("ben", "e1", null, 1), pick("cem", "e1", null, 1)]);
    expect(r.unplaced).toHaveLength(1);
    expect(r.topChoices).toEqual({ wished: 3, met: 2 });
  });
});

describe("allocate: determinism", () => {
  it("gives the same roster for any order of events, choices and people", () => {
    const events = [ev("e1", 2, "2026-11-01T18:00:00Z"), ev("e2", 1, "2026-11-01T19:00:00Z"), ev("e3", 3, "2026-11-03T18:00:00Z", { fixed: [{ profileId: "p6", role: "oc" }] })];
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const choices: AllocationChoice[] = [];
    for (const [i, p] of ids.entries()) {
      for (const [j, e] of events.entries()) {
        if ((i + j) % 3 === 0) continue;
        choices.push(pick(p, e.id, (((i + j) % 5) + 1) as Rank, ((i % 5) + 1) as Rank));
      }
    }
    const people: AllocationPerson[] = ids.map((p, i) => ({ profileId: p, maxEvents: i % 2 ? 1 : null, recentEvents: i, pastEvents: i % 3, unplacedLastCycle: i === 4 }));
    const reference = run(events, choices, people);
    for (let k = 0; k < 10; k++) {
      const shuffle = <T,>(xs: T[]) => [...xs].sort(() => Math.random() - 0.5);
      expect(run(shuffle(events), shuffle(choices), shuffle(people))).toEqual(reference);
    }
  });

  it("ignores choices for events not in the cycle", () => {
    const r = run([ev("e1", 1)], [pick("ana", "other", 1, 1), pick("ben", "e1", null, 1)]);
    expect(r.assignments).toEqual([{ eventId: "e1", profileId: "ben", role: "helper", source: "auto" }]);
  });
});

describe("allocate: the blacklist", () => {
  it("leaves blacklisted people out, also as idea partners, and lists them", () => {
    const r = allocate(
      [ev("e1", 2, "2026-11-05T18:00:00Z", { fixed: [{ profileId: "pia", role: "helper" }] })],
      [pick("ana", "e1", 1, 1), pick("ben", "e1", 2, 1), pick("cem", "e1", null, 1)],
      { seed: "cycle-1", blocked: ["ana", "pia"] }
    );
    expect(rolesOf(r, "e1")).toEqual({ oc: "ben", helpers: ["cem"] });
    expect(r.blocked).toEqual(["ana", "pia"]);
    // Not "without an event": they were left out on purpose.
    expect(r.unplaced).toEqual([]);
    // They still count as having signed up.
    expect(r.events.e1.signups).toBe(4);
  });

  it("someone on the blacklist who signed up for nothing is not listed", () => {
    const r = allocate([ev("e1", 1)], [pick("ben", "e1", 1, null)], { seed: "s", blocked: ["zoe"] });
    expect(r.blocked).toEqual([]);
  });
});
