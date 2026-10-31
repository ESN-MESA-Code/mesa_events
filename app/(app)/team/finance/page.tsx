import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatCents, formatDate, formatDateTime, monthLabel, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FinanceTabs } from "@/components/FinanceTabs";
import { payBatch } from "@/app/actions/handin";
import { ClaimsTable, type ClaimRow } from "./ClaimsTable";
import { findRule, ruleText, type ClaimRole, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { PreapprovalDecision, TripBudgetForm } from "./FinanceClient";

export const metadata: Metadata = { title: "Finance" };

// Finance's overview: open receipts and claims (Beleg, check, payout),
// monthly payout batches, pre-approvals (Treasurer) and trip budgets.
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: shown } = await searchParams;
  // Executives oversee Finance read-only (no bank details, no actions).
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const isTreasurer = viewer.roles.includes("treasurer");
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const now = new Date(nowMs()).toISOString();

  const [{ data: claims }, { data: batches }, { data: preapprovals }, { data: trips }, { data: rules }] = await Promise.all([
    supabase
      .from("reimbursements")
      .select(
        "id, status, suggested_cents, approved_cents, flags, claimant_role, category, policy_version, payout_method, early_payout, batch_id, created_at, profiles:claimant_id(full_name), events(id, title, type, starts_at), receipts(expense_kind, vendor, amount_cents, purchased_on, beleg_received_at, beleg_received_by)"
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("payout_batches").select("id, month, status, paid_at, reimbursements(approved_cents)").order("month", { ascending: false }).limit(12),
    supabase.from("preapprovals").select("id, description, estimated_cents, status, created_at, profiles:requester_id(full_name), events(title)").eq("status", "requested").order("created_at"),
    supabase.from("events").select("id, title, starts_at, trip_budgets(amount_cents)").eq("type", "weekend_trip").gte("starts_at", now).order("starts_at"),
    // The rules of every version, so a capped claim can say why (usability review #22).
    supabase.from("reimbursement_rules").select("event_type, expense_kind, oc_rate_bp, helper_rate_bp, oc_cap_cents, helper_cap_cents, per_day, reimbursement_policies(version)"),
  ]);
  const rulesOf = (version: number) => (rules ?? []).filter((x) => (x.reimbursement_policies as { version: number } | null)?.version === version) as unknown as Rule[];

  const rows: ClaimRow[] = (claims ?? []).map((c) => {
    const r = c.receipts as unknown as { expense_kind: string; vendor: string; amount_cents: number; purchased_on: string; beleg_received_at: string | null; beleg_received_by: string | null };
    const e = c.events as unknown as { id: string; title: string; type: string; starts_at: string };
    return {
      id: c.id,
      status: c.status,
      claimant: (c.profiles as { full_name: string } | null)?.full_name ?? "?",
      role: c.claimant_role,
      event: e?.title ?? "",
      eventId: e?.id ?? "",
      eventDate: e ? formatDate(e.starts_at) : "",
      kind: r?.expense_kind ?? "",
      vendor: r?.vendor ?? "",
      amount: r?.amount_cents ?? 0,
      suggested: c.suggested_cents,
      approved: c.approved_cents,
      flags: c.flags,
      category: c.category,
      policyVersion: c.policy_version,
      rule: (() => {
        const rule = e && r ? findRule(rulesOf(c.policy_version), e.type as Exclude<Rule["event_type"], "any">, r.expense_kind as ExpenseKind) : null;
        return rule ? ruleText(rule, c.claimant_role as ClaimRole) : null;
      })(),
      payoutMethod: c.payout_method,
      beleg: r?.beleg_received_at ? `${formatDateTime(r.beleg_received_at)} · ${r.beleg_received_by}` : null,
    };
  });
  const open = rows.filter((r) => ["not_submitted", "beleg_received", "checked"].includes(r.status));

  return (
    <>
      <PageHeader title="Finance" description="Receipts, reimbursements and monthly payouts. The paper Beleg is mandatory.">
        {!canAct && <Badge className="self-center" data-testid="read-only">Read-only (executive)</Badge>}
      </PageHeader>
      <FinanceTabs current="claims" />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4" data-testid="finance-figures">
          {/* Each figure filters the table below (usability review #22). */}
          {(
            [
              ["Belege missing", rows.filter((r) => r.status === "not_submitted").length, "not_submitted"],
              ["To check", rows.filter((r) => r.status === "beleg_received").length, "beleg_received"],
              ["Waiting for payout", rows.filter((r) => r.status === "checked").length, "checked"],
              ["Open amount", formatCents(open.reduce((s, r) => s + (r.approved ?? r.suggested), 0)), "open"],
            ] as const
          ).map(([label, value, status]) => (
            <Link
              key={label}
              href={`/team/finance?status=${status}#claims`}
              aria-current={(shown ?? "open") === status ? "true" : undefined}
              className={cn("rounded-xl border bg-white p-4 shadow-sm hover:border-esn", (shown ?? "open") === status ? "border-esn ring-1 ring-esn" : "border-gray-200")}
            >
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </Link>
          ))}
        </div>

        <Card id="claims" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Receipts and claims</CardTitle>
          </CardHeader>
          <CardContent>
            <ClaimsTable key={shown ?? "open"} rows={rows} readOnly={!canAct} initialStatus={shown} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Payout batches</CardTitle>
            </CardHeader>
            <CardContent>
              {!batches?.length && <EmptyState>No batches yet – checked claims join the month&apos;s batch.</EmptyState>}
              <ul className="divide-y divide-gray-100 text-sm" data-testid="batches">
                {(batches ?? []).map((b) => {
                  const total = (b.reimbursements ?? []).reduce((s, r) => s + (r.approved_cents ?? 0), 0);
                  return (
                    <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                      <Link href={`/team/finance/batches/${b.id}`} className="font-medium text-esn hover:underline">
                        {monthLabel(b.month)}
                      </Link>
                      <span className="text-gray-500">
                        {(b.reimbursements ?? []).length} claims · {formatCents(total)}
                      </span>
                      <Badge tone={b.status === "paid" ? "purple" : "blue"} className="ml-auto">
                        {b.status === "paid" ? `paid ${b.paid_at ? formatDate(b.paid_at) : ""}` : "open"}
                      </Badge>
                      {canAct && b.status === "open" && (b.reimbursements ?? []).length > 0 && (
                        <ActionButton action={payBatch} input={{ batch_id: b.id }} variant="success" confirm={`Mark all ${(b.reimbursements ?? []).length} claims of ${monthLabel(b.month)} as paid?`}>
                          Mark paid
                        </ActionButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pre-approvals</CardTitle>
              <Badge>{preapprovals?.length ?? 0}</Badge>
            </CardHeader>
            <CardContent>
              {!preapprovals?.length && <EmptyState>No open requests.</EmptyState>}
              <ul className="space-y-3 text-sm" data-testid="preapprovals">
                {(preapprovals ?? []).map((p) => (
                  <li key={p.id} className="space-y-1">
                    <p>
                      <span className="font-medium">{p.description}</span> · {formatCents(p.estimated_cents)} ·{" "}
                      {(p.profiles as { full_name: string } | null)?.full_name} · {(p.events as { title: string } | null)?.title}
                    </p>
                    {isTreasurer ? <PreapprovalDecision id={p.id} /> : <p className="text-xs text-gray-500">Waiting for the Treasurer.</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Weekend trips: budgets for social activities</CardTitle>
          </CardHeader>
          <CardContent>
            {!trips?.length && <EmptyState>No upcoming weekend trips.</EmptyState>}
            <ul className="divide-y divide-gray-100 text-sm">
              {(trips ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-gray-500">{formatDate(t.starts_at)}</span>
                  <span className="ml-auto">
                    <TripBudgetForm eventId={t.id} current={(t.trip_budgets as { amount_cents: number } | null)?.amount_cents ?? null} disabled={!canAct} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
