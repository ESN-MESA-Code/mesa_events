// Finance figures over time (round 2026-11-11): income and spending per
// month, the running balance, plan against actual, and the tax spheres of a
// non-profit for the EÜR. Pure (tests/unit/financeReport.test.ts).

export type Sphere = "ideell" | "vermoegen" | "zweckbetrieb" | "wirtschaftlich";

export const SPHERES: Sphere[] = ["ideell", "vermoegen", "zweckbetrieb", "wirtschaftlich"];

export const SPHERE_LABELS: Record<Sphere, { de: string; en: string }> = {
  ideell: { de: "Ideeller Bereich", en: "Non-profit activities (fees, donations, grants)" },
  vermoegen: { de: "Vermögensverwaltung", en: "Asset management (interest, rent)" },
  zweckbetrieb: { de: "Zweckbetrieb", en: "Purpose-related operations (events for the members' and students' benefit)" },
  wirtschaftlich: { de: "Wirtschaftlicher Geschäftsbetrieb", en: "Commercial activities (sales, drinks, ESNcards, sponsoring with something in return)" },
};

/**
 * § 64 (3) AO: a club's commercial activities stay free of corporate and
 * trade tax while their gross income (incl. VAT) is at most this per year
 * (€ 50,000 from 2025; € 45,000 before).
 */
export function commercialLimit(year: number): number {
  return year >= 2025 ? 5_000_000 : 4_500_000;
}

export interface Line {
  direction: "income" | "expense";
  amount_cents: number;
  booked_on: string;
  category_id: string;
}

export interface MonthPoint {
  /** "2026-11" */
  month: string;
  income: number;
  expenses: number;
  /** Running balance at the month's end (from 0 at the start of the period). */
  balance: number;
}

/** Income and spending per month of `months` (["2026-10", …]); lines outside are left out. */
export function monthly(lines: Line[], months: string[]): MonthPoint[] {
  const by = new Map(months.map((m) => [m, { month: m, income: 0, expenses: 0, balance: 0 }]));
  for (const l of lines) {
    const p = by.get(l.booked_on.slice(0, 7));
    if (!p) continue;
    if (l.direction === "income") p.income += l.amount_cents;
    else p.expenses += l.amount_cents;
  }
  let run = 0;
  return months.map((m) => {
    const p = by.get(m)!;
    run += p.income - p.expenses;
    return { ...p, balance: run };
  });
}

/** "2026-10-01".."2027-03-31" → ["2026-10", …, "2027-03"]. */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface BudgetLine {
  category_id: string;
  event_id: string | null;
  planned_cents: number;
}

export interface PlanRow {
  category_id: string;
  direction: "income" | "expense";
  planned: number;
  actual: number;
  /** actual / planned (null without a plan). */
  share: number | null;
}

/** Plan against actual per category (lines of events count for their category too). */
export function planVsActual(budget: BudgetLine[], lines: Line[], directionOf: Map<string, "income" | "expense">): PlanRow[] {
  const rows = new Map<string, PlanRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { category_id: id, direction: directionOf.get(id) ?? "expense", planned: 0, actual: 0, share: null };
      rows.set(id, r);
    }
    return r;
  };
  for (const b of budget) row(b.category_id).planned += b.planned_cents;
  for (const l of lines) row(l.category_id).actual += l.amount_cents;
  return [...rows.values()]
    .map((r) => ({ ...r, share: r.planned > 0 ? r.actual / r.planned : null }))
    .sort((a, b) => (a.direction === b.direction ? b.planned + b.actual - (a.planned + a.actual) : a.direction === "income" ? -1 : 1));
}

export interface SphereRow {
  sphere: Sphere;
  income: number;
  expenses: number;
  result: number;
}

/** The EÜR by sphere: income, spending and result of each (all four, also when empty). */
export function bySphere(lines: Array<Line & { sphere: Sphere }>): SphereRow[] {
  const out = new Map(SPHERES.map((s) => [s, { sphere: s, income: 0, expenses: 0, result: 0 }]));
  for (const l of lines) {
    const r = out.get(l.sphere) ?? out.get("ideell")!;
    if (l.direction === "income") r.income += l.amount_cents;
    else r.expenses += l.amount_cents;
  }
  return SPHERES.map((sphere) => {
    const r = out.get(sphere)!;
    return { ...r, result: r.income - r.expenses };
  });
}

/** "2026-11" → "Nov" (chart axis). */
export function shortMonth(month: string): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month.slice(5, 7)) - 1] ?? month;
}

/** A round axis maximum above `max` (1, 2, 2.5, 5 × 10ⁿ) and its ticks. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (max <= 0) return { max: 100_00, step: 25_00 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= raw) ?? 10 * pow;
  return { max: Math.ceil(max / step) * step, step };
}
