import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinInputToIso, formatCents, formatDate, nowMs } from "@/lib/dates";
import { addDays } from "@/lib/month";
import { hasRole } from "@/lib/roles";
import { parseSemesterKey, semesterFor, shiftSemester } from "@/lib/internal";
import { planVsActual, type Line } from "@/lib/financeReport";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { Figure, SemesterNav } from "@/components/finance/SemesterNav";
import { PlanBar } from "@/components/finance/Charts";
import { cn } from "@/lib/utils";
import { BalanceForm, BudgetLineActions, BudgetLineForm, CopyBudget, DeleteBalance } from "./BudgetClient";

export const metadata: Metadata = { title: "Budget" };

// Budget and planning (round 2026-11-11): what the semester is planned to
// bring in and cost per category and per event, against what was booked
// (claims count as event costs), the money available now (bank balance
// noted by Finance, the PayPal balance of the last import, the cash
// boxes), and the forecast for the semester's end.
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(nowMs()).toISOString());
  const semester = parseSemesterKey((await searchParams).semester) ?? semesterFor(today);
  const prev = shiftSemester(semester, -1);
  const fromIso = berlinInputToIso(`${semester.from}T00:00`);
  const toIso = berlinInputToIso(`${addDays(semester.to, 1)}T00:00`);

  const [{ data: lines }, { data: cats }, { data: entries }, { data: claims }, { data: events }, { data: balances }, { data: paypal }, { data: boxes }, { count: prevLines }] = await Promise.all([
    supabase.from("budget_lines").select("id, semester, category_id, event_id, label, planned_cents, note").eq("semester", semester.key).order("created_at"),
    supabase.from("finance_categories").select("id, name, direction, active").order("sort").order("name"),
    supabase.from("finance_entries").select("direction, amount_cents, booked_on, category_id, event_id").gte("booked_on", semester.from).lte("booked_on", semester.to),
    supabase.from("reimbursements").select("event_id, status, approved_cents, events!inner(starts_at)").in("status", ["checked", "paid"]).gte("events.starts_at", fromIso).lt("events.starts_at", toIso),
    supabase.from("events").select("id, title, starts_at").eq("source", "platform").not("status", "in", "(draft,dropped)").gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at"),
    supabase.from("account_balances").select("id, account, as_of, cents, note, created_by").order("as_of", { ascending: false }).order("created_at", { ascending: false }).limit(12),
    supabase.from("payment_imports").select("balance_cents, balance_on").eq("source", "paypal").not("balance_cents", "is", null).order("balance_on", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("cash_boxes").select("name, cents").is("removed_at", null),
    supabase.from("budget_lines").select("id", { count: "exact", head: true }).eq("semester", prev.key),
  ]);

  const catList = (cats ?? []).map((c) => ({ id: c.id, name: c.name, direction: c.direction as "income" | "expense", active: c.active }));
  const catOf = new Map(catList.map((c) => [c.id, c]));
  const eventCosts = catList.find((c) => c.direction === "expense" && c.name === "Event costs");
  const actualLines: Line[] = [
    ...(entries ?? []).map((e) => ({ direction: e.direction as Line["direction"], amount_cents: e.amount_cents, booked_on: e.booked_on, category_id: e.category_id })),
    // Claims (checked or paid) are event costs.
    ...(eventCosts ? (claims ?? []).map((c) => ({ direction: "expense" as const, amount_cents: c.approved_cents ?? 0, booked_on: semester.from, category_id: eventCosts.id })) : []),
  ];
  const plan = planVsActual(lines ?? [], actualLines, new Map(catList.map((c) => [c.id, c.direction])));
  const sum = (dir: "income" | "expense", k: "planned" | "actual") => plan.filter((r) => r.direction === dir).reduce((s, r) => s + r[k], 0);
  const remaining = (dir: "income" | "expense") => plan.filter((r) => r.direction === dir).reduce((s, r) => s + Math.max(r.planned - r.actual, 0), 0);

  // Per event: plan lines and booked lines of the event.
  const eventIds = new Set((lines ?? []).filter((l) => l.event_id).map((l) => l.event_id!));
  const perEvent = (events ?? [])
    .filter((e) => eventIds.has(e.id))
    .map((e) => {
      const planned = (dir: "income" | "expense") => (lines ?? []).filter((l) => l.event_id === e.id && catOf.get(l.category_id)?.direction === dir).reduce((s, l) => s + l.planned_cents, 0);
      const actual = (dir: "income" | "expense") =>
        (entries ?? []).filter((x) => x.event_id === e.id && x.direction === dir).reduce((s, x) => s + x.amount_cents, 0) + (dir === "expense" ? (claims ?? []).filter((c) => c.event_id === e.id).reduce((s, c) => s + (c.approved_cents ?? 0), 0) : 0);
      return { e, plannedIn: planned("income"), plannedOut: planned("expense"), actualIn: actual("income"), actualOut: actual("expense") };
    });

  const bank = (balances ?? []).find((b) => b.account === "bank");
  const cash = (boxes ?? []).reduce((s, b) => s + b.cents, 0);
  const available = (bank?.cents ?? 0) + (paypal?.balance_cents ?? 0) + cash;
  const forecast = available + remaining("income") - remaining("expense");
  const eventOptions = (events ?? []).map((e) => ({ id: e.id, label: `${formatDate(e.starts_at)} · ${e.title}` }));
  const semesterLines = (lines ?? []).filter((l) => !l.event_id);

  return (
    <>
      <PageHeader title="Finance" description="Plan the semester's income and spending, follow it as money comes in and goes out, and see what will be left.">
        <div className="flex flex-wrap items-center gap-2">
          {!canAct && <Badge>Read-only (executive)</Badge>}
          <SemesterNav semester={semester} path="/team/finance/budget" />
        </div>
      </PageHeader>
      <FinanceTabs current="budget" />
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="budget-figures">
          <Figure label="Planned income" value={formatCents(sum("income", "planned"))} sub={`${formatCents(sum("income", "actual"))} in so far`} />
          <Figure label="Planned spending" value={formatCents(sum("expense", "planned"))} sub={`${formatCents(sum("expense", "actual"))} spent so far (incl. claims)`} />
          <Figure label="Available now" value={formatCents(available)} sub={`bank ${bank ? formatCents(bank.cents) : "–"} · PayPal ${paypal ? formatCents(paypal.balance_cents) : "–"} · cash ${formatCents(cash)}`} />
          <Figure
            label={`Expected at the end of ${semester.name}`}
            value={formatCents(forecast)}
            tone={forecast < 0 ? "text-red-700" : "text-emerald-700"}
            sub={`now + ${formatCents(remaining("income"))} still to come − ${formatCents(remaining("expense"))} still to spend`}
            testId="forecast"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Plan by category</CardTitle>
            {canAct && !(lines ?? []).length && prevLines ? <CopyBudget from={prev.key} fromName={prev.name} to={semester.key} /> : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {canAct && <BudgetLineForm semester={semester.key} categories={catList.filter((c) => c.active)} events={eventOptions} />}
            {!plan.length ? (
              <EmptyState>No plan for {semester.name} yet – add what you expect per category.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="plan">
                  <thead className="text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-2 pr-3">Category</th>
                      <th className="py-2 pr-3">Planned</th>
                      <th className="w-[40%] py-2">Booked against the plan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {plan.map((r) => {
                      const own = semesterLines.filter((l) => l.category_id === r.category_id);
                      const ofEvents = (lines ?? []).filter((l) => l.category_id === r.category_id && l.event_id);
                      return (
                        <tr key={r.category_id} className="align-top">
                          <td className="py-2 pr-3">
                            <Badge tone={r.direction === "income" ? "green" : "gray"} className="mr-1.5">
                              {r.direction === "income" ? "in" : "out"}
                            </Badge>
                            <span className="font-medium">{catOf.get(r.category_id)?.name}</span>
                            {eventCosts?.id === r.category_id && <span className="block text-xs text-gray-500">incl. checked and paid claims</span>}
                          </td>
                          <td className="py-2 pr-3">
                            <ul className="space-y-0.5">
                              {own.map((l) => (
                                <li key={l.id} className="flex flex-wrap items-center gap-1.5">
                                  {l.label && <span className="text-xs text-gray-600">{l.label}:</span>}
                                  {canAct ? <BudgetLineActions line={l} /> : <span className="text-xs">{formatCents(l.planned_cents)}</span>}
                                </li>
                              ))}
                              {ofEvents.length > 0 && <li className="text-xs text-gray-500">+ {formatCents(ofEvents.reduce((s, l) => s + l.planned_cents, 0))} for events</li>}
                              {!own.length && !ofEvents.length && <li className="text-xs text-gray-400">not planned</li>}
                            </ul>
                          </td>
                          <td className="py-2">
                            <PlanBar planned={r.planned} actual={r.actual} direction={r.direction} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Event budgets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canAct && <BudgetLineForm semester={semester.key} categories={catList.filter((c) => c.active)} events={eventOptions} presetEvent />}
            {!perEvent.length ? (
              <EmptyState>No event has a budget in {semester.name}. Plan the big ones (trips, parties) here.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100" data-testid="event-budgets">
                {perEvent.map(({ e, plannedIn, plannedOut, actualIn, actualOut }) => {
                  const plannedNet = plannedIn - plannedOut;
                  const net = actualIn - actualOut;
                  return (
                    <li key={e.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1.2fr)_1fr_1fr_8rem]">
                      <div>
                        <Link href={`/events/${e.id}`} className="font-medium hover:text-esn">
                          {e.title}
                        </Link>
                        <p className="text-xs text-gray-500">{formatDate(e.starts_at)}</p>
                        <ul className="mt-1 flex flex-wrap gap-x-3 text-xs">
                          {(lines ?? [])
                            .filter((l) => l.event_id === e.id)
                            .map((l) => (
                              <li key={l.id} className="flex items-center gap-1">
                                <span className="text-gray-600">{l.label || catOf.get(l.category_id)?.name}:</span>
                                {canAct ? <BudgetLineActions line={l} /> : formatCents(l.planned_cents)}
                              </li>
                            ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-gray-500">Income</p>
                        <PlanBar planned={plannedIn} actual={actualIn} direction="income" />
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-gray-500">Costs incl. claims</p>
                        <PlanBar planned={plannedOut} actual={actualOut} direction="expense" />
                      </div>
                      <div className="text-right text-sm">
                        <p className={cn("font-semibold tabular-nums", net < 0 ? "text-red-700" : "text-emerald-700")}>{formatCents(net)}</p>
                        <p className="text-xs text-gray-500">planned {formatCents(plannedNet)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card id="balances" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Account balances</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              Note the bank balance from each statement; the PayPal balance comes with every import{paypal?.balance_on ? ` (last: ${formatCents(paypal.balance_cents)} on ${formatDate(paypal.balance_on)})` : ""}, the cash with the cash boxes ({formatCents(cash)}
              {(boxes ?? []).length ? ` in ${(boxes ?? []).map((b) => b.name).join(", ")}` : ""}).
            </p>
            {canAct && <BalanceForm today={today} />}
            {(balances ?? []).length > 0 && (
              <ul className="divide-y divide-gray-100 text-sm" data-testid="balances">
                {(balances ?? []).map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <Badge tone="gray">{b.account === "bank" ? "Bank" : b.account === "paypal" ? "PayPal" : "Other"}</Badge>
                    <span className="tabular-nums">{formatDate(b.as_of)}</span>
                    <span className="font-medium tabular-nums">{formatCents(b.cents)}</span>
                    {b.note && <span className="text-xs text-gray-500">{b.note}</span>}
                    <span className="ml-auto text-xs text-gray-400">{b.created_by}</span>
                    {canAct && <DeleteBalance id={b.id} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
