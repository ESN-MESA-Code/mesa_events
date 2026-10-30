// The leaderboard on Home (round 2026-10-30): who OC'd and who helped the
// most ESN events this semester, once for active members and once for the
// newbies (the newbies Google group, role 'newbie'). Pure (tests/unit/leaderboard.test.ts).

export interface LeaderRow {
  profile_id: string;
  full_name: string;
  oc_count: number;
  helper_count: number;
  newbie: boolean;
}

export interface Ranked {
  id: string;
  name: string;
  count: number;
  /** 1, 2, 2, 4 … – ties share a place. */
  place: number;
}

/** The top `n` places by OC or helper count (ties at the last place included, at most n + 2 names). */
export function top(rows: LeaderRow[], by: "oc_count" | "helper_count", n = 3): Ranked[] {
  const sorted = rows.filter((r) => r[by] > 0).sort((a, b) => b[by] - a[by] || a.full_name.localeCompare(b.full_name));
  const out: Ranked[] = [];
  for (const [i, r] of sorted.entries()) {
    const place = i > 0 && sorted[i - 1][by] === r[by] ? out[i - 1].place : i + 1;
    if (place > n || out.length >= n + 2) break;
    out.push({ id: r.profile_id, name: r.full_name, count: r[by], place });
  }
  return out;
}

export interface Board {
  oc: Ranked[];
  helper: Ranked[];
}

export function leaderboards(rows: LeaderRow[], n = 3): { active: Board; newbies: Board } {
  const active = rows.filter((r) => !r.newbie);
  const newbies = rows.filter((r) => r.newbie);
  return {
    active: { oc: top(active, "oc_count", n), helper: top(active, "helper_count", n) },
    newbies: { oc: top(newbies, "oc_count", n), helper: top(newbies, "helper_count", n) },
  };
}
