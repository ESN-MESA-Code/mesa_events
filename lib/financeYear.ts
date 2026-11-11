// One calendar year of the books (round 2026-11-11), for the reports page
// and its CSV exports: every ledger line and every paid claim (a claim is
// spending in its event's sphere, "Zweckbetrieb" unless its category says
// otherwise), with category, sphere and event. Server only (RLS decides
// what the viewer may read).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { berlinDate, berlinInputToIso } from "@/lib/dates";
import type { Sphere } from "@/lib/financeReport";
import { METHOD_LABELS } from "@/lib/finance";

export interface YearLine {
  day: string;
  direction: "income" | "expense";
  cents: number;
  category: string;
  categoryId: string | null;
  sphere: Sphere;
  description: string;
  event: string;
  counterparty: string;
  method: string;
  receiptRef: string;
  receiptFiled: boolean;
  note: string;
  source: "ledger" | "paypal" | "pretix" | "cash box" | "claim";
}

export async function loadYear(db: SupabaseClient<Database>, year: number): Promise<YearLine[]> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [{ data: entries }, { data: claims }] = await Promise.all([
    db
      .from("finance_entries")
      .select("direction, amount_cents, booked_on, description, counterparty, payment_method, beleg_ref, beleg_received, note, payment_id, cash_report_id, is_fee, category_id, finance_categories(name, sphere), events(title, starts_at), internal_events(title, starts_at)")
      .gte("booked_on", from)
      .lte("booked_on", to)
      .order("booked_on")
      .limit(20000),
    db
      .from("reimbursements")
      .select("approved_cents, paid_at, payout_method, category, profiles:claimant_id(full_name), events(title, starts_at), receipts(vendor, expense_kind)")
      .eq("status", "paid")
      .gte("paid_at", berlinInputToIso(`${from}T00:00`))
      .lt("paid_at", berlinInputToIso(`${year + 1}-01-01T00:00`))
      .limit(20000),
  ]);
  const lines: YearLine[] = (entries ?? []).map((e) => {
    const cat = e.finance_categories as { name: string; sphere: string } | null;
    const ev = (e.events ?? e.internal_events) as { title: string; starts_at: string } | null;
    return {
      day: e.booked_on,
      direction: e.direction as YearLine["direction"],
      cents: e.amount_cents,
      category: cat?.name ?? "?",
      categoryId: e.category_id,
      sphere: (cat?.sphere ?? "ideell") as Sphere,
      description: e.description,
      event: ev ? `${ev.title} (${berlinDate(ev.starts_at)})` : "",
      counterparty: e.counterparty,
      method: METHOD_LABELS[e.payment_method as keyof typeof METHOD_LABELS] ?? e.payment_method,
      receiptRef: e.beleg_ref,
      receiptFiled: e.beleg_received,
      note: e.note,
      source: e.payment_id ? "paypal" : e.cash_report_id ? "cash box" : e.counterparty === "pretix" ? "pretix" : "ledger",
    };
  });
  for (const c of claims ?? []) {
    const ev = c.events as { title: string; starts_at: string } | null;
    const r = c.receipts as { vendor: string; expense_kind: string } | null;
    lines.push({
      day: berlinDate(c.paid_at!),
      direction: "expense",
      cents: c.approved_cents ?? 0,
      category: "Reimbursements (claims)",
      categoryId: null,
      sphere: "zweckbetrieb",
      description: `Reimbursement: ${r?.vendor ?? "receipt"} (${r?.expense_kind ?? c.category})`,
      event: ev ? `${ev.title} (${berlinDate(ev.starts_at)})` : "",
      counterparty: (c.profiles as { full_name: string } | null)?.full_name ?? "",
      method: c.payout_method === "paypal" ? "PayPal" : "MESA bank account",
      receiptRef: "",
      receiptFiled: true,
      note: "",
      source: "claim",
    });
  }
  return lines.sort((a, b) => a.day.localeCompare(b.day));
}
