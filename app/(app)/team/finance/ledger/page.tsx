import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinInputToIso, formatCents, formatDate, nowMs } from "@/lib/dates";
import { addDays } from "@/lib/month";
import { hasRole } from "@/lib/roles";
import { parseSemesterKey, semesterFor, shiftSemester } from "@/lib/internal";
import { METHOD_LABELS, byCategory, perEvent, totals, type CashRow, type ClaimRow, type LedgerRow } from "@/lib/finance";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { cn } from "@/lib/utils";
import { Categories, EntryActions, EntryForm, type Category, type EntryValues } from "./LedgerClient";

export const metadata: Metadata = { title: "Finance overview" };

// Finance's overview of the organisation (round 2026-10-30), one semester at
// a time: the ledger (other income and spending with categories – merch, an
// event's revenue, Belege paid straight from the MESA bank account), the
// reimbursements from claims, cash boxes not booked yet, and each event's
// balance. Executives read it.
export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());
  const semester = parseSemesterKey((await searchParams).semester) ?? semesterFor(today);
  const fromIso = berlinInputToIso(`${semester.from}T00:00`);
  const toIso = berlinInputToIso(`${addDays(semester.to, 1)}T00:00`);

  const [{ data: entries }, { data: categories }, { data: claims }, { data: boxes }, { data: events }] = await Promise.all([
    supabase
      .from("finance_entries")
      .select("id, direction, category_id, event_id, internal_event_id, cash_report_id, amount_cents, booked_on, description, counterparty, payment_method, beleg_ref, beleg_received, note, finance_categories(name), events(title), internal_events(title)")
      .gte("booked_on", semester.from)
      .lte("booked_on", semester.to)
      .order("booked_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("finance_categories").select("id, name, direction, active").order("sort").order("name"),
    supabase.from("reimbursements").select("event_id, status, suggested_cents, approved_cents, events!inner(starts_at)").gte("events.starts_at", fromIso).lt("events.starts_at", toIso),
    supabase.from("cash_reports").select("id, event_id, internal_event_id, opening_cents, closing_cents, closed_at, events(starts_at), internal_events(starts_at)"),
    supabase.from("events").select("id, title, starts_at").eq("source", "platform").not("status", "in", "(draft,dropped)").gte("starts_at", fromIso).lt("starts_at", toIso).order("starts_at"),
  ]);
  const booked = new Set((entries ?? []).map((e) => e.cash_report_id).filter(Boolean));
  const { data: allBooked } = await supabase.from("finance_entries").select("cash_report_id").not("cash_report_id", "is", null);
  for (const b of allBooked ?? []) booked.add(b.cash_report_id);

  const ledger: LedgerRow[] = (entries ?? []).map((e) => ({
    direction: e.direction as LedgerRow["direction"],
    amount_cents: e.amount_cents,
    category: (e.finance_categories as { name: string } | null)?.name ?? "?",
    event_id: e.event_id,
    booked_on: e.booked_on,
  }));
  const claimRows: ClaimRow[] = (claims ?? []).map((c) => ({ event_id: c.event_id, status: c.status, suggested_cents: c.suggested_cents, approved_cents: c.approved_cents }));
  const inPeriod = (iso: string | undefined) => !!iso && iso >= fromIso && iso < toIso;
  const cash: CashRow[] = (boxes ?? [])
    .filter((b) => inPeriod((b.events as { starts_at: string } | null)?.starts_at ?? (b.internal_events as { starts_at: string } | null)?.starts_at))
    .map((b) => ({ event_id: b.event_id, internal_event_id: b.internal_event_id, opening_cents: b.opening_cents, closing_cents: b.closing_cents, closed: !!b.closed_at, booked: booked.has(b.id) }));
  const t = totals(ledger, claimRows, cash);
  const categoriesSum = byCategory(ledger);
  const eventTotals = perEvent(ledger, claimRows, cash);
  const eventList = events ?? [];
  const eventOptions = eventList.map((e) => ({ id: e.id, label: `${formatDate(e.starts_at)} · ${e.title}` }));
  const cats = (categories ?? []) as Category[];
  const prev = shiftSemester(semester, -1);
  const next = shiftSemester(semester, 1);

  const figures: Array<[string, number, string?]> = [
    ["Income", t.income, "text-emerald-700"],
    ["Spending", t.expenses],
    ["Reimbursements paid", t.reimbursementsPaid],
    ["Reimbursements due", t.reimbursementsDue],
    ["Balance", t.net, t.net < 0 ? "text-red-700" : "text-emerald-700"],
  ];

  return (
    <>
      <PageHeader title="Finance" description="The whole picture: other income and spending, reimbursements and cash boxes, per event.">
        <div className="flex flex-wrap items-center gap-2">
          {!canAct && <Badge data-testid="read-only">Read-only (executive)</Badge>}
          <nav aria-label="Semester" className="flex items-center gap-1">
            <Link href={`/team/finance/ledger?semester=${prev.key}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Previous semester (${prev.name})`}>
              ←
            </Link>
            <span className="min-w-28 text-center font-semibold">{semester.name}</span>
            <Link href={`/team/finance/ledger?semester=${next.key}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Next semester (${next.name})`}>
              →
            </Link>
          </nav>
        </div>
      </PageHeader>
      <FinanceTabs current="ledger" />
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="ledger-figures">
          {figures.map(([label, cents, tone]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={cn("text-xl font-semibold tabular-nums", tone)}>{formatCents(cents)}</p>
            </Card>
          ))}
        </div>
        {(t.reimbursementsOpen > 0 || t.cashUnbooked > 0) && (
          <p className="text-sm text-gray-600">
            Not in the balance yet: {t.reimbursementsOpen > 0 && <>claims not checked {formatCents(t.reimbursementsOpen)} (suggested)</>}
            {t.reimbursementsOpen > 0 && t.cashUnbooked > 0 && " · "}
            {t.cashUnbooked > 0 && (
              <>
                cash box takings to book{" "}
                <Link href="/team/finance/cash" className="text-esn hover:underline">
                  {formatCents(t.cashUnbooked)}
                </Link>
              </>
            )}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Per event</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {!eventList.length ? (
                <EmptyState>No events in {semester.name}.</EmptyState>
              ) : (
                <table className="w-full text-sm" data-testid="per-event">
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Event</th>
                      <th className="px-3 py-2 text-right">Income</th>
                      <th className="px-3 py-2 text-right">Spending</th>
                      <th className="px-3 py-2 text-right">Claims</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {eventList.map((e) => {
                      const et = eventTotals.get(e.id);
                      return (
                        <tr key={e.id}>
                          <td className="px-3 py-2">
                            <Link href={`/events/${e.id}`} className="font-medium text-gray-900 hover:text-esn">
                              {e.title}
                            </Link>
                            <span className="block text-xs text-gray-500">
                              {formatDate(e.starts_at)}
                              {et?.cashUnbooked ? ` · cash box ${formatCents(et.cashUnbooked)} to book` : ""}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{et?.income ? formatCents(et.income) : "–"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{et?.expenses ? formatCents(et.expenses) : "–"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {et && et.reimbursementsPaid + et.reimbursementsDue ? formatCents(et.reimbursementsPaid + et.reimbursementsDue) : "–"}
                            {et?.reimbursementsOpen ? <span className="block text-xs text-gray-400">+{formatCents(et.reimbursementsOpen)} open</span> : null}
                          </td>
                          <td className={cn("px-3 py-2 text-right font-medium tabular-nums", et && et.net < 0 && "text-red-700")}>{et ? formatCents(et.net) : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>By category</CardTitle>
              </CardHeader>
              <CardContent>
                {!categoriesSum.length ? (
                  <EmptyState>Nothing booked in {semester.name}.</EmptyState>
                ) : (
                  <ul className="divide-y divide-gray-100 text-sm" data-testid="by-category">
                    {categoriesSum.map((c) => (
                      <li key={`${c.direction}-${c.category}`} className="flex items-center gap-2 py-1.5">
                        <Badge tone={c.direction === "income" ? "green" : "gray"}>{c.direction === "income" ? "in" : "out"}</Badge>
                        <span className="flex-1">{c.category}</span>
                        <span className="text-xs text-gray-500">{c.count}×</span>
                        <span className="tabular-nums">{formatCents(c.cents)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            {canAct && (
              <Card>
                <CardHeader>
                  <CardTitle>Book income or spending</CardTitle>
                </CardHeader>
                <CardContent>
                  <EntryForm categories={cats} events={eventOptions} today={today} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ledger {semester.name}</CardTitle>
            <Badge>{(entries ?? []).length}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            {!(entries ?? []).length ? (
              <EmptyState>No entries yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm" data-testid="ledger">
                {(entries ?? []).map((e) => {
                  const values: EntryValues = {
                    id: e.id,
                    direction: e.direction as EntryValues["direction"],
                    category_id: e.category_id,
                    event_id: e.event_id,
                    amount_cents: e.amount_cents,
                    booked_on: e.booked_on,
                    description: e.description,
                    counterparty: e.counterparty,
                    payment_method: e.payment_method as EntryValues["payment_method"],
                    beleg_ref: e.beleg_ref,
                    beleg_received: e.beleg_received,
                    note: e.note,
                  };
                  const about = (e.events as { title: string } | null)?.title ?? (e.internal_events as { title: string } | null)?.title;
                  return (
                    <li key={e.id} className="grid gap-x-3 gap-y-1 px-4 py-2 md:grid-cols-[6.5rem_minmax(0,1fr)_8rem_auto]">
                      <span className="tabular-nums text-gray-600">{e.booked_on}</span>
                      <span className="min-w-0">
                        <span className="font-medium">{e.description}</span>
                        <span className="block text-xs text-gray-500">
                          {(e.finance_categories as { name: string } | null)?.name}
                          {about && ` · ${about}`}
                          {e.counterparty && ` · ${e.counterparty}`}
                          {` · ${METHOD_LABELS[e.payment_method as keyof typeof METHOD_LABELS]}`}
                          {e.beleg_ref && ` · receipt ${e.beleg_ref}`}
                          {e.direction === "expense" && !e.beleg_received && <span className="text-amber-700"> · paper receipt missing</span>}
                          {e.note && ` · ${e.note}`}
                        </span>
                      </span>
                      <span className={cn("tabular-nums md:text-right", e.direction === "income" ? "text-emerald-700" : "text-gray-900")}>
                        {e.direction === "income" ? "+" : "−"}
                        {formatCents(e.amount_cents)}
                      </span>
                      <span>{canAct && <EntryActions entry={values} categories={cats} events={eventOptions} today={today} fromCashBox={!!e.cash_report_id} />}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {canAct && (
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <Categories categories={cats} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
