// Cash boxes of office hours and events (round 2026-10-30): counted in notes
// and coins before and after, ESNcards sold at office hours, signed off by
// the OC. Mirrors private.cash_total() in the database. Pure
// (tests/unit/internal.test.ts).

/** Euro notes and coins in cents, largest first. */
export const DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Count per denomination: { "5000": 1, "200": 4 }. */
export type CashCounts = Record<string, number>;

/** "€ 50" / "€ 2" / "50 ct". */
export function denominationLabel(cents: number): string {
  return cents >= 100 ? `€ ${cents / 100}` : `${cents} ct`;
}

/** Whether a denomination is a note (five euros and up). */
export const isNote = (cents: number) => cents >= 500;

/** The total of a count in cents; null when something is not a whole, non-negative count of a euro note or coin. */
export function countTotal(counts: CashCounts): number | null {
  let total = 0;
  for (const [key, n] of Object.entries(counts)) {
    if (!DENOMINATIONS.includes(Number(key) as (typeof DENOMINATIONS)[number])) return null;
    if (!Number.isInteger(n) || n < 0 || n > 100_000) return null;
    total += Number(key) * n;
  }
  return total;
}

/** Only the denominations counted (what the database stores). */
export function cleanCounts(counts: CashCounts): CashCounts {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

export interface CashFigures {
  opening_cents: number | null;
  closing_cents: number | null;
  esncards_internal: number;
  esncards_external: number;
  card_price_internal_cents: number | null;
  card_price_external_cents: number | null;
}

/** What the box took: closing − opening (null until both are counted). */
export function takings(r: Pick<CashFigures, "opening_cents" | "closing_cents">): number | null {
  return r.opening_cents === null || r.closing_cents === null ? null : r.closing_cents - r.opening_cents;
}

/** What ESNcards sold should have brought in (null without prices for the cards sold). */
export function cardRevenue(r: CashFigures): number | null {
  const parts: number[] = [];
  for (const [n, price] of [
    [r.esncards_internal, r.card_price_internal_cents],
    [r.esncards_external, r.card_price_external_cents],
  ] as const) {
    if (n === 0) continue;
    if (price === null) return null;
    parts.push(n * price);
  }
  return parts.reduce((a, b) => a + b, 0);
}

/** Cash expected at the closing if every card was paid in cash: opening + card revenue. */
export function expectedClosing(r: CashFigures): number | null {
  const cards = cardRevenue(r);
  return r.opening_cents === null || cards === null ? null : r.opening_cents + cards;
}

/** Counted − expected at the closing (negative: cash missing). */
export function difference(r: CashFigures): number | null {
  const expected = expectedClosing(r);
  return expected === null || r.closing_cents === null ? null : r.closing_cents - expected;
}

export type CashStatus = "not_started" | "counting" | "signed_off" | "checked" | "booked";

export const CASH_STATUS_LABELS: Record<CashStatus, string> = {
  not_started: "Not started",
  counting: "Counting",
  signed_off: "Signed off",
  checked: "Checked by Finance",
  booked: "Booked",
};

export const CASH_STATUS_TONES: Record<CashStatus, "gray" | "blue" | "green" | "amber" | "purple"> = {
  not_started: "gray",
  counting: "amber",
  signed_off: "blue",
  checked: "green",
  booked: "purple",
};

export function cashStatus(r: { closed_at: string | null; checked_at: string | null } | null, booked = false): CashStatus {
  if (!r) return "not_started";
  if (booked) return "booked";
  if (r.checked_at) return "checked";
  if (r.closed_at) return "signed_off";
  return "counting";
}
