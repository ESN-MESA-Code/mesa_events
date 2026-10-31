// The leaderboard page (round 2026-10-30, own page 2026-10-31): who OC'd and
// who helped the most ESN events this semester, and who staffed the most
// office hours – once for active members and once for the newbies (the
// newbies Google group, role 'newbie'). Pure (tests/unit/leaderboard.test.ts).

export interface LeaderRow {
  profile_id: string;
  full_name: string;
  oc_count: number;
  helper_count: number;
  office_hour_count: number;
  newbie: boolean;
}

export type LeaderMetric = "oc_count" | "helper_count" | "office_hour_count";

export interface LeaderCategory {
  metric: LeaderMetric;
  title: string;
  /** "3 OC", "2 helped", "1 office hour" */
  unit: (n: number) => string;
}

export const LEADER_CATEGORIES: LeaderCategory[] = [
  { metric: "oc_count", title: "Most events as OC", unit: (n) => `${n} OC` },
  { metric: "helper_count", title: "Most events helped", unit: (n) => `${n} helped` },
  { metric: "office_hour_count", title: "Most office hours", unit: (n) => `${n} office ${n === 1 ? "hour" : "hours"}` },
];

export interface Ranked {
  id: string;
  name: string;
  count: number;
  /** 1, 2, 2, 4 … – ties share a place. */
  place: number;
}

/** The top `n` places by a metric (ties at the last place included, at most n + 2 names; `Infinity` for everyone). */
export function top(rows: LeaderRow[], by: LeaderMetric, n = 3): Ranked[] {
  const sorted = rows.filter((r) => r[by] > 0).sort((a, b) => b[by] - a[by] || a.full_name.localeCompare(b.full_name));
  const out: Ranked[] = [];
  for (const [i, r] of sorted.entries()) {
    const place = i > 0 && sorted[i - 1][by] === r[by] ? out[i - 1].place : i + 1;
    if (place > n || out.length >= n + 2) break;
    out.push({ id: r.profile_id, name: r.full_name, count: r[by], place });
  }
  return out;
}

export type Board = Record<LeaderMetric, Ranked[]>;

const board = (rows: LeaderRow[], n: number): Board => ({
  oc_count: top(rows, "oc_count", n),
  helper_count: top(rows, "helper_count", n),
  office_hour_count: top(rows, "office_hour_count", n),
});

export function leaderboards(rows: LeaderRow[], n = 3): { active: Board; newbies: Board } {
  return { active: board(rows.filter((r) => !r.newbie), n), newbies: board(rows.filter((r) => r.newbie), n) };
}

/** The semester's totals: slots per metric and how many people took part. */
export function totals(rows: LeaderRow[]): Record<LeaderMetric, number> & { people: number } {
  const sum = (m: LeaderMetric) => rows.reduce((s, r) => s + r[m], 0);
  return { oc_count: sum("oc_count"), helper_count: sum("helper_count"), office_hour_count: sum("office_hour_count"), people: rows.length };
}
