import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Finance pages as tabs (round 2026-10-30): claims and payouts, the
 * overview with the ledger, and the cash boxes of office hours and events.
 */
export function FinanceTabs({ current }: { current: "claims" | "ledger" | "cash" }) {
  const tabs = [
    { id: "claims", label: "Claims and payouts", href: "/team/finance" },
    { id: "ledger", label: "Overview and ledger", href: "/team/finance/ledger" },
    { id: "cash", label: "Cash boxes", href: "/team/finance/cash" },
  ] as const;
  return (
    <nav aria-label="Finance pages" className="mb-6 flex flex-wrap items-center gap-1 border-b border-gray-200" data-testid="finance-tabs">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={current === t.id ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", current === t.id ? "border-esn text-esn" : "border-transparent text-gray-600 hover:text-esn")}
        >
          {t.label}
        </Link>
      ))}
      <Link href="/team/finance/policies" className="ml-auto px-3 py-2 text-sm text-esn hover:underline">
        Reimbursement rules →
      </Link>
    </nav>
  );
}
