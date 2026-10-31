// Reimbursement rules and the suggested amount (SPEC, "Reimbursement
// rules"). The rules themselves are data – versioned rows in
// reimbursement_policies / reimbursement_rules, edited by the Treasurer only;
// SPEC_RULES below is what the first version is seeded with. The formula is
// pure and mirrored by public.suggest_reimbursement() in the database
// (tests/db/reimbursements.test.ts compares both). Money in integer cents.
//
//   suggested = min(amount × rate, cap)        (cap × days where per day)
//   – further expenses on weekend trips need the Treasurer's pre-approval
//   – social ancillary costs on weekend trips stay within the trip budget
// Finance confirms or overrides the suggestion.
import { plural } from "@/lib/plural";

export type PolicyEventType = "standard" | "special" | "day_trip" | "weekend_trip" | "any";
export type ExpenseKind = "ticket" | "food_allowance" | "ancillary" | "travel_accommodation" | "further_expenses" | "social_ancillary";
export type Category = "team_costs" | "ancillary_costs";
export type ClaimRole = "oc" | "helper";

export interface Rule {
  event_type: PolicyEventType;
  expense_kind: ExpenseKind;
  category: Category;
  /** Basis points: 10000 = 100 %. */
  oc_rate_bp: number;
  helper_rate_bp: number;
  /** null = no cap. Per day when per_day. */
  oc_cap_cents: number | null;
  helper_cap_cents: number | null;
  per_day: boolean;
  requires_preapproval: boolean;
  within_trip_budget: boolean;
  condition_note: string;
}

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  ticket: "Ticket / entry fee",
  food_allowance: "Food or drinks allowance",
  ancillary: "Ancillary costs (food, drinks, decorations, bookings essential for the event)",
  travel_accommodation: "Travel and accommodation",
  further_expenses: "Further expenses (attractions, museums)",
  social_ancillary: "Ancillary costs for social activities",
};

export const CATEGORY_LABELS: Record<Category, string> = { team_costs: "Team costs", ancillary_costs: "Ancillary costs" };

const r = (
  event_type: PolicyEventType,
  expense_kind: ExpenseKind,
  category: Category,
  oc: [number, number | null],
  helper: [number, number | null],
  opts: Partial<Pick<Rule, "per_day" | "requires_preapproval" | "within_trip_budget" | "condition_note">> = {}
): Rule => ({
  event_type,
  expense_kind,
  category,
  oc_rate_bp: oc[0],
  oc_cap_cents: oc[1],
  helper_rate_bp: helper[0],
  helper_cap_cents: helper[1],
  per_day: false,
  requires_preapproval: false,
  within_trip_budget: false,
  condition_note: "",
  ...opts,
});

/** The SPEC table, version 1. */
export const SPEC_RULES: Rule[] = [
  r("standard", "ticket", "team_costs", [10000, 1600], [5000, 800]),
  r("special", "ticket", "team_costs", [10000, null], [5000, null]),
  r("day_trip", "food_allowance", "team_costs", [10000, 1600], [10000, 800], { condition_note: "ideally one receipt" }),
  r("any", "ancillary", "ancillary_costs", [10000, null], [10000, null]),
  r("weekend_trip", "travel_accommodation", "team_costs", [10000, null], [5000, null]),
  r("weekend_trip", "food_allowance", "team_costs", [10000, 1600], [10000, 800], { per_day: true }),
  r("weekend_trip", "further_expenses", "team_costs", [10000, null], [5000, null], {
    requires_preapproval: true,
    condition_note: "Treasurer pre-approval before purchase",
  }),
  r("weekend_trip", "social_ancillary", "ancillary_costs", [10000, null], [10000, null], {
    within_trip_budget: true,
    condition_note: "within a trip budget set before the trip",
  }),
];

/** The rule for an event type and expense kind: the type's own rule, else the "any" rule. */
export function findRule<T extends Pick<Rule, "event_type" | "expense_kind">>(rules: T[], eventType: Exclude<PolicyEventType, "any">, kind: ExpenseKind): T | null {
  return rules.find((x) => x.event_type === eventType && x.expense_kind === kind) ?? rules.find((x) => x.event_type === "any" && x.expense_kind === kind) ?? null;
}

/** The expense kinds a claim on an event of `eventType` can have. */
export function kindsFor<T extends Pick<Rule, "event_type" | "expense_kind">>(rules: T[], eventType: Exclude<PolicyEventType, "any">): ExpenseKind[] {
  return [...new Set(rules.filter((x) => x.event_type === eventType || x.event_type === "any").map((x) => x.expense_kind))];
}

export type Flag = "needs_preapproval" | "no_trip_budget" | "over_trip_budget" | "capped";

/** What a flag on a claim means, for Finance (usability review #22). */
export const FLAG_LABELS: Record<Flag, string> = {
  capped: "capped by the rule",
  needs_preapproval: "needs the Treasurer's pre-approval",
  no_trip_budget: "no trip budget set",
  over_trip_budget: "over the trip budget",
};

/** "Helper: 50 %, max € 8.00" – the rule a claim was calculated with, for one role. */
export function ruleText(rule: Pick<Rule, "oc_rate_bp" | "helper_rate_bp" | "oc_cap_cents" | "helper_cap_cents" | "per_day">, role: ClaimRole): string {
  const rate = role === "oc" ? rule.oc_rate_bp : rule.helper_rate_bp;
  const cap = role === "oc" ? rule.oc_cap_cents : rule.helper_cap_cents;
  const euros = (c: number) => `€ ${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  return `${role === "oc" ? "OC" : "Helper"}: ${rate / 100} %${cap === null ? "" : `, max ${euros(cap)}${rule.per_day ? " per day" : ""}`}`;
}

export interface Suggestion {
  suggestedCents: number;
  flags: Flag[];
}

export function suggestAmount(input: {
  rule: Pick<Rule, "oc_rate_bp" | "helper_rate_bp" | "oc_cap_cents" | "helper_cap_cents" | "per_day" | "requires_preapproval" | "within_trip_budget">;
  role: ClaimRole;
  amountCents: number;
  /** Days of the trip the claim covers (per-day rules). */
  days?: number | null;
  preapproved?: boolean;
  /** What is left of the trip budget (within-budget rules); null = no budget set. */
  budgetRemainingCents?: number | null;
}): Suggestion {
  const { rule, role, amountCents } = input;
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error("The amount must be whole cents, not negative");
  const flags: Flag[] = [];
  const rate = role === "oc" ? rule.oc_rate_bp : rule.helper_rate_bp;
  // Half up, in whole cents.
  const base = Math.floor((amountCents * rate + 5000) / 10000);
  let cap = role === "oc" ? rule.oc_cap_cents : rule.helper_cap_cents;
  if (cap !== null && rule.per_day) cap *= Math.max(1, input.days ?? 1);
  let suggested = cap === null ? base : Math.min(base, cap);
  if (cap !== null && base > cap) flags.push("capped");

  if (rule.requires_preapproval && !input.preapproved) {
    flags.push("needs_preapproval");
    suggested = 0;
  }
  if (rule.within_trip_budget) {
    const left = input.budgetRemainingCents;
    if (left === null || left === undefined) {
      flags.push("no_trip_budget");
      suggested = 0;
    } else if (suggested > Math.max(0, left)) {
      flags.push("over_trip_budget");
      suggested = Math.max(0, left);
    }
  }
  return { suggestedCents: suggested, flags };
}

/** Claims at or above this amount may be paid before the monthly batch (SPEC: "> €100 may be paid earlier"). */
export const EARLY_PAYOUT_THRESHOLD_CENTS = 10000;

export function mayPayEarly(approvedCents: number | null, thresholdCents = EARLY_PAYOUT_THRESHOLD_CENTS): boolean {
  return approvedCents !== null && approvedCents > thresholdCents;
}

export const STATUS_LABELS = {
  not_submitted: "Paper receipt not handed in",
  beleg_received: "Paper receipt received",
  checked: "Checked – waiting for payout",
  paid: "Paid",
  rejected: "Rejected",
} as const;

export type ClaimStatus = keyof typeof STATUS_LABELS;

/** IBAN check (ISO 13616 mod 97), spaces allowed. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

export function maskIban(iban: string): string {
  const s = iban.replace(/\s+/g, "");
  return s.length <= 8 ? s : `${s.slice(0, 4)} •••• ${s.slice(-4)}`;
}

/** "olga@…": enough to recognise one's own PayPal address. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 0 ? email : `${email.slice(0, at)}@…`;
}

/**
 * Where a claim's money goes (review 2026-10-29 B1): "Payout: …" until it is
 * paid, "Paid to …" afterwards (the details are deleted then, so only the
 * method is left). null: no details yet.
 */
export function payoutLine(c: { status: ClaimStatus; payoutMethod: string | null; iban: string | null; paypalEmail: string | null }): string | null {
  if (c.status === "paid") return c.payoutMethod === "paypal" ? "Paid to your PayPal account" : c.payoutMethod === "bank" ? "Paid to your bank account" : "Paid";
  if (c.iban) return `Payout: bank transfer (${maskIban(c.iban)})`;
  if (c.paypalEmail) return `Payout: PayPal (${maskEmail(c.paypalEmail)})`;
  return null;
}

/**
 * The hand-in's receipt line (review 2026-10-29 B2): the member's own
 * receipts and the rest of the team's apart, so they see whose Beleg is
 * missing – counts only, never others' amounts.
 */
export function receiptsStatus(r: { mine: number; myMissing: number; all: number; allMissing: number; onTeam: boolean }): string {
  const belege = (n: number) => plural(n, "paper receipt");
  const state = (count: number, missingCount: number, outstanding: string) =>
    count === 0 ? "no receipts" : missingCount ? `${plural(count, "receipt")}, ${belege(missingCount)} ${outstanding}` : `${plural(count, "receipt")}, all paper receipts in`;
  if (!r.onTeam) return `Receipts registered: ${state(r.all, r.allMissing, "outstanding")}`;
  const others = Math.max(0, r.all - r.mine);
  const othersMissing = Math.max(0, r.allMissing - r.myMissing);
  return `Yours: ${state(r.mine, r.myMissing, "to hand in")} · Rest of the team: ${state(others, othersMissing, "outstanding")}`;
}

export interface ClaimProgressInput {
  status: ClaimStatus;
  belegReceivedAt?: string | null;
  checkedAt?: string | null;
  paidAt?: string | null;
}

/**
 * A claim's progress as steps: Registered → Beleg received → Checked → Paid.
 * A rejected claim fails at the step it had reached.
 */
export function claimSteps(c: ClaimProgressInput): Array<{ label: string; state: "done" | "current" | "todo" | "failed"; at?: string | null }> {
  const order: ClaimStatus[] = ["not_submitted", "beleg_received", "checked", "paid"];
  const labels = ["Registered", "Paper receipt received", "Checked", "Paid"];
  const at = [null, c.belegReceivedAt ?? null, c.checkedAt ?? null, c.paidAt ?? null];
  if (c.status === "rejected") {
    const reached = c.checkedAt ? 2 : c.belegReceivedAt ? 1 : 0;
    return labels.map((label, i) => ({ label: i === reached + 1 ? "Rejected" : label, state: i <= reached ? "done" : i === reached + 1 ? "failed" : "todo", at: at[i] }));
  }
  const reached = order.indexOf(c.status);
  return labels.map((label, i) => ({ label, state: i <= reached ? "done" : i === reached + 1 ? "current" : "todo", at: at[i] }));
}
