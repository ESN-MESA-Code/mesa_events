import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadEventForPage } from "@/lib/events";
import { loadCashBox } from "@/lib/cashView";
import { hasRole } from "@/lib/roles";
import { CashBox } from "@/components/CashBox";

export const metadata: Metadata = { title: "Cash box" };

// The event's cash box (round 2026-10-30): when the OC and helpers sell
// drinks or the like, they count it before and after and the OC signs it
// off – as at office hours. Staff, Events, Finance and executives see it.
export default async function EventCashPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, viewer, supabase, isStaff, isOc, isEvents } = await loadEventForPage(id);
  const finance = hasRole(viewer.roles, "finance") || viewer.roles.includes("executive");
  if (!isStaff && !isEvents && !finance) notFound();
  const { report, finance: financeView } = await loadCashBox(supabase, { event_id: id }, viewer.roles, false);
  const runs = !["draft", "dropped"].includes(event.status);
  return <CashBox report={report} target={{ event_id: id }} officeHour={false} canCount={isStaff && runs} isOc={isOc} finance={financeView} />;
}
