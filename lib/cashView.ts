// Loading a cash box for its page (office hour or event), with what Finance
// needs to act on it. Server only.
import type { Db } from "@/lib/supabase/session";
import { formatDateTime } from "@/lib/dates";
import { hasRole, type AppRole } from "@/lib/roles";
import type { CashCounts } from "@/lib/cash";
import type { CashBoxOption, CashFinance, CashReportView } from "@/components/CashBox";

/** "Hana HR, Thu, 5 Nov 2026, 14:02" from an email and a time. */
async function who(supabase: Db, emails: Array<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.filter((e): e is string => !!e))];
  if (!wanted.length) return new Map();
  const { data } = await supabase.from("profiles").select("email, full_name").in("email", wanted);
  return new Map((data ?? []).map((p) => [p.email, p.full_name || p.email]));
}

export async function loadCashBox(
  supabase: Db,
  target: { event_id: string } | { internal_event_id: string },
  roles: readonly AppRole[],
  officeHour: boolean
): Promise<{ report: CashReportView | null; finance: CashFinance | null; boxes: CashBoxOption[] }> {
  const column = "event_id" in target ? "event_id" : "internal_event_id";
  const id = "event_id" in target ? target.event_id : target.internal_event_id;
  const [{ data: r }, { data: boxRows }] = await Promise.all([
    supabase.from("cash_reports").select("*").eq(column, id).maybeSingle(),
    // The physical boxes (round 2026-10-31): the one used, and the ones to pick from.
    supabase.from("cash_boxes").select("id, name, default_for, cents, counts, removed_at").order("position").order("created_at"),
  ]);
  const toOption = (b: NonNullable<typeof boxRows>[number]): CashBoxOption => ({ id: b.id, name: b.name, defaultFor: b.default_for as CashBoxOption["defaultFor"], cents: b.cents, counts: (b.counts ?? {}) as CashCounts });
  const boxes = (boxRows ?? []).filter((b) => !b.removed_at).map(toOption);
  const used = r ? (boxRows ?? []).find((b) => b.id === r.cash_box_id) : null;
  const finance = hasRole(roles, "finance") || roles.includes("executive");
  let financeView: CashFinance | null = null;
  if (finance && r) {
    const [{ data: booked }, { data: categories }] = await Promise.all([
      supabase.from("finance_entries").select("id").eq("cash_report_id", r.id).maybeSingle(),
      supabase.from("finance_categories").select("id, name").eq("direction", "income").eq("active", true).order("sort").order("name"),
    ]);
    financeView = { canAct: hasRole(roles, "finance"), booked: !!booked, categories: categories ?? [], suggested: officeHour ? "ESNcard sales" : "Cash box takings" };
  }
  if (!r) return { report: null, finance: financeView, boxes };
  const names = await who(supabase, [r.opening_counted_by, r.closing_counted_by, r.closed_by, r.checked_by]);
  const stamp = (email: string | null, at: string | null) => (email && at ? `${names.get(email) ?? email}, ${formatDateTime(at)}` : null);
  return {
    report: {
      id: r.id,
      opening_counts: (r.opening_counts ?? {}) as CashCounts,
      opening_cents: r.opening_cents,
      opening_counted: stamp(r.opening_counted_by, r.opening_counted_at),
      closing_counts: (r.closing_counts ?? {}) as CashCounts,
      closing_cents: r.closing_cents,
      closing_counted: stamp(r.closing_counted_by, r.closing_counted_at),
      esncards_internal: r.esncards_internal,
      esncards_external: r.esncards_external,
      card_price_internal_cents: r.card_price_internal_cents,
      card_price_external_cents: r.card_price_external_cents,
      note: r.note,
      closed: stamp(r.closed_by, r.closed_at),
      closed_at: r.closed_at,
      checked: stamp(r.checked_by, r.checked_at),
      checked_at: r.checked_at,
      box: used ? toOption(used) : null,
    },
    finance: financeView,
    boxes,
  };
}
