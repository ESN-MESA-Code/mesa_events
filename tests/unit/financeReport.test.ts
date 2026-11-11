import { describe, expect, it } from "vitest";
import { bySphere, commercialLimit, monthly, monthsOf, niceScale, planVsActual } from "@/lib/financeReport";

describe("finance report", () => {
  it("lists the months of a period", () => {
    expect(monthsOf("2026-10-01", "2027-03-31")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });
  it("sums per month with a running balance", () => {
    const lines = [
      { direction: "income" as const, amount_cents: 1000, booked_on: "2026-10-05", category_id: "a" },
      { direction: "expense" as const, amount_cents: 300, booked_on: "2026-11-01", category_id: "b" },
      { direction: "expense" as const, amount_cents: 999, booked_on: "2027-05-01", category_id: "b" },
    ];
    expect(monthly(lines, ["2026-10", "2026-11"])).toEqual([
      { month: "2026-10", income: 1000, expenses: 0, balance: 1000 },
      { month: "2026-11", income: 0, expenses: 300, balance: 700 },
    ]);
  });
  it("compares plan and actual per category", () => {
    const dir = new Map<string, "income" | "expense">([["in", "income"], ["out", "expense"]]);
    const rows = planVsActual(
      [{ category_id: "out", event_id: null, planned_cents: 1000 }, { category_id: "out", event_id: "e", planned_cents: 1000 }],
      [{ direction: "expense", amount_cents: 500, booked_on: "2026-10-01", category_id: "out" }, { direction: "income", amount_cents: 50, booked_on: "2026-10-01", category_id: "in" }],
      dir
    );
    expect(rows).toEqual([
      { category_id: "in", direction: "income", planned: 0, actual: 50, share: null },
      { category_id: "out", direction: "expense", planned: 2000, actual: 500, share: 0.25 },
    ]);
  });
  it("splits the EÜR into the four spheres", () => {
    const r = bySphere([{ direction: "income", amount_cents: 100, booked_on: "2026-01-01", category_id: "x", sphere: "wirtschaftlich" }]);
    expect(r.map((s) => s.sphere)).toEqual(["ideell", "vermoegen", "zweckbetrieb", "wirtschaftlich"]);
    expect(r[3]).toEqual({ sphere: "wirtschaftlich", income: 100, expenses: 0, result: 100 });
    expect(commercialLimit(2024)).toBe(4_500_000);
    expect(commercialLimit(2026)).toBe(5_000_000);
  });
  it("finds round axis steps", () => {
    expect(niceScale(123_456)).toEqual({ max: 150_000, step: 50_000 });
    expect(niceScale(90_000)).toEqual({ max: 100_000, step: 25_000 });
    expect(niceScale(0)).toEqual({ max: 10_000, step: 2_500 });
  });
});
