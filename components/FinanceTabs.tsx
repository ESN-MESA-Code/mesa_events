import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { FinanceTabBar } from "@/components/FinanceTabBar";

export type FinanceTab = "overview" | "inbox" | "import" | "links" | "ledger" | "budget" | "claims" | "cash" | "reports";

/**
 * The Finance pages as tabs (redesign 2026-11-11): the overview first, then
 * the daily work (payments to label, imports, PayPal links), the books
 * (ledger, budget), claims and cash boxes, and the reports for the tax
 * return. "To label" and "Claims" carry a dot while something waits.
 */
export async function FinanceTabs({ current }: { current: FinanceTab }) {
  const supabase = await createSessionClient();
  const [{ count: toLabel }, { count: toCheck }] = await Promise.all([
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("reimbursements").select("id", { count: "exact", head: true }).eq("status", "beleg_received"),
  ]);
  return (
    <div className="mb-6" data-testid="finance-tabs">
      <FinanceTabBar current={current} toLabel={toLabel ?? 0} toCheck={toCheck ?? 0} />
      <div className="mt-1 flex justify-end">
        <Link href="/team/finance/policies" className="px-1 py-1 text-xs text-esn hover:underline">
          Reimbursement rules →
        </Link>
      </div>
    </div>
  );
}
