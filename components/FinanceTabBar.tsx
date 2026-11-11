"use client";

import { FileSpreadsheet, Inbox, LayoutDashboard, PiggyBank, QrCode, Receipt, ScrollText, Upload, Wallet } from "lucide-react";
import { TabBar } from "@/components/TabBar";
import type { FinanceTab } from "@/components/FinanceTabs";

/** The Finance tabs (icons are client-side; FinanceTabs counts what waits). */
export function FinanceTabBar({ current, toLabel, toCheck }: { current: FinanceTab; toLabel: number; toCheck: number }) {
  const tabs = [
    { id: "overview", label: "Overview", href: "/team/finance", icon: LayoutDashboard },
    { id: "inbox", label: toLabel ? `To label (${toLabel})` : "To label", href: "/team/finance/inbox", icon: Inbox, note: toLabel ? `${toLabel} payments to label` : undefined },
    { id: "import", label: "Import", href: "/team/finance/import", icon: Upload },
    { id: "links", label: "PayPal links", href: "/team/finance/links", icon: QrCode },
    { id: "ledger", label: "Ledger", href: "/team/finance/ledger", icon: ScrollText },
    { id: "budget", label: "Budget", href: "/team/finance/budget", icon: PiggyBank },
    { id: "claims", label: "Claims", href: "/team/finance/claims", icon: Receipt, note: toCheck ? `${toCheck} claims to check` : undefined },
    { id: "cash", label: "Cash boxes", href: "/team/finance/cash", icon: Wallet },
    { id: "reports", label: "Reports & tax", href: "/team/finance/reports", icon: FileSpreadsheet },
  ];
  return <TabBar label="Finance pages" tabs={tabs.map((t) => ({ href: t.href, label: t.label, active: t.id === current, icon: t.icon, note: t.note }))} />;
}
