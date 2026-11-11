import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, formatCents, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { loadYear } from "@/lib/financeYear";
import { bySphere, commercialLimit, monthly, SPHERE_LABELS, SPHERES } from "@/lib/financeReport";
import { plural } from "@/lib/plural";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, buttonVariants } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { MonthlyBars } from "@/components/finance/Charts";
import { cn } from "@/lib/utils";
import { SphereSelect } from "./ReportsClient";

export const metadata: Metadata = { title: "Reports and tax" };

// Reports for the tax return (round 2026-11-11), one calendar year: the
// EÜR split into the four spheres of a non-profit, the commercial income
// against the § 64 (3) AO limit, what is still missing before the books
// can be closed, the sphere of every category, and CSV downloads for the
// Treasurer and the tax adviser (journal, EÜR, PayPal, events).
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(nowMs()).toISOString());
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [lines, { data: cats }, { count: openPayments }, { count: noReceipt }, { count: openClaims }, { data: boxes }, { data: booked }] = await Promise.all([
    loadYear(supabase, year),
    supabase.from("finance_categories").select("id, name, direction, sphere, active").order("direction", { ascending: false }).order("sort").order("name"),
    supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "open").gte("booked_on", from).lte("booked_on", to),
    supabase.from("finance_entries").select("id", { count: "exact", head: true }).eq("direction", "expense").eq("beleg_received", false).gte("booked_on", from).lte("booked_on", to),
    supabase.from("reimbursements").select("id, events!inner(starts_at)", { count: "exact", head: true }).in("status", ["not_submitted", "beleg_received", "checked"]).gte("events.starts_at", `${from}T00:00:00Z`).lte("events.starts_at", `${to}T23:59:59Z`),
    supabase.from("cash_reports").select("id, opening_cents, closing_cents, closed_at").not("closed_at", "is", null).gte("closed_at", `${from}T00:00:00Z`).lte("closed_at", `${to}T23:59:59Z`),
    supabase.from("finance_entries").select("cash_report_id").not("cash_report_id", "is", null),
  ]);
  const bookedBoxes = new Set((booked ?? []).map((b) => b.cash_report_id));
  const unbookedBoxes = (boxes ?? []).filter((b) => !bookedBoxes.has(b.id) && (b.closing_cents ?? 0) > (b.opening_cents ?? 0)).length;

  const spheres = bySphere(lines.map((l) => ({ direction: l.direction, amount_cents: l.cents, booked_on: l.day, category_id: l.category, sphere: l.sphere })));
  const total = spheres.reduce((a, s) => ({ income: a.income + s.income, expenses: a.expenses + s.expenses }), { income: 0, expenses: 0 });
  const commercial = spheres.find((s) => s.sphere === "wirtschaftlich")!;
  const limit = commercialLimit(year);
  const byCategory = (sphere: string) => {
    const m = new Map<string, { in: number; out: number }>();
    for (const l of lines.filter((x) => x.sphere === sphere)) {
      const r = m.get(l.category) ?? { in: 0, out: 0 };
      if (l.direction === "income") r.in += l.cents;
      else r.out += l.cents;
      m.set(l.category, r);
    }
    return [...m.entries()].sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));
  };
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const points = monthly(
    lines.map((l) => ({ direction: l.direction, amount_cents: l.cents, booked_on: l.day, category_id: l.category })),
    months
  ).filter((p) => p.month <= today.slice(0, 7) || p.income || p.expenses);

  const checks = [
    { ok: !openPayments, text: openPayments ? `${plural(openPayments, "PayPal payment")} not labelled` : "Every imported PayPal payment is labelled", href: "/team/finance/inbox" },
    { ok: !noReceipt, text: noReceipt ? `${plural(noReceipt, "spending line")} without a filed receipt` : "Every spending line has its receipt", href: `/team/finance/ledger?year=${year}&beleg=missing` },
    { ok: !openClaims, text: openClaims ? `${plural(openClaims, "claim")} of the year not paid or rejected yet` : "Every claim is settled", href: "/team/finance/claims" },
    { ok: !unbookedBoxes, text: unbookedBoxes ? `${plural(unbookedBoxes, "cash box", "cash boxes")} signed off but not booked` : "Every cash box is booked", href: "/team/finance/cash" },
  ];
  const exportHref = (kind: string) => `/team/finance/reports/export?year=${year}&kind=${kind}`;

  return (
    <>
      <PageHeader title="Finance" description="Everything the tax return needs: the EÜR by sphere, the limit for commercial activities, what is still open, and the exports for the tax adviser.">
        <div className="flex flex-wrap items-center gap-2">
          {!canAct && <Badge>Read-only (executive)</Badge>}
          <nav aria-label="Year" className="flex items-center gap-1">
            <Link href={`/team/finance/reports?year=${year - 1}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`${year - 1}`}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <span className="min-w-16 text-center font-semibold">{year}</span>
            <Link href={`/team/finance/reports?year=${year + 1}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`${year + 1}`}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </PageHeader>
      <FinanceTabs current="reports" />
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Before closing {year}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm" data-testid="year-checks">
                {checks.map((c) => (
                  <li key={c.text} className="flex items-center gap-2">
                    {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
                    {c.ok ? (
                      <span className="text-gray-700">{c.text}</span>
                    ) : (
                      <Link href={c.href} className="text-gray-900 hover:text-esn hover:underline">
                        {c.text}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Downloads (CSV)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(
                [
                  ["journal", "Journal", "every booking with receipt no., category and sphere"],
                  ["euer", "EÜR by sphere", "income, spending and result per sphere and category"],
                  ["paypal", "PayPal transactions", "as imported, with fees and how each was matched"],
                  ["events", "Events", "result of every event"],
                ] as const
              ).map(([kind, label, hint]) => (
                <a key={kind} href={exportHref(kind)} className="flex items-start gap-2 rounded-lg p-2 hover:bg-gray-50" data-testid={`export-${kind}`}>
                  <Download className="mt-0.5 h-4 w-4 shrink-0 text-esn" aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-medium text-esn">{label}</span>
                    <span className="block text-xs text-gray-500">{hint}</span>
                  </span>
                </a>
              ))}
              <p className="pt-1 text-xs text-gray-500">Semicolons and decimal commas – they open in German Excel and LibreOffice as they are.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Einnahmen-Überschuss-Rechnung {year}</CardTitle>
            <span className={cn("text-sm font-semibold tabular-nums", total.income - total.expenses < 0 ? "text-red-700" : "text-emerald-700")}>{formatCents(total.income - total.expenses)}</span>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm" data-testid="euer">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Sphere</th>
                  <th className="px-4 py-2 text-right">Income</th>
                  <th className="px-4 py-2 text-right">Spending</th>
                  <th className="px-4 py-2 text-right">Result</th>
                </tr>
              </thead>
              {spheres.map((s) => (
                <tbody key={s.sphere} className="border-t border-gray-200">
                  <tr className="bg-white font-medium">
                    <td className="px-4 py-2">
                      {SPHERE_LABELS[s.sphere].de}
                      <span className="block text-xs font-normal text-gray-500">{SPHERE_LABELS[s.sphere].en}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(s.income)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(s.expenses)}</td>
                    <td className={cn("px-4 py-2 text-right tabular-nums", s.result < 0 && "text-red-700")}>{formatCents(s.result)}</td>
                  </tr>
                  {byCategory(s.sphere).map(([name, r]) => (
                    <tr key={name} className="text-gray-600">
                      <td className="px-4 py-1 pl-8">{name}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{r.in ? formatCents(r.in) : ""}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{r.out ? formatCents(r.out) : ""}</td>
                      <td className="px-4 py-1" />
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot className="border-t-2 border-gray-300 font-semibold">
                <tr>
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(total.income)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(total.expenses)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(total.income - total.expenses)}</td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Commercial activities (§ 64 (3) AO)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Gross income of the wirtschaftlicher Geschäftsbetrieb: <strong className="tabular-nums">{formatCents(commercial.income)}</strong> of the {formatCents(limit)} limit.
              </p>
              <div className="h-2 rounded-full bg-gray-100" aria-hidden="true">
                <div className={cn("h-2 rounded-full", commercial.income > limit ? "bg-red-600" : commercial.income > limit * 0.8 ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${Math.min((commercial.income / limit) * 100, 100)}%` }} />
              </div>
              <p className="text-xs text-gray-500">
                Up to this limit (incl. VAT), a non-profit pays no corporate or trade tax on its commercial activities; above it, they are taxed. VAT is a separate question (small business rule). Ask the tax adviser
                – this page sorts the numbers, it does not give tax advice.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Income and spending {year}</CardTitle>
            </CardHeader>
            <CardContent>{lines.length ? <MonthlyBars points={points} height={200} /> : <p className="text-sm text-gray-500">Nothing booked in {year}.</p>}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Spheres of the categories</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-gray-600">Each category belongs to one sphere; the EÜR above follows it. Claims count as Zweckbetrieb (event costs). Check the defaults with the tax adviser once.</p>
            <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="spheres">
              {(cats ?? []).map((c) => (
                <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={c.direction === "income" ? "green" : "gray"}>{c.direction === "income" ? "in" : "out"}</Badge>
                  <span className={cn("min-w-0 flex-1", !c.active && "text-gray-400 line-through")}>{c.name}</span>
                  {canAct ? (
                    <SphereSelect id={c.id} name={c.name} sphere={c.sphere as (typeof SPHERES)[number]} />
                  ) : (
                    <span className="text-xs text-gray-600">{SPHERE_LABELS[c.sphere as (typeof SPHERES)[number]]?.de}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
