// Automatic OC/helper allocation after the volunteer form closes (SPEC,
// "Monthly workflow" 4). A pure, deterministic function: the same input
// always gives the same roster (tests/unit/allocation.test.ts).
//
// * `ocsNeeded` OCs (default 1) and `helpersNeeded` helpers per event.
// * Hard rules: nobody is on two overlapping events, nobody gets more events
//   than they said they can do (`maxEvents`) or more OC roles than `maxOc`.
// * 0. People fixed on the event first (`fixed`): the idea's proposer who OCs
//   it and the partners who accepted, as co-OC or helper. Their roles count
//   towards their limits; the form takes nothing from them for that event,
//   and no OC answers once they fill the OC slots. Someone fixed on two
//   overlapping events keeps the earlier one; the other is reported
//   (`issues`) for the Events team.
// * 1. OCs: the event with the fewest possible OCs per open OC slot first.
//   Nobody gets a second OC role while someone without one can take it.
// * 2. Helpers in rounds: in round 1 nobody gets more than one event (an OC
//   already has one), in round 2 nobody more than two, and so on. Within a
//   round the scarcest event (fewest willing people per open slot) is filled
//   first – an "if needed" can be placed where nobody else can do it.
// * Who wins a slot: the highest score – half the rank itself, half the rank
//   relative to the person's own answers (capped), so marking everything
//   "top choice" makes each one count for less – a boost for people who signed up last month and got nothing, a small
//   minus per event in the three months before, and for OCs and next to a
//   first-time OC, a bonus for experience. Ties: a lottery seeded with the
//   cycle (not the submission time), then the id.
// * Someone who only ranked OC is not made a helper. Nobody signed up (no
//   OC, no helper) → dropped. An OC with too few co-OCs or helpers →
//   under-staffed (the OC decides whether it runs). Helpers but no OC → no_oc
//   (Events assigns one or drops it).
// * People on the blacklist (`blocked`, 2026-11-07) are left out – their
//   answers and their fixed places alike – and listed in `blocked`: the
//   Events team adds them by hand, only as helpers on non-crucial events.

export type Rank = 1 | 2 | 3 | 4 | 5;

export interface AllocationEvent {
  id: string;
  startsAt: string;
  endsAt?: string | null;
  helpersNeeded: number;
  /** How many OCs; default 1. */
  ocsNeeded?: number;
  /** Already on the event: the idea's proposer (OC) and its accepted partners. */
  fixed?: Array<{ profileId: string; role: "oc" | "helper" }>;
}

export interface AllocationChoice {
  profileId: string;
  eventId: string;
  ocRank: Rank | null;
  helperRank: Rank | null;
}

/** A volunteer's limits and history; everything optional (no limit, no history). */
export interface AllocationPerson {
  profileId: string;
  /** How many events they can do this month; null = no limit. */
  maxEvents?: number | null;
  /** How many of them as OC; null = no limit. */
  maxOc?: number | null;
  /** Their events in the three months before. */
  recentEvents?: number;
  /** Their events ever before this month (0 = first time). */
  pastEvents?: number;
  /** Signed up last month and got nothing. */
  unplacedLastCycle?: boolean;
}

export interface AllocationOptions {
  /** Seeds the tie-break lottery: the cycle id, so a re-run gives the same roster. */
  seed: string;
  people?: AllocationPerson[];
  /** On the blacklist: never placed automatically. */
  blocked?: readonly string[];
}

export type StaffingStatus = "staffed" | "understaffed" | "no_oc" | "dropped";

export interface AllocatedAssignment {
  eventId: string;
  profileId: string;
  role: "oc" | "helper";
  source: "auto" | "proposer";
}

export interface AllocationResult {
  assignments: AllocatedAssignment[];
  events: Record<string, { status: StaffingStatus; ocIds: string[]; helperIds: string[]; ocsNeeded: number; helpersNeeded: number; signups: number }>;
  conflicts: Array<{ profileId: string; eventIds: [string, string] }>;
  /** Someone fixed on two overlapping events: they are on `otherEventId`, not on `eventId`. */
  issues: Array<{ kind: "fixed_clash"; eventId: string; profileId: string; role: "oc" | "helper"; otherEventId: string }>;
  /** Volunteers who signed up for something and got nothing (the blocked ones not counted). */
  unplaced: string[];
  /** People on the blacklist who signed up or were fixed on an event: left out. */
  blocked: string[];
  /** Top-choice wishes in all, and how many of them were met. */
  topChoices: { wished: number; met: number };
}

/** Events without an end are assumed to last three hours (overlap check only). */
const DEFAULT_DURATION_MS = 3 * 3_600_000;
/** Score parts (see the header). */
const UNPLACED_BOOST = 0.5;
const RECENT_PENALTY = 0.1;
const RECENT_CAP = 5;
const EXPERIENCE_BONUS = 0.3;
/** The relative half at most doubles: padding the form with "if needed" does not make a top choice unbeatable. */
const RELATIVE_CAP = 2;
/** The mean of the points scale (1–5): rank 3 "happy to" scores 1 on the absolute half. */
const MID_POINTS = 3;

/** 1 (top choice) → 5 points … 5 (if needed) → 1 point. */
const points = (rank: Rank) => 6 - rank;

/** FNV-1a: a stable 32-bit hash, the lottery number of a person in a cycle. */
function lottery(seed: string, profileId: string) {
  let h = 0x811c9dc5;
  for (const ch of `${seed}:${profileId}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

/** A volunteer during the allocation: limits, score parts, what they got so far. */
interface Volunteer {
  maxEvents: number;
  maxOc: number;
  experienced: boolean;
  /** Their answers (OC and helper ranks): how many, and their points in all. */
  count: number;
  sum: number;
  bonus: number;
  ticket: number;
  events: string[];
  oc: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function staffingStatus(ocs: number, ocsNeeded: number, helpers: number, helpersNeeded: number): StaffingStatus {
  if (ocs === 0 && helpers === 0) return "dropped";
  if (ocs === 0) return "no_oc";
  return ocs < ocsNeeded || helpers < helpersNeeded ? "understaffed" : "staffed";
}

export function allocate(events: AllocationEvent[], choices: AllocationChoice[], options: AllocationOptions): AllocationResult {
  const sortedEvents = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || byId(a.id, b.id));
  const eventIds = new Set(sortedEvents.map((e) => e.id));
  const span = spans(sortedEvents);
  const blockedSet = new Set(options.blocked ?? []);
  const blocked = [
    ...new Set([
      ...choices.filter((c) => eventIds.has(c.eventId) && blockedSet.has(c.profileId)).map((c) => c.profileId),
      ...sortedEvents.flatMap((e) => (e.fixed ?? []).filter((f) => blockedSet.has(f.profileId)).map((f) => f.profileId)),
    ]),
  ].sort(byId);
  /** An event's fixed people without the blocked ones (a new array). */
  const keptFixed = (fixed: AllocationEvent["fixed"]) => (fixed ?? []).filter((f) => !blockedSet.has(f.profileId));
  const mine = choices.filter((c) => eventIds.has(c.eventId) && !blockedSet.has(c.profileId)).sort((a, b) => byId(a.profileId, b.profileId) || byId(a.eventId, b.eventId));
  const wish = new Map(mine.map((c) => [`${c.profileId}|${c.eventId}`, c]));

  // Everyone with an answer or fixed on an event, with their limits and history.
  const info = new Map((options.people ?? []).map((p) => [p.profileId, p]));
  const ids = [...new Set([...mine.map((c) => c.profileId), ...sortedEvents.flatMap((ev) => keptFixed(ev.fixed).map((f) => f.profileId))])].sort(byId);
  const person = new Map(
    ids.map((id): [string, Volunteer] => {
      const answers = mine.filter((c) => c.profileId === id).flatMap((c) => [c.ocRank, c.helperRank].filter((r): r is Rank => r !== null));
      const p = info.get(id);
      return [
        id,
        {
          maxEvents: p?.maxEvents ?? Infinity,
          maxOc: p?.maxOc ?? Infinity,
          experienced: (p?.pastEvents ?? 0) > 0,
          // For the rank relative to their own answers: points × count / sum = points / mean.
          count: answers.length,
          sum: answers.reduce((s, r) => s + points(r), 0),
          bonus: (p?.unplacedLastCycle ? UNPLACED_BOOST : 0) - RECENT_PENALTY * Math.min(p?.recentEvents ?? 0, RECENT_CAP),
          ticket: lottery(options.seed, id),
          events: [],
          oc: 0,
        },
      ];
    })
  );

  const ocs = new Map(sortedEvents.map((e) => [e.id, [] as string[]]));
  const helpers = new Map(sortedEvents.map((e) => [e.id, [] as string[]]));
  const assignments: AllocatedAssignment[] = [];
  const issues: AllocationResult["issues"] = [];

  const clash = (a: string, b: string) => {
    const [as, ae] = span.get(a)!;
    const [bs, be] = span.get(b)!;
    return as < be && bs < ae;
  };
  const overlaps = (profileId: string, eventId: string) => person.get(profileId)!.events.some((other) => clash(other, eventId));
  const free = (profileId: string, eventId: string) => {
    const p = person.get(profileId)!;
    return !p.events.includes(eventId) && p.events.length < p.maxEvents && !overlaps(profileId, eventId);
  };
  const place = (eventId: string, profileId: string, role: "oc" | "helper", source: AllocatedAssignment["source"]) => {
    const p = person.get(profileId)!;
    p.events.push(eventId);
    if (role === "oc") {
      p.oc++;
      ocs.get(eventId)!.push(profileId);
    } else helpers.get(eventId)!.push(profileId);
    assignments.push({ eventId, profileId, role, source });
  };
  const score = (profileId: string, eventId: string, role: "oc" | "helper") => {
    const p = person.get(profileId)!;
    const rank = (role === "oc" ? wish.get(`${profileId}|${eventId}`)?.ocRank : wish.get(`${profileId}|${eventId}`)?.helperRank)!;
    const relative = Math.min((points(rank) * p.count) / p.sum, RELATIVE_CAP);
    let s = (points(rank) / MID_POINTS + relative) / 2 + p.bonus;
    if (p.experienced) {
      const team = [...ocs.get(eventId)!, ...helpers.get(eventId)!];
      if (role === "oc" || !team.some((id) => person.get(id)!.experienced)) s += EXPERIENCE_BONUS;
    }
    return s;
  };
  /** The best candidate for a slot: highest score, then the lottery, then the id. */
  const best = (eventId: string, role: "oc" | "helper", candidates: string[], first?: (a: string, b: string) => number) =>
    candidates
      .map((id) => ({ id, score: score(id, eventId, role), ticket: person.get(id)!.ticket }))
      .sort((a, b) => (first?.(a.id, b.id) ?? 0) || b.score - a.score || a.ticket - b.ticket || byId(a.id, b.id))[0].id;

  // 0. People fixed on the event (proposer, partners): OCs first.
  for (const e of sortedEvents) {
    const fixed = keptFixed(e.fixed).sort((a, b) => (a.role === b.role ? byId(a.profileId, b.profileId) : a.role === "oc" ? -1 : 1));
    for (const f of fixed) {
      if (person.get(f.profileId)!.events.includes(e.id)) continue;
      const other = person.get(f.profileId)!.events.find((o) => clash(o, e.id));
      if (other) issues.push({ kind: "fixed_clash", eventId: e.id, profileId: f.profileId, role: f.role, otherEventId: other });
      else place(e.id, f.profileId, f.role, "proposer");
    }
  }

  /** Fewest candidates per open slot (cross-multiplied, exact), then fewest candidates; the earlier event on a tie. */
  const scarcest = <T extends { slots: number; candidates: string[] }>(open: T[]) =>
    open.reduce((a, b) => {
      const d = b.candidates.length * a.slots - a.candidates.length * b.slots;
      return d < 0 || (d === 0 && b.candidates.length < a.candidates.length) ? b : a;
    });

  // 1. OCs, the scarcest event first.
  const openOc = (e: AllocationEvent) => Math.max(1, e.ocsNeeded ?? 1) - ocs.get(e.id)!.length;
  const ocCandidates = (eventId: string) =>
    mine.filter((c) => c.eventId === eventId && c.ocRank !== null && person.get(c.profileId)!.oc < person.get(c.profileId)!.maxOc && free(c.profileId, eventId)).map((c) => c.profileId);
  for (;;) {
    const open = sortedEvents
      .filter((ev) => openOc(ev) > 0)
      .map((ev) => ({ e: ev, slots: openOc(ev), candidates: ocCandidates(ev.id) }))
      .filter((x) => x.candidates.length);
    if (!open.length) break;
    const { e, candidates } = scarcest(open);
    place(e.id, best(e.id, "oc", candidates, (a, b) => person.get(a)!.oc - person.get(b)!.oc || person.get(a)!.events.length - person.get(b)!.events.length), "oc", "auto");
  }

  // 2. Helpers in rounds, the scarcest event first.
  const missing = (e: AllocationEvent) => Math.max(0, e.helpersNeeded) - helpers.get(e.id)!.length;
  const helperCandidates = (eventId: string, round: number) =>
    mine.filter((c) => c.eventId === eventId && c.helperRank !== null && person.get(c.profileId)!.events.length < round && free(c.profileId, eventId)).map((c) => c.profileId);
  for (let round = 1; round <= sortedEvents.length && sortedEvents.some((ev) => missing(ev) > 0); round++) {
    for (;;) {
      const open = sortedEvents
        .filter((ev) => missing(ev) > 0)
        .map((ev) => ({ e: ev, slots: missing(ev), candidates: helperCandidates(ev.id, round) }))
        .filter((x) => x.candidates.length);
      if (!open.length) break;
      const { e, candidates } = scarcest(open);
      place(e.id, best(e.id, "helper", candidates), "helper", "auto");
    }
  }

  const result: AllocationResult = { assignments, events: {}, conflicts: findConflicts(sortedEvents, assignments), issues, unplaced: [], blocked, topChoices: { wished: 0, met: 0 } };
  for (const e of sortedEvents) {
    const ocIds = ocs.get(e.id)!;
    const ocsNeeded = Math.max(1, e.ocsNeeded ?? 1);
    const signups = new Set([...choices.filter((c) => c.eventId === e.id).map((c) => c.profileId), ...(e.fixed ?? []).map((f) => f.profileId)]);
    result.events[e.id] = {
      status: staffingStatus(ocIds.length, ocsNeeded, helpers.get(e.id)!.length, e.helpersNeeded),
      ocIds,
      helperIds: helpers.get(e.id)!,
      ocsNeeded,
      helpersNeeded: e.helpersNeeded,
      signups: signups.size,
    };
  }
  result.unplaced = ids.filter((id) => !person.get(id)!.events.length);
  for (const c of mine) {
    for (const role of ["oc", "helper"] as const) {
      if ((role === "oc" ? c.ocRank : c.helperRank) !== 1) continue;
      result.topChoices.wished++;
      if (assignments.some((a) => a.eventId === c.eventId && a.profileId === c.profileId && a.role === role)) result.topChoices.met++;
    }
  }
  return result;
}

function spans(events: AllocationEvent[]) {
  return new Map(
    events.map((e) => {
      const start = Date.parse(e.startsAt);
      return [e.id, [start, e.endsAt ? Date.parse(e.endsAt) : start + DEFAULT_DURATION_MS] as const];
    })
  );
}

/** Pairs of overlapping events the same person is assigned to (manual roster changes can make them). */
export function findConflicts(events: AllocationEvent[], assignments: Array<{ eventId: string; profileId: string }>) {
  const span = spans(events);
  const byPerson = new Map<string, string[]>();
  for (const a of assignments) byPerson.set(a.profileId, [...(byPerson.get(a.profileId) ?? []), a.eventId]);
  const conflicts: AllocationResult["conflicts"] = [];
  for (const [profileId, ids] of [...byPerson].sort(([a], [b]) => byId(a, b))) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = span.get(ids[i]);
        const b = span.get(ids[j]);
        if (a && b && a[0] < b[1] && b[0] < a[1]) conflicts.push({ profileId, eventIds: [ids[i], ids[j]] });
      }
    }
  }
  return conflicts;
}
