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

/**
 * The weeks of `month` ("2026-11-01") for a calendar grid, Monday first:
 * each week has 7 days as "2026-11-05", null outside the month.
 */
export function calendarWeeks(month: string): Array<Array<string | null>> {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month.slice(0, 8)}${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/** Days from `a` to `b` ("2026-11-05" → "2026-11-08" = 3). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** `day` ("2026-11-05") moved by `n` days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * An event moved to another day, keeping its times: the new start and end
 * as Berlin datetime-local values ("2026-11-08T19:00"). `start`/`end` are
 * Berlin datetime-local values too.
 */
export function moveToDay(start: string, end: string | null, day: string): { start: string; end: string | null } {
  const shift = dayDiff(start.slice(0, 10), day);
  return { start: `${day}${start.slice(10)}`, end: end ? `${addDays(end.slice(0, 10), shift)}${end.slice(10)}` : null };
}
