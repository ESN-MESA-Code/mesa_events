// How much each person carries on a month's roster (usability review #20):
// the number of events and the events on the same day as another of theirs.
// Pure (tests/unit/rosterLoad.test.ts).

/** From this many events a person's load is flagged. */
export const HEAVY_LOAD = 3;

export interface Load {
  count: number;
  /** Event id → the person's other events on the same (Berlin) day. */
  sameDay: Map<string, string[]>;
}

export function rosterLoad(events: Array<{ id: string; day: string; profileIds: string[] }>): Map<string, Load> {
  const byPerson = new Map<string, Array<{ id: string; day: string }>>();
  for (const e of events) for (const p of new Set(e.profileIds)) byPerson.set(p, [...(byPerson.get(p) ?? []), { id: e.id, day: e.day }]);
  const out = new Map<string, Load>();
  for (const [person, list] of byPerson) {
    const sameDay = new Map<string, string[]>();
    for (const e of list) {
      const others = list.filter((o) => o.id !== e.id && o.day === e.day).map((o) => o.id);
      if (others.length) sameDay.set(e.id, others);
    }
    out.set(person, { count: list.length, sameDay });
  }
  return out;
}
