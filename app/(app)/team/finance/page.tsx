import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Inbox, Receipt, Upload, Wallet } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinInputToIso, formatCents, formatDate, nowMs } from "@/lib/dates";
import { addDays } from "@/lib/month";
import { hasRole } from "@/lib/roles";
import { parseSemesterKey, semesterFor } from "@/lib/internal";
import { totals, type CashRow, type ClaimRow, type LedgerRow } from "@/lib/finance";
import { monthly, monthsOf, planVsActual, type Line } from "@/lib/financeReport";
import { plural } from "@/lib/plural";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { Figure, SemesterNav } from "@/components/finance/SemesterNav";
import { BalanceLine, BarList, INCOME, MonthlyBars, PlanBar, SPENDING } from "@/components/finance/Charts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Finance" };

// Finance's overview (redesign 2026-11-11), one semester at a time: what
// waits (payments to label, claims, paper receipts, cash boxes), the
// figures, the money available now (bank, PayPal, cash), income and
// spending per month, the running balance, the largest categories and the
// budget. Reimbursements count as spending in the month they were paid.
export default async function FinanceOverview({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(nowMs()).toISOString());
  const semester = parseSemesterKey((await searchParams).semester) ?? semesterFor(today);
  const fromIso = berlinInputToIso(`${semester.from}T00:00`);
  const toIso = berlinInputToIso(`${addDays(semester.to, 1)}T00:00`);

  const [entriesQ, catsQ, claimsQ, paidQ, boxesQ, bookedBoxesQ, openPaymentsQ, belegQ, budgetQ, bankQ, paypalQ, physicalQ, importsQ] = await Promise.all([
    supabase.from("finance_entries").select("direction, amount_cents, booked_on, category_id, event_id, beleg_received").gte("booked_on", semester.from).lte("booked_on", semester.to),
    supabase.from("finance_categories").select("id, name, direction"),
    supabase.from("reimbursements").select("event_id, status, suggested_cents, approved_cents, events!inner(starts_at)").gte("events.starts_at", fromIso).lt("events.starts_at", toIso),
    supabase.from("reimbursements").select("approved_cents, paid_at").eq("status", "paid").gte("paid_at", fromIso).lt("paid_at", toIso),
    supabase.from("cash_reports").select("id, event_id, internal_event_id, opening_cents, closing_cents, closed_at, events(starts_at), internal_events(starts_at)").not("closed_at", "is", null),
    supabase.from("finance_entries").select("cash_report_id").not("cash_report_id", "is", null),
    supabase.from("payments").select("id, gross_cents, suggestion", { count: "exact" }).eq("status", "open").limit(1000),
    supabase.from("finance_entries").select("id", { count: "exact", head: true }).eq("direction", "expense").eq("beleg_received", false).gte("booked_on", semester.from).lte("booked_on", semester.to),
    supabase.from("budget_lines").select("category_id, event_id, planned_cents").eq("semester", semester.key),
    supabase.from("account_balances").select("cents, as_of").eq("account", "bank").order("as_of", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("payment_imports").select("balance_cents, balance_on").eq("source", "paypal").not("balance_cents", "is", null).order("balance_on", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cash_boxes").select("cents").is("removed_at", null),
    supabase.from("payment_imports").select("period_to").eq("source", "paypal").order("period_to", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
  ]);
  const { count: toCheck } = await supabase.from("reimbursements").select("id", { count: "exact", head: true }).eq("status", "beleg_received");
  const { count: noBeleg } = await supabase.from("reimbursements").select("id", { count: "exact", head: true }).eq("status", "not_submitted");

  const cats = new Map((catsQ.data ?? []).map((c) => [c.id, c]));
  const entries = entriesQ.data ?? [];
  const ledger: LedgerRow[] = entries.map((e) => ({ direction: e.direction as LedgerRow["direction"], amount_cents: e.amount_cents, category: cats.get(e.category_id)?.name ?? "?", event_id: e.event_id, booked_on: e.booked_on }));
  const claims: ClaimRow[] = (claimsQ.data ?? []).map((c) => ({ event_id: c.event_id, status: c.status, suggested_cents: c.suggested_cents, approved_cents: c.approved_cents }));
  const booked = new Set((bookedBoxesQ.data ?? []).map((b) => b.cash_report_id));
  const inPeriod = (iso: string | undefined) => !!iso && iso >= fromIso && iso < toIso;
  const cash: CashRow[] = (boxesQ.data ?? [])
    .filter((b) => inPeriod((b.events as { starts_at: string } | null)?.starts_at ?? (b.internal_events as { starts_at: string } | null)?.starts_at))
    .map((b) => ({ event_id: b.event_id, internal_event_id: b.internal_event_id, opening_cents: b.opening_cents, closing_cents: b.closing_cents, closed: !!b.closed_at, booked: booked.has(b.id) }));
  const t = totals(ledger, claims, cash);
  const boxesToBook = cash.filter((c) => c.closed && !c.booked && (c.closing_cents ?? 0) > (c.opening_cents ?? 0)).length;

  // Per month: the ledger plus reimbursements in the month they were paid.
  const lines: Line[] = [
    ...entries.map((e) => ({ direction: e.direction as Line["direction"], amount_cents: e.amount_cents, booked_on: e.booked_on, category_id: e.category_id })),
    ...(paidQ.data ?? []).map((r) => ({ direction: "expense" as const, amount_cents: r.approved_cents ?? 0, booked_on: berlinDate(r.paid_at!), category_id: "reimbursements" })),
  ];
  const months = monthsOf(semester.from, semester.to);
  const points = monthly(lines, months);
  const shown = points.filter((p) => p.month <= today.slice(0, 7) || p.income || p.expenses);

  const sumBy = (dir: "income" | "expense") => {
    const m = new Map<string, number>();
    for (const l of lines) if (l.direction === dir) m.set(l.category_id, (m.get(l.category_id) ?? 0) + l.amount_cents);
    return [...m.entries()]
      .map(([id, cents]) => ({ label: id === "reimbursements" ? "Reimbursements (claims)" : (cats.get(id)?.name ?? "?"), cents }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 6);
  };

  const direction = new Map((catsQ.data ?? []).map((c) => [c.id, c.direction as "income" | "expense"]));
  const plan = planVsActual(budgetQ.data ?? [], lines.filter((l) => l.category_id !== "reimbursements"), direction);
  const planned = { income: plan.filter((r) => r.direction === "income").reduce((s, r) => s + r.planned, 0), expense: plan.filter((r) => r.direction === "expense").reduce((s, r) => s + r.planned, 0) };
  const actual = { income: t.income, expense: t.expenses + t.reimbursementsPaid + t.reimbursementsDue };

  const openPayments = openPaymentsQ.count ?? 0;
  const suggested = (openPaymentsQ.data ?? []).filter((p) => p.suggestion && !p.suggestion.startsWith("Could not")).length;
  const cashInBoxes = (physicalQ.data ?? []).reduce((s, b) => s + (b.cents ?? 0), 0);
  const bank = bankQ.data;
  const paypal = paypalQ.data;
  const available = (bank?.cents ?? 0) + (paypal?.balance_cents ?? 0) + cashInBoxes;
  const lastImport = importsQ.data?.period_to ?? null;
  const importStale = !lastImport || lastImport < addDays(today, -21);

  const todos = [
    { show: openPayments > 0, icon: Inbox, href: "/team/finance/inbox", text: `${plural(openPayments, "payment")} to label`, sub: suggested ? `${suggested} with a suggestion – confirm with one click` : "Pick a category and event", tone: "amber" },
    { show: (toCheck ?? 0) > 0, icon: Receipt, href: "/team/finance/claims?status=beleg_received#claims", text: `${plural(toCheck ?? 0, "claim")} to check`, sub: "Paper receipt is in", tone: "amber" },
    { show: (noBeleg ?? 0) > 0, icon: Receipt, href: "/team/finance/claims?status=not_submitted#claims", text: `${plural(noBeleg ?? 0, "claim")} without paper receipt`, sub: "Waiting for the Beleg", tone: "gray" },
    { show: (belegQ.count ?? 0) > 0, icon: AlertTriangle, href: "/team/finance/ledger?beleg=missing", text: `${plural(belegQ.count ?? 0, "spending line")} without receipt`, sub: "File the invoice for the tax return", tone: "gray" },
    { show: boxesToBook > 0, icon: Wallet, href: "/team/finance/cash", text: `${plural(boxesToBook, "cash box", "cash boxes")} to book`, sub: `${formatCents(t.cashUnbooked)} takings`, tone: "gray" },
    { show: importStale, icon: Upload, href: "/team/finance/import", text: lastImport ? `PayPal imported until ${formatDate(lastImport)}` : "No PayPal import yet", sub: "Import the latest activity download", tone: "gray" },
  ].filter((x) => x.show);

  return (
    <>
      <PageHeader title="Finance" description="The organisation's money at a glance: what waits, where it stands, where it went.">
        <div className="flex flex-wrap items-center gap-2">
          {!canAct && <Badge data-testid="read-only">Read-only (executive)</Badge>}
          <SemesterNav semester={semester} path="/team/finance" />
        </div>
      </PageHeader>
      <FinanceTabs current="overview" />
      <div className="space-y-6">
        <section aria-label="To do" data-testid="finance-todo">
          {todos.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {todos.map((x) => (
                <li key={x.text}>
                  <Link href={x.href} className={cn("flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm hover:border-esn", x.tone === "amber" ? "border-amber-300" : "border-gray-200")}>
                    <x.icon className={cn("h-5 w-5 shrink-0", x.tone === "amber" ? "text-amber-600" : "text-gray-400")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-900">{x.text}</span>
                      <span className="block text-xs text-gray-500">{x.sub}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Nothing waits – every payment is labelled and every claim checked.
            </p>
          )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="overview-figures">
          <Figure label={`Income ${semester.name}`} value={formatCents(t.income)} tone="text-emerald-700" sub={planned.income ? `${Math.round((t.income / planned.income) * 100)}% of ${formatCents(planned.income)} planned` : undefined} href={`/team/finance/ledger?semester=${semester.key}&direction=income`} />
          <Figure label="Spending incl. claims" value={formatCents(actual.expense)} sub={planned.expense ? `${Math.round((actual.expense / planned.expense) * 100)}% of ${formatCents(planned.expense)} planned` : `claims ${formatCents(t.reimbursementsPaid + t.reimbursementsDue)}`} href={`/team/finance/ledger?semester=${semester.key}&direction=expense`} />
          <Figure label="Result" value={formatCents(t.net)} tone={t.net < 0 ? "text-red-700" : "text-emerald-700"} sub={t.reimbursementsOpen ? `+ ${formatCents(t.reimbursementsOpen)} claims not checked` : undefined} />
          <Figure
            label="Available now"
            value={formatCents(available)}
            testId="available"
            sub={
              <>
                bank {bank ? `${formatCents(bank.cents)} (${formatDate(bank.as_of)})` : "–"} · PayPal {paypal ? formatCents(paypal.balance_cents) : "–"} · cash {formatCents(cashInBoxes)}
              </>
            }
            href="/team/finance/budget#balances"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Income and spending per month</CardTitle>
            </CardHeader>
            <CardContent>{lines.length ? <MonthlyBars points={shown} /> : <EmptyState>Nothing booked in {semester.name} yet.</EmptyState>}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Result over the semester</CardTitle>
            </CardHeader>
            <CardContent>
              {lines.length ? <BalanceLine points={shown} /> : <EmptyState>Nothing booked yet.</EmptyState>}
              <p className="mt-1 text-xs text-gray-500">Income minus spending and paid claims, added up month by month from the start of {semester.name}.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Largest income</CardTitle>
            </CardHeader>
            <CardContent>{sumBy("income").length ? <BarList rows={sumBy("income")} color={INCOME} testId="top-income" /> : <EmptyState>No income yet.</EmptyState>}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Largest spending</CardTitle>
            </CardHeader>
            <CardContent>{sumBy("expense").length ? <BarList rows={sumBy("expense")} color={SPENDING} testId="top-spending" /> : <EmptyState>No spending yet.</EmptyState>}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Budget</CardTitle>
              <Link href={`/team/finance/budget?semester=${semester.key}`} className="text-sm text-esn hover:underline">
                Plan →
              </Link>
            </CardHeader>
            <CardContent className="space-y-4">
              {planned.income + planned.expense === 0 ? (
                <EmptyState>No plan for {semester.name} yet.</EmptyState>
              ) : (
                <>
                  <div>
                    <p className="mb-1 text-sm font-medium">Income</p>
                    <PlanBar planned={planned.income} actual={actual.income} direction="income" />
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-medium">Spending incl. claims</p>
                    <PlanBar planned={planned.expense} actual={actual.expense} direction="expense" />
                  </div>
                  {plan
                    .filter((r) => r.direction === "expense" && r.share !== null && r.share > 0.9)
                    .slice(0, 3)
                    .map((r) => (
                      <p key={r.category_id} className="text-xs text-amber-800">
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                        {cats.get(r.category_id)?.name}: {Math.round((r.share ?? 0) * 100)}% of its plan spent
                      </p>
                    ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
