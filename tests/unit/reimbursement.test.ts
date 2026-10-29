// Reimbursement calculation for every row of the SPEC table, caps, per-day
// allowances, pre-approval, trip budgets and policy versioning.
import { describe, expect, it } from "vitest";
import {
  claimSteps,
  SPEC_RULES,
  findRule,
  isValidIban,
  kindsFor,
  maskEmail,
  maskIban,
  payoutLine,
  receiptsStatus,
  mayPayEarly,
  suggestAmount,
  type ClaimRole,
  type ExpenseKind,
  type Rule,
} from "@/lib/reimbursement";

const rule = (type: "standard" | "special" | "day_trip" | "weekend_trip", kind: ExpenseKind) => {
  const found = findRule(SPEC_RULES, type, kind);
  if (!found) throw new Error(`no rule ${type}/${kind}`);
  return found;
};
const suggest = (type: Parameters<typeof rule>[0], kind: ExpenseKind, role: ClaimRole, amountCents: number, extra: Partial<Parameters<typeof suggestAmount>[0]> = {}) =>
  suggestAmount({ rule: rule(type, kind), role, amountCents, ...extra });

describe("the SPEC table, row by row", () => {
  describe("Standard – ticket / entry fee: OC 100 % max €16, helper 50 % max €8", () => {
    it.each([
      ["oc", 1000, 1000],
      ["oc", 1600, 1600],
      ["oc", 2500, 1600],
      ["helper", 1000, 500],
      ["helper", 1600, 800],
      ["helper", 2500, 800],
      ["helper", 999, 500], // 4.995 → 5.00 (half up)
    ] as const)("%s, €%s cents → %s cents", (role, amount, expected) => {
      expect(suggest("standard", "ticket", role, amount).suggestedCents).toBe(expected);
    });

    it("says when the cap applied", () => {
      expect(suggest("standard", "ticket", "oc", 2500).flags).toEqual(["capped"]);
      expect(suggest("standard", "ticket", "oc", 1000).flags).toEqual([]);
    });
  });

  describe("Special – ticket / entry fee: OC 100 %, helper 50 %, no cap", () => {
    it.each([
      ["oc", 4000, 4000],
      ["oc", 25000, 25000],
      ["helper", 4000, 2000],
      ["helper", 25001, 12501],
    ] as const)("%s, %s → %s", (role, amount, expected) => {
      expect(suggest("special", "ticket", role, amount)).toEqual({ suggestedCents: expected, flags: [] });
    });
  });

  describe("Day trip – food or drinks allowance: OC €16, helper €8", () => {
    it.each([
      ["oc", 1200, 1200],
      ["oc", 2000, 1600],
      ["helper", 600, 600],
      ["helper", 2000, 800],
    ] as const)("%s, %s → %s", (role, amount, expected) => {
      expect(suggest("day_trip", "food_allowance", role, amount).suggestedCents).toBe(expected);
    });

    it("notes the condition", () => {
      expect(rule("day_trip", "food_allowance").condition_note).toBe("ideally one receipt");
    });
  });

  describe("Any event – ancillary costs: 100 % for OC and helpers", () => {
    it.each(["standard", "special", "day_trip", "weekend_trip"] as const)("applies to %s events", (type) => {
      expect(rule(type, "ancillary").event_type).toBe("any");
      expect(suggest(type, "ancillary", "helper", 4321)).toEqual({ suggestedCents: 4321, flags: [] });
      expect(suggest(type, "ancillary", "oc", 50000).suggestedCents).toBe(50000);
      expect(rule(type, "ancillary").category).toBe("ancillary_costs");
    });
  });

  describe("Weekend trip – travel and accommodation: OC 100 %, helper 50 %", () => {
    it.each([
      ["oc", 12000, 12000],
      ["helper", 12000, 6000],
    ] as const)("%s, %s → %s", (role, amount, expected) => {
      expect(suggest("weekend_trip", "travel_accommodation", role, amount).suggestedCents).toBe(expected);
    });
  });

  describe("Weekend trip – food allowance: €16 / €8 per day", () => {
    it.each([
      ["oc", 1, 5000, 1600],
      ["oc", 3, 5000, 4800],
      ["oc", 3, 3000, 3000],
      ["helper", 2, 5000, 1600],
      ["helper", 3, 1000, 1000],
      ["helper", null, 5000, 800], // no days given: one day
      ["helper", 0, 5000, 800], // at least one day
    ] as const)("%s, %s day(s), %s → %s", (role, days, amount, expected) => {
      expect(suggest("weekend_trip", "food_allowance", role, amount, { days }).suggestedCents).toBe(expected);
    });

    it("is only per day on weekend trips", () => {
      expect(suggest("day_trip", "food_allowance", "oc", 5000, { days: 3 }).suggestedCents).toBe(1600);
    });
  });

  describe("Weekend trip – further expenses: OC 100 %, helper 50 %, Treasurer pre-approval", () => {
    it("is nothing without pre-approval", () => {
      expect(suggest("weekend_trip", "further_expenses", "oc", 3000)).toEqual({ suggestedCents: 0, flags: ["needs_preapproval"] });
    });

    it.each([
      ["oc", 3000, 3000],
      ["helper", 3000, 1500],
    ] as const)("pre-approved: %s, %s → %s", (role, amount, expected) => {
      expect(suggest("weekend_trip", "further_expenses", role, amount, { preapproved: true })).toEqual({ suggestedCents: expected, flags: [] });
    });
  });

  describe("Weekend trip – ancillary costs for social activities: 100 % within the trip budget", () => {
    it("needs a budget set before the trip", () => {
      expect(suggest("weekend_trip", "social_ancillary", "helper", 2000, { budgetRemainingCents: null })).toEqual({ suggestedCents: 0, flags: ["no_trip_budget"] });
    });

    it.each([
      [10000, 2000, 2000, []],
      [1500, 2000, 1500, ["over_trip_budget"]],
      [0, 2000, 0, ["over_trip_budget"]],
      [-500, 2000, 0, ["over_trip_budget"]],
    ] as const)("budget left %s, amount %s → %s", (left, amount, expected, flags) => {
      expect(suggest("weekend_trip", "social_ancillary", "oc", amount, { budgetRemainingCents: left })).toEqual({ suggestedCents: expected, flags });
    });
  });

  it("covers exactly the eight rows of the SPEC", () => {
    expect(SPEC_RULES).toHaveLength(8);
    expect(SPEC_RULES.map((x) => `${x.event_type}/${x.expense_kind}`)).toEqual([
      "standard/ticket",
      "special/ticket",
      "day_trip/food_allowance",
      "any/ancillary",
      "weekend_trip/travel_accommodation",
      "weekend_trip/food_allowance",
      "weekend_trip/further_expenses",
      "weekend_trip/social_ancillary",
    ]);
  });
});

describe("rules per event type", () => {
  it("offers the kinds that apply", () => {
    expect(kindsFor(SPEC_RULES, "standard")).toEqual(["ticket", "ancillary"]);
    expect(kindsFor(SPEC_RULES, "day_trip")).toEqual(["food_allowance", "ancillary"]);
    expect(kindsFor(SPEC_RULES, "weekend_trip")).toEqual(["ancillary", "travel_accommodation", "food_allowance", "further_expenses", "social_ancillary"]);
    expect(findRule(SPEC_RULES, "standard", "travel_accommodation")).toBeNull();
  });

  it("refuses negative or fractional amounts", () => {
    expect(() => suggest("standard", "ticket", "oc", -1)).toThrow();
    expect(() => suggest("standard", "ticket", "oc", 10.5)).toThrow();
  });
});

describe("policy versioning", () => {
  it("a new version changes suggestions for claims under it, not the old version's", () => {
    const v1 = SPEC_RULES;
    const v2: Rule[] = SPEC_RULES.map((x) => (x.event_type === "standard" && x.expense_kind === "ticket" ? { ...x, oc_cap_cents: 2000, helper_cap_cents: 1000 } : x));
    const claim = { role: "oc" as const, amountCents: 2500 };
    expect(suggestAmount({ rule: findRule(v1, "standard", "ticket")!, ...claim }).suggestedCents).toBe(1600);
    expect(suggestAmount({ rule: findRule(v2, "standard", "ticket")!, ...claim }).suggestedCents).toBe(2000);
    // v1 is untouched.
    expect(findRule(v1, "standard", "ticket")!.oc_cap_cents).toBe(1600);
  });
});

describe("payouts", () => {
  it("claims above €100 may be paid early", () => {
    expect(mayPayEarly(10001)).toBe(true);
    expect(mayPayEarly(10000)).toBe(false);
    expect(mayPayEarly(null)).toBe(false);
    expect(mayPayEarly(5001, 5000)).toBe(true);
  });

  it("checks IBANs (mod 97) and masks them", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 01")).toBe(false);
    expect(isValidIban("not an iban")).toBe(false);
    expect(maskIban("DE89370400440532013000")).toBe("DE89 •••• 3000");
  });
});

describe("claim progress (review C7)", () => {
  const states = (s: Parameters<typeof claimSteps>[0]) => claimSteps(s).map((x) => `${x.label}:${x.state}`).join(" ");
  it("Registered → Beleg received → Checked → Paid", () => {
    expect(states({ status: "not_submitted" })).toBe("Registered:done Beleg received:current Checked:todo Paid:todo");
    expect(states({ status: "beleg_received", belegReceivedAt: "x" })).toBe("Registered:done Beleg received:done Checked:current Paid:todo");
    expect(states({ status: "checked" })).toBe("Registered:done Beleg received:done Checked:done Paid:current");
    expect(states({ status: "paid" })).toBe("Registered:done Beleg received:done Checked:done Paid:done");
  });
  it("a rejected claim fails where it stopped", () => {
    expect(states({ status: "rejected", belegReceivedAt: "x" })).toBe("Registered:done Beleg received:done Rejected:failed Paid:todo");
    expect(states({ status: "rejected" })).toBe("Registered:done Rejected:failed Checked:todo Paid:todo");
  });
});

describe("payout line and receipt status (review 2026-10-29 B1, B2)", () => {
  it("says where the money goes until paid, and that it was paid afterwards", () => {
    expect(maskEmail("olga@example.com")).toBe("olga@…");
    expect(payoutLine({ status: "beleg_received", payoutMethod: "paypal", iban: null, paypalEmail: "olga@example.com" })).toBe("Payout: PayPal (olga@…)");
    expect(payoutLine({ status: "checked", payoutMethod: "bank", iban: "DE89 3704 0044 0532 0130 00", paypalEmail: null })).toBe("Payout: bank transfer (DE89 •••• 3000)");
    expect(payoutLine({ status: "not_submitted", payoutMethod: null, iban: null, paypalEmail: null })).toBeNull();
    expect(payoutLine({ status: "paid", payoutMethod: "paypal", iban: null, paypalEmail: null })).toBe("Paid to your PayPal account");
    expect(payoutLine({ status: "paid", payoutMethod: "bank", iban: null, paypalEmail: null })).toBe("Paid to your bank account");
  });

  it("shows one's own receipts and the rest of the team's apart, as counts", () => {
    expect(receiptsStatus({ mine: 2, myMissing: 0, all: 3, allMissing: 1, onTeam: true })).toBe("Yours: 2 receipts, all Belege in · Rest of the team: 1 receipt, 1 Beleg outstanding");
    expect(receiptsStatus({ mine: 1, myMissing: 1, all: 4, allMissing: 3, onTeam: true })).toBe("Yours: 1 receipt, 1 Beleg to hand in · Rest of the team: 3 receipts, 2 Belege outstanding");
    expect(receiptsStatus({ mine: 0, myMissing: 0, all: 0, allMissing: 0, onTeam: true })).toBe("Yours: no receipts · Rest of the team: no receipts");
    // Team members who are not on the event see the event's counts.
    expect(receiptsStatus({ mine: 0, myMissing: 0, all: 3, allMissing: 2, onTeam: false })).toBe("Receipts registered: 3 receipts, 2 Belege outstanding");
  });
});
