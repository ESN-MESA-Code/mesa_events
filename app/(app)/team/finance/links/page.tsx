import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, QrCode, ShoppingBag, Store } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatCents, formatDate } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { paypalMeUrl } from "@/lib/payments/links";
import { plural } from "@/lib/plural";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { Figure } from "@/components/finance/SemesterNav";
import { PaymentQr } from "@/components/finance/PaymentQr";
import { cn } from "@/lib/utils";
import { LinkActions, NewLinkForm, PaypalSettings } from "./LinksClient";

export const metadata: Metadata = { title: "PayPal links" };

type Show = "own" | "events" | "office";

// PayPal links (rework 2026-11-11 (4)). Office hours get their ESNcard QR
// codes when their cash box starts, and the OC makes an event's codes on its
// Cash tab – so Finance no longer prepares links per event here. This page
// is for Finance's own links (merch, memberships …) with their QR codes,
// the PayPal account, and an overview of every code the events and office
// hours made: what came in through each, switching one off.
export default async function LinksPage({ searchParams }: { searchParams: Promise<{ show?: string; off?: string; q?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const sp = await searchParams;
  const show: Show = sp.show === "events" || sp.show === "office" ? sp.show : "own";
  const withOff = sp.off === "1";
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
  const supabase = await createSessionClient();

  const [{ data: settings }, { data: links }, { data: cats }, { data: used }] = await Promise.all([
    supabase.from("app_settings").select("key, value").in("key", ["paypal_me_handle", "paypal_account_name"]),
    supabase
      .from("payment_links")
      .select("id, reference, title, amount_cents, category_id, event_id, internal_event_id, note, active, created_at, created_by, events(title, starts_at), internal_events(title, kind, starts_at)")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("finance_categories").select("id, name, active").eq("direction", "income").order("sort").order("name"),
    supabase.from("payments").select("link_id, gross_cents").eq("status", "booked").not("link_id", "is", null).limit(20000),
  ]);
  const setting = (k: string) => {
    const v = (settings ?? []).find((s) => s.key === k)?.value;
    return typeof v === "string" ? v : "";
  };
  const handle = setting("paypal_me_handle");
  const accountName = setting("paypal_account_name") || "ESN MESA";
  const income = new Map<string, { n: number; cents: number }>();
  for (const p of used ?? []) {
    const r = income.get(p.link_id!) ?? { n: 0, cents: 0 };
    r.n++;
    r.cents += p.gross_cents;
    income.set(p.link_id!, r);
  }
  const creators = [...new Set((links ?? []).map((l) => l.created_by).filter((e): e is string => !!e))];
  const { data: people } = creators.length ? await supabase.from("profiles").select("email, full_name").in("email", creators) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.email, p.full_name || p.email]));
  const activeCats = (cats ?? []).filter((c) => c.active);
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));

  const all = links ?? [];
  const kindOf = (l: (typeof all)[number]): Show => (l.event_id ? "events" : l.internal_event_id ? "office" : "own");
  const count = (k: Show) => all.filter((l) => kindOf(l) === k && l.active).length;
  const sumOf = (k: Show) => all.filter((l) => kindOf(l) === k).reduce((s, l) => s + (income.get(l.id)?.cents ?? 0), 0);
  const list = all
    .filter((l) => kindOf(l) === show && (withOff || l.active))
    .filter((l) => {
      if (!q) return true;
      const ev = (l.events ?? l.internal_events) as { title: string } | null;
      return [l.reference, l.title, ev?.title ?? "", l.created_by ?? ""].some((t) => t.toLowerCase().includes(q));
    });
  const href = (tab: Show) => {
    const p = new URLSearchParams({ ...(tab !== "own" ? { show: tab } : {}), ...(withOff ? { off: "1" } : {}) });
    return `/team/finance/links${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Finance" description="PayPal links and QR codes. Finance makes its own here (merch, memberships …); events and office hours make theirs on their Cash tab.">
        {!canAct && <Badge className="self-center">Read-only (executive)</Badge>}
      </PageHeader>
      <FinanceTabs current="links" />
      <div className="space-y-6">
        {!handle && <Alert tone="warning">Set MESA&apos;s PayPal.me name first – the links are built from it.</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="link-figures">
          <Figure label="Merch and other" value={plural(count("own"), "active link")} sub={`${formatCents(sumOf("own"))} paid through them`} href={href("own")} />
          <Figure label="Events" value={plural(count("events"), "active QR code")} sub={`${formatCents(sumOf("events"))} paid through them`} href={href("events")} />
          <Figure label="Office hours" value={plural(count("office"), "active QR code")} sub={`${formatCents(sumOf("office"))} paid through them`} href={href("office")} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>New link for merch and other sales</CardTitle>
            </CardHeader>
            <CardContent>{canAct ? <NewLinkForm categories={activeCats} disabled={!handle} /> : <p className="text-sm text-gray-500">Finance creates links.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Where QR codes come from</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ul className="space-y-3">
                <li className="flex gap-2.5">
                  <Store className="mt-0.5 h-4 w-4 shrink-0 text-esn" aria-hidden="true" />
                  <span>
                    <strong>Office hours</strong> get their two ESNcard codes (member, external) when the cash box is started, at the{" "}
                    <Link href="/team/finance/cash" className="text-esn hover:underline">
                      current prices
                    </Link>
                    ; they show while the box runs.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-esn" aria-hidden="true" />
                  <span>
                    <strong>Events</strong>: the OC or a helper makes them on the event&apos;s Cash tab – drinks, tickets, anything – with their own amounts.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-esn" aria-hidden="true" />
                  <span>
                    <strong>Merch and other sales</strong> are Finance&apos;s, made here.
                  </span>
                </li>
              </ul>
              <p className="text-xs text-gray-500">The payer writes the reference in the PayPal note; the import then books the payment to its event and category.</p>
              <div className="border-t border-gray-100 pt-4">
                <p className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                  <QrCode className="h-4 w-4 text-esn" aria-hidden="true" /> PayPal account
                </p>
                {canAct ? (
                  <PaypalSettings handle={handle} accountName={setting("paypal_account_name")} />
                ) : (
                  <p className="text-gray-600">
                    paypal.me/{handle || "–"} · {accountName}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4">
            {(
              [
                ["own", "Merch and other"],
                ["events", "Events"],
                ["office", "Office hours"],
              ] as Array<[Show, string]>
            ).map(([tab, label]) => (
              <Link
                key={tab}
                href={href(tab)}
                aria-current={show === tab ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", show === tab ? "border-esn bg-esn text-white" : "border-gray-200 text-gray-700 hover:border-esn hover:text-esn")}
              >
                {label}
              </Link>
            ))}
            <form action="/team/finance/links" className="ml-auto flex flex-wrap items-center gap-3">
              {show !== "own" && <input type="hidden" name="show" value={show} />}
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" name="off" value="1" defaultChecked={withOff} /> switched off too
              </label>
              <input name="q" defaultValue={q} placeholder="Search reference, event…" aria-label="Search links" className="h-9 w-48 rounded-md border border-gray-300 px-3 text-sm" />
              <button className="h-9 rounded-md border border-gray-300 px-3 text-sm hover:border-esn hover:text-esn">Filter</button>
            </form>
          </div>
          {!list.length ? (
            <EmptyState>
              {show === "own" ? "No links for merch or other sales yet." : show === "events" ? "No event has made a QR code yet." : "No office hour has started its cash box with QR codes yet."}
            </EmptyState>
          ) : show === "own" ? (
            <ul className="grid gap-px bg-gray-100 sm:grid-cols-2 xl:grid-cols-3" data-testid="links">
              {list.map((l) => {
                const got = income.get(l.id);
                return (
                  <li key={l.id} className={cn("space-y-3 bg-white p-4", !l.active && "opacity-60")} data-testid={`link-${l.reference}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">{l.title}</p>
                        <p className="text-xs text-gray-500">{catName.get(l.category_id)}</p>
                      </div>
                      <span className="text-lg font-bold tabular-nums text-esn">{l.amount_cents ? formatCents(l.amount_cents) : "open"}</span>
                    </div>
                    {handle ? (
                      <PaymentQr compact link={{ reference: l.reference, title: l.title, amount: l.amount_cents, url: paypalMeUrl(handle, l.amount_cents), accountName, context: null }} size={112} />
                    ) : (
                      <p className="font-mono font-bold">{l.reference}</p>
                    )}
                    {l.note && <p className="text-xs text-gray-600">{l.note}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2">
                      <span className="text-xs text-gray-600" data-testid="link-income">
                        {got ? `${plural(got.n, "payment")} · ${formatCents(got.cents)}` : "No payments yet"}
                        {!l.active && " · switched off"}
                      </span>
                      {canAct && <LinkActions link={{ id: l.id, title: l.title, amount: l.amount_cents, categoryId: l.category_id, active: l.active, note: l.note, used: !!got }} categories={activeCats} editable />}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="links">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2">{show === "events" ? "Event" : "Office hour"}</th>
                    <th className="px-4 py-2">QR code</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Made by</th>
                    <th className="px-4 py-2 text-right">Paid</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {list.map((l) => {
                    const ev = (l.events ?? l.internal_events) as { title: string; starts_at: string; kind?: string } | null;
                    const got = income.get(l.id);
                    const target = l.event_id ? `/events/${l.event_id}/cash` : `/office-hours/${l.internal_event_id}`;
                    return (
                      <tr key={l.id} className={cn(!l.active && "text-gray-400")} data-testid={`link-${l.reference}`}>
                        <td className="px-4 py-2">
                          <Link href={target} className="font-medium hover:text-esn">
                            {ev ? (ev.kind === "office_hour" ? "Office hour" : ev.title) : "–"}
                          </Link>
                          {ev && <span className="block text-xs text-gray-500">{formatDate(ev.starts_at)}</span>}
                        </td>
                        <td className="px-4 py-2">
                          <span className="block">{l.title}</span>
                          <span className="font-mono text-xs text-gray-500">{l.reference}</span>
                          {!l.active && <span className="text-xs"> · off</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{l.amount_cents ? formatCents(l.amount_cents) : "open"}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{l.created_by ? (nameOf.get(l.created_by) ?? l.created_by) : "–"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{got ? `${formatCents(got.cents)} (${got.n})` : "–"}</td>
                        <td className="px-4 py-2 text-right">
                          {canAct && <LinkActions link={{ id: l.id, title: l.title, amount: l.amount_cents, categoryId: l.category_id, active: l.active, note: l.note, used: !!got }} categories={activeCats} editable={false} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
