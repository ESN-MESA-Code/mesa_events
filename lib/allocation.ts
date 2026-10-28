// Automatic OC/helper allocation after the volunteer form closes (SPEC,
// "Monthly workflow" 4). A pure, deterministic function: the same input
// always gives the same roster (tests/unit/allocation.test.ts).
//
// * One OC per event, `helpersNeeded` helpers.
// * Highest priority first: rank 1 ("top choice") before 2 and 3.
// * Ties are first come, first served: the time the volunteer added that
//   event to their form; then their id, so the result never depends on
//   input order.
// * No cap per person: anyone may OC or help several events. Events are
//   therefore independent of each other.
// * The proposer of an idea who wants to OC it is its OC by default.
// * Nobody signed up (no OC, no helper) → dropped. An OC with too few
//   helpers → under-staffed (the OC decides whether it runs). Helpers but no
//   OC → no_oc (Events assigns one or drops it).
// * Overlapping events of one person are reported as conflicts, not
//   prevented (no caps).

export type Rank = 1 | 2 | 3;

export interface AllocationEvent {
  id: string;
  startsAt: string;
  endsAt?: string | null;
  helpersNeeded: number;
  /** The idea's proposer, OC by default. */
  defaultOcId?: string | null;
}

export interface AllocationChoice {
  profileId: string;
  eventId: string;
  ocRank: Rank | null;
  helperRank: Rank | null;
  /** When the volunteer added this event to their form (ISO). */
  chosenAt: string;
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
  events: Record<string, { status: StaffingStatus; ocId: string | null; helperIds: string[]; helpersNeeded: number; signups: number }>;
  conflicts: Array<{ profileId: string; eventIds: [string, string] }>;
}

/** Events without an end are assumed to last three hours (conflict check only). */
const DEFAULT_DURATION_MS = 3 * 3_600_000;

type Candidate = { profileId: string; rank: Rank; chosenAt: number };

function byPriority(a: Candidate, b: Candidate) {
  return a.rank - b.rank || a.chosenAt - b.chosenAt || (a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0);
}

export function staffingStatus(hasOc: boolean, helpers: number, helpersNeeded: number): StaffingStatus {
  if (!hasOc && helpers === 0) return "dropped";
  if (!hasOc) return "no_oc";
  return helpers < helpersNeeded ? "understaffed" : "staffed";
}

export function allocate(events: AllocationEvent[], choices: AllocationChoice[]): AllocationResult {
  const result: AllocationResult = { assignments: [], events: {}, conflicts: [] };
  const sortedEvents = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : 1));

  for (const event of sortedEvents) {
    const mine = choices.filter((c) => c.eventId === event.id);
    const ocCandidates: Candidate[] = mine
      .filter((c) => c.ocRank !== null)
      .map((c) => ({ profileId: c.profileId, rank: c.ocRank!, chosenAt: Date.parse(c.chosenAt) }))
      .sort(byPriority);

    let ocId: string | null = null;
    if (event.defaultOcId) {
      ocId = event.defaultOcId;
      result.assignments.push({ eventId: event.id, profileId: ocId, role: "oc", source: "proposer" });
    } else if (ocCandidates.length) {
      ocId = ocCandidates[0].profileId;
      result.assignments.push({ eventId: event.id, profileId: ocId, role: "oc", source: "auto" });
    }

    const helperIds = mine
      .filter((c) => c.helperRank !== null && c.profileId !== ocId)
      .map((c) => ({ profileId: c.profileId, rank: c.helperRank!, chosenAt: Date.parse(c.chosenAt) }))
      .sort(byPriority)
      .slice(0, Math.max(0, event.helpersNeeded))
      .map((c) => c.profileId);
    for (const profileId of helperIds) {
      result.assignments.push({ eventId: event.id, profileId, role: "helper", source: "auto" });
    }

    const signups = new Set(mine.filter((c) => c.ocRank !== null || c.helperRank !== null).map((c) => c.profileId));
    if (event.defaultOcId) signups.add(event.defaultOcId);
    result.events[event.id] = {
      status: staffingStatus(ocId !== null, helperIds.length, event.helpersNeeded),
      ocId,
      helperIds,
      helpersNeeded: event.helpersNeeded,
      signups: signups.size,
    };
  }

  result.conflicts = findConflicts(sortedEvents, result.assignments);
  return result;
}

/** Pairs of overlapping events the same person is assigned to. */
export function findConflicts(events: AllocationEvent[], assignments: Array<{ eventId: string; profileId: string }>) {
  const span = new Map(
    events.map((e) => {
      const start = Date.parse(e.startsAt);
      return [e.id, [start, e.endsAt ? Date.parse(e.endsAt) : start + DEFAULT_DURATION_MS] as const];
    })
  );
  const byPerson = new Map<string, string[]>();
  for (const a of assignments) byPerson.set(a.profileId, [...(byPerson.get(a.profileId) ?? []), a.eventId]);
  const conflicts: AllocationResult["conflicts"] = [];
  for (const [profileId, ids] of [...byPerson].sort(([a], [b]) => (a < b ? -1 : 1))) {
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
