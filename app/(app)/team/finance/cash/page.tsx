import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, berlinInputToIso, formatCents, formatDate, formatDateTime, nowMs } from "@/lib/dates";
import { addDays } from "@/lib/month";
import { hasRole } from "@/lib/roles";
import { parseSemesterKey, semesterFor, shiftSemester } from "@/lib/internal";
import { CASH_STATUS_LABELS, CASH_STATUS_TONES, cashStatus, difference, takings, type CashCounts } from "@/lib/cash";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FinanceTabs } from "@/components/FinanceTabs";
import { checkCashBox } from "@/app/actions/cash";
import { cn } from "@/lib/utils";
import { EsncardPrices } from "./EsncardPrices";
import { CashBoxes, type BoxChange, type ManagedBox } from "./CashBoxes";

export const metadata: Metadata = { title: "Cash boxes" };

// The physical cash boxes with what is in them (round 2026-10-31), and
// every cash count of the semester (round 2026-10-30): office hours with the
// ESNcards sold (internal = members, external) and events that sold drinks
// or the like – counts before and after, takings, the difference to what
// the cards should have brought, and whether the OC signed off, Finance
// checked and booked it. Executives read it.
export default async function CashBoxesPage({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(nowMs()).toISOString());
  const semester = parseSemesterKey((await searchParams).semester) ?? semesterFor(today);
  const fromIso = berlinInputToIso(`${semester.from}T00:00`);
  const toIso = berlinInputToIso(`${addDays(semester.to, 1)}T00:00`);

  const [{ data: boxes }, { data: entries }, { data: prices }, { data: physical }, { data: changeRows }] = await Promise.all([
    supabase
      .from("cash_reports")
      .select("*, events(id, title, starts_at), internal_events(id, kind, title, starts_at)")
      .order("created_at", { ascending: false }),
    supabase.from("finance_entries").select("cash_report_id").not("cash_report_id", "is", null),
    supabase.from("app_settings").select("key, value").in("key", ["esncard_price_internal_cents", "esncard_price_external_cents"]),
    supabase.from("cash_boxes").select("id, name, default_for, cents, counts, removed_at").order("position").order("created_at"),
    supabase.from("cash_box_changes").select("id, box_id, kind, cents_before, cents_after, note, cash_report_id, created_at, created_by").order("created_at", { ascending: false }).limit(300),
  ]);
  const boxName = new Map((physical ?? []).map((b) => [b.id, b.name]));
  const { data: people } = await supabase.from("profiles").select("email, full_name").in("email", [...new Set((changeRows ?? []).map((c) => c.created_by).filter((e): e is string => !!e))]);
  const nameOf = new Map((people ?? []).map((p) => [p.email, p.full_name || p.email]));
  const reportTitle = (id: string | null) => {
    const b = id ? (boxes ?? []).find((x) => x.id === id) : null;
    const ev = (b?.events ?? b?.internal_events) as { title: string; starts_at: string } | null | undefined;
    return ev ? `${ev.title}, ${formatDate(ev.starts_at)}` : null;
  };
  const managed: ManagedBox[] = (physical ?? [])
    .filter((b) => !b.removed_at)
    .map((b) => ({
      id: b.id,
      name: b.name,
      defaultFor: b.default_for as ManagedBox["defaultFor"],
      cents: b.cents,
      counts: (b.counts ?? {}) as CashCounts,
      openReports: (boxes ?? []).filter((r) => r.cash_box_id === b.id && !r.closed_at).length,
      changes: (changeRows ?? [])
        .filter((c) => c.box_id === b.id)
        .map((c) => ({
          id: c.id,
          kind: c.kind as BoxChange["kind"],
          centsBefore: c.cents_before,
          centsAfter: c.cents_after,
          note: c.note,
          stamp: `${c.created_by ? (nameOf.get(c.created_by) ?? c.created_by) : "?"}, ${formatDateTime(c.created_at)}`,
          report: reportTitle(c.cash_report_id),
        })),
    }));
  const booked = new Set((entries ?? []).map((e) => e.cash_report_id));
  const price = (key: string) => {
    const v = (prices ?? []).find((p) => p.key === key)?.value;
    return typeof v === "number" ? v : null;
  };
  const rows = (boxes ?? [])
    .map((b) => {
      const ev = b.events as { id: string; title: string; starts_at: string } | null;
      const ie = b.internal_events as { id: string; kind: string; title: string; starts_at: string } | null;
      return {
        box: b,
        at: ev?.starts_at ?? ie?.starts_at ?? "",
        title: ev?.title ?? ie?.title ?? "?",
        href: ev ? `/events/${ev.id}/cash` : ie?.kind === "office_hour" ? `/office-hours/${ie.id}` : `/internal/${ie?.id}`,
        officeHour: ie?.kind === "office_hour",
        status: cashStatus(b, booked.has(b.id)),
      };
    })
    .filter((r) => r.at >= fromIso && r.at < toIso)
    .sort((a, b) => b.at.localeCompare(a.at));
  const office = rows.filter((r) => r.officeHour);
  const sum = (list: typeof rows, f: (r: (typeof rows)[number]) => number) => list.reduce((s, r) => s + f(r), 0);
  const closedTakings = (list: typeof rows) => sum(list.filter((r) => r.box.closed_at), (r) => takings(r.box) ?? 0);
  const prev = shiftSemester(semester, -1);
  const next = shiftSemester(semester, 1);

  return (
    <>
      <PageHeader title="Finance" description="Cash boxes of office hours and events: counted before and after, signed off by the OC.">
        <div className="flex flex-wrap items-center gap-2">
          {!canAct && <Badge data-testid="read-only">Read-only (executive)</Badge>}
          <nav aria-label="Semester" className="flex items-center gap-1">
            <Link href={`/team/finance/cash?semester=${prev.key}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Previous semester (${prev.name})`}>
              ←
            </Link>
            <span className="min-w-28 text-center font-semibold">{semester.name}</span>
            <Link href={`/team/finance/cash?semester=${next.key}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Next semester (${next.name})`}>
              →
            </Link>
          </nav>
        </div>
      </PageHeader>
      <FinanceTabs current="cash" />
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="cash-summary">
          {(
            [
              ["ESNcards internal", String(sum(office, (r) => r.box.esncards_internal))],
              ["ESNcards external", String(sum(office, (r) => r.box.esncards_external))],
              ["Office hour takings", formatCents(closedTakings(office))],
              ["Event cash box takings", formatCents(closedTakings(rows.filter((r) => !r.officeHour)))],
              ["Waiting for sign-off", String(rows.filter((r) => r.status === "counting").length)],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </Card>
          ))}
        </div>

        <section aria-labelledby="boxes-heading" className="space-y-2">
          <h2 id="boxes-heading" className="text-base font-semibold text-gray-900">
            The cash boxes
          </h2>
          <p className="text-sm text-gray-600">What is in each box now. A signed-off office hour or event sets its box to what was counted at the end; put money in, take it out or recount a box here.</p>
          <CashBoxes boxes={managed} canAct={canAct} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Office hours and events {semester.name}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {!rows.length ? (
              <EmptyState>No cash box used in {semester.name}.</EmptyState>
            ) : (
              <table className="w-full text-sm" data-testid="cash-boxes">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">When / what</th>
                    <th className="px-3 py-2 text-right">Before</th>
                    <th className="px-3 py-2 text-right">After</th>
                    <th className="px-3 py-2 text-right">Takings</th>
                    <th className="px-3 py-2 text-right">ESNcards</th>
                    <th className="px-3 py-2 text-right">Difference</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const take = takings(r.box);
                    const diff = r.officeHour ? difference(r.box) : null;
                    return (
                      <tr key={r.box.id}>
                        <td className="px-3 py-2">
                          <Link href={r.href} className="font-medium text-gray-900 hover:text-esn">
                            {r.title}
                          </Link>
                          <span className="block text-xs text-gray-500">
                            {formatDate(r.at)} · {boxName.get(r.box.cash_box_id) ?? "?"}
                            {r.box.note && ` · ${r.box.note}`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.box.opening_cents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCents(r.box.closing_cents)}</td>
                        <td className={cn("px-3 py-2 text-right font-medium tabular-nums", take !== null && take < 0 && "text-red-700")}>{formatCents(take)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.officeHour ? `${r.box.esncards_internal} / ${r.box.esncards_external}` : "–"}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", diff !== null && diff < 0 && "text-red-700", diff !== null && diff > 0 && "text-emerald-700")}>{diff === null ? "–" : formatCents(diff)}</td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap items-center gap-1">
                            <Badge tone={CASH_STATUS_TONES[r.status]}>{CASH_STATUS_LABELS[r.status]}</Badge>
                            {canAct && r.status === "signed_off" && (
                              <ActionButton action={checkCashBox} input={{ report_id: r.box.id }} variant="success">
                                Mark checked
                              </ActionButton>
                            )}
                            {canAct && (r.status === "signed_off" || r.status === "checked") && (take ?? 0) > 0 && (
                              <Link href={r.href} className="text-xs text-esn hover:underline">
                                Book →
                              </Link>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="px-3 py-2 text-xs text-gray-500">ESNcards: internal / external. Difference: counted after − (before + what the cards sold should have brought), if all were paid in cash.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ESNcard prices</CardTitle>
          </CardHeader>
          <CardContent>
            <EsncardPrices internal={price("esncard_price_internal_cents")} external={price("esncard_price_external_cents")} disabled={!canAct} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
