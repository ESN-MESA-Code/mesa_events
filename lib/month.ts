// One month at a time on the Comms and Events pages (brief 2026-10-29, C):
// ?month=YYYY-MM, a default month that still has work, ← → neighbours.
// Pure (tests/unit/month.test.ts).

/** "2026-11" (the URL) → "2026-11-01" (a cycle's month), null when not a month. */
export function parseMonthParam(raw: string | string[] | undefined | null): string | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const m = String(s ?? "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** "2026-11-01" → "2026-11" (for the URL). */
export const monthParam = (month: string) => month.slice(0, 7);

export interface MonthOption {
  /** "2026-11-01" */
  month: string;
  /** Something is still to do there for the team looking. */
  hasWork: boolean;
}

/**
 * The month a page opens on: the one asked for when it is one of the options;
 * else the earliest month that still has work; else the current month (Berlin,
 * "2026-10-01") when it is an option; else the latest month before it, or the
 * first one.
 */
export function pickMonth(options: MonthOption[], asked: string | null, current: string): string | null {
  if (!options.length) return asked;
  const sorted = [...options].sort((a, b) => a.month.localeCompare(b.month));
  if (asked && sorted.some((o) => o.month === asked)) return asked;
  const withWork = sorted.find((o) => o.hasWork);
  if (withWork) return withWork.month;
  if (sorted.some((o) => o.month === current)) return current;
  return [...sorted].reverse().find((o) => o.month < current)?.month ?? sorted[0].month;
}

/** The months before and after `month` among the options (the ← → arrows). */
export function neighbours(months: string[], month: string): { prev: string | null; next: string | null } {
  const sorted = [...new Set(months)].sort();
  const i = sorted.indexOf(month);
  if (i < 0) return { prev: [...sorted].reverse().find((m) => m < month) ?? null, next: sorted.find((m) => m > month) ?? null };
  return { prev: sorted[i - 1] ?? null, next: sorted[i + 1] ?? null };
}
