// Finance's overview of the organisation (round 2026-10-30): the ledger
// (other income and spending, an event's revenue, Belege paid from the MESA
// account), reimbursements from claims, and cash boxes not booked yet. Per
// month and per event. Pure (tests/unit/internal.test.ts).

export type Direction = "income" | "expense";

/** How a ledger entry was paid. */
export const METHOD_LABELS = { bank: "MESA bank account", cash: "Cash", paypal: "PayPal", card: "Card", other: "Other" } as const;

export interface LedgerRow {
  direction: Direction;
  amount_cents: number;
  category: string;
  event_id: string | null;
  booked_on: string;
}

export interface ClaimRow {
  event_id: string;
  status: string;
  suggested_cents: number;
  approved_cents: number | null;
}

export interface CashRow {
  event_id: string | null;
  internal_event_id: string | null;
  opening_cents: number | null;
  closing_cents: number | null;
  closed: boolean;
  booked: boolean;
}

export interface Totals {
  income: number;
  expenses: number;
  /** Paid claims. */
  reimbursementsPaid: number;
  /** Checked, not paid yet (approved amount). */
  reimbursementsDue: number;
  /** Not checked yet (suggested amount) – not in the net. */
  reimbursementsOpen: number;
  /** Signed-off cash boxes whose takings are not in the ledger yet – not in the net. */
  cashUnbooked: number;
  /** income − expenses − reimbursements paid and due. */
  net: number;
}

const ZERO: Totals = { income: 0, expenses: 0, reimbursementsPaid: 0, reimbursementsDue: 0, reimbursementsOpen: 0, cashUnbooked: 0, net: 0 };

function claimCost(c: ClaimRow): { paid: number; due: number; open: number } {
  if (c.status === "paid") return { paid: c.approved_cents ?? 0, due: 0, open: 0 };
  if (c.status === "checked") return { paid: 0, due: c.approved_cents ?? 0, open: 0 };
  if (c.status === "rejected") return { paid: 0, due: 0, open: 0 };
  return { paid: 0, due: 0, open: c.suggested_cents };
}

/** Takings of a signed-off box (null until it is). */
export function boxTakings(c: CashRow): number | null {
  return c.closed && c.opening_cents !== null && c.closing_cents !== null ? c.closing_cents - c.opening_cents : null;
}

export function totals(ledger: LedgerRow[], claims: ClaimRow[], cash: CashRow[]): Totals {
  const t = { ...ZERO };
  for (const e of ledger) {
    if (e.direction === "income") t.income += e.amount_cents;
    else t.expenses += e.amount_cents;
  }
  for (const c of claims) {
    const cost = claimCost(c);
    t.reimbursementsPaid += cost.paid;
    t.reimbursementsDue += cost.due;
    t.reimbursementsOpen += cost.open;
  }
  for (const c of cash) {
    const taken = boxTakings(c);
    if (taken !== null && taken > 0 && !c.booked) t.cashUnbooked += taken;
  }
  t.net = t.income - t.expenses - t.reimbursementsPaid - t.reimbursementsDue;
  return t;
}

/** Ledger sums per category and direction, largest first. */
export function byCategory(ledger: LedgerRow[]): Array<{ direction: Direction; category: string; cents: number; count: number }> {
  const map = new Map<string, { direction: Direction; category: string; cents: number; count: number }>();
  for (const e of ledger) {
    const key = `${e.direction}:${e.category}`;
    const row = map.get(key) ?? { direction: e.direction, category: e.category, cents: 0, count: 0 };
    row.cents += e.amount_cents;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.direction === b.direction ? b.cents - a.cents : a.direction === "income" ? -1 : 1));
}

/** Totals per event id (events with anything at all). */
export function perEvent(ledger: LedgerRow[], claims: ClaimRow[], cash: CashRow[]): Map<string, Totals> {
  const ids = new Set<string>();
  for (const e of ledger) if (e.event_id) ids.add(e.event_id);
  for (const c of claims) ids.add(c.event_id);
  for (const c of cash) if (c.event_id) ids.add(c.event_id);
  const out = new Map<string, Totals>();
  for (const id of ids) {
    out.set(
      id,
      totals(
        ledger.filter((e) => e.event_id === id),
        claims.filter((c) => c.event_id === id),
        cash.filter((c) => c.event_id === id)
      )
    );
  }
  return out;
}
