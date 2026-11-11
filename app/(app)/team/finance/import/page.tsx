import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, formatCents, formatDate, formatDateTime, nowMs } from "@/lib/dates";
import { addDays } from "@/lib/month";
import { hasRole } from "@/lib/roles";
import { pretixApiConfig } from "@/lib/payments/pretix";
import { plural } from "@/lib/plural";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { BookPretix, LinkSlug, MatchAgain, PaypalImport, PretixCsvImport, PretixSync } from "./ImportClient";

export const metadata: Metadata = { title: "Import payments" };

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700 marker:font-semibold marker:text-esn">{children}</ol>;
}

// Imports (round 2026-11-11): PayPal's activity download (CSV) and pretix's
// orders (CSV export or API), each with a step-by-step guide; what pretix
// sold per event (and what still has to be booked); pretix events that are
// not linked to an event yet; the import history.
export default async function ImportPage() {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(nowMs()).toISOString());

  const [{ data: imports }, { data: events }, { data: orders }, { data: ticketCat }, { data: handle }] = await Promise.all([
    supabase.from("payment_imports").select("id, source, filename, period_from, period_to, rows_total, rows_new, rows_skipped, balance_cents, created_at, created_by").order("created_at", { ascending: false }).limit(15),
    supabase
      .from("events")
      .select("id, title, starts_at, pretix_slug")
      .eq("source", "platform")
      .not("status", "in", "(draft,dropped)")
      .gte("starts_at", `${addDays(today, -400)}T00:00:00Z`)
      .lte("starts_at", `${addDays(today, 120)}T00:00:00Z`)
      .order("starts_at", { ascending: false }),
    supabase.from("pretix_orders").select("event_slug, event_id, status, total_cents, provider, payment_id, finance_entry_id").limit(20000),
    supabase.from("finance_categories").select("id").eq("direction", "income").eq("name", "Event revenue").maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "paypal_me_handle").maybeSingle(),
  ]);
  const lastPaypal = (imports ?? []).find((i) => i.source === "paypal" && i.period_to);
  const eventOptions = (events ?? []).map((e) => ({ id: e.id, label: `${formatDate(e.starts_at)} · ${e.title}`, slug: e.pretix_slug }));
  const titleOf = new Map((events ?? []).map((e) => [e.id, e]));

  // pretix per event: paid orders, through PayPal (matched), booked, still to book.
  const per = new Map<string, { slug: string; eventId: string | null; paid: number; cents: number; viaPaypal: number; paypalMatched: number; booked: number; toBook: number; canceled: number }>();
  for (const o of orders ?? []) {
    const key = o.event_id ?? `slug:${o.event_slug.toLowerCase()}`;
    const r = per.get(key) ?? { slug: o.event_slug, eventId: o.event_id, paid: 0, cents: 0, viaPaypal: 0, paypalMatched: 0, booked: 0, toBook: 0, canceled: 0 };
    if (o.status === "paid" && o.total_cents > 0) {
      r.paid++;
      r.cents += o.total_cents;
      if (o.provider.includes("paypal")) {
        r.viaPaypal += o.total_cents;
        if (o.payment_id) r.paypalMatched += o.total_cents;
      } else if (o.finance_entry_id) r.booked += o.total_cents;
      else r.toBook += o.total_cents;
    } else if (o.status === "canceled") r.canceled++;
    per.set(key, r);
  }
  const pretixRows = [...per.values()].sort((a, b) => (titleOf.get(b.eventId ?? "")?.starts_at ?? "").localeCompare(titleOf.get(a.eventId ?? "")?.starts_at ?? ""));
  const unlinked = pretixRows.filter((r) => !r.eventId);
  const missingSlug = (events ?? []).filter((e) => !e.pretix_slug && e.starts_at < new Date(nowMs()).toISOString() && e.starts_at > `${addDays(today, -120)}`).length;
  const api = pretixApiConfig();

  return (
    <>
      <PageHeader title="Finance" description="Bring in what happened on PayPal and pretix. Payments with a reference book themselves; the rest goes to “To label”.">
        {!canAct && <Badge className="self-center">Read-only (executive)</Badge>}
      </PageHeader>
      <FinanceTabs current="import" />
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>PayPal</CardTitle>
              {lastPaypal && <Badge tone="gray">until {formatDate(lastPaypal.period_to!)}</Badge>}
            </CardHeader>
            <CardContent className="space-y-4">
              {canAct ? <PaypalImport lastTo={lastPaypal?.period_to ? formatDate(lastPaypal.period_to) : null} /> : <p className="text-sm text-gray-500">Finance imports.</p>}
              {canAct && <MatchAgain />}
            </CardContent>
          </Card>
          <Card id="paypal-guide">
            <CardHeader>
              <CardTitle>How to download it from PayPal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Steps>
                <li>
                  Sign in at <span className="font-medium">paypal.com</span> with MESA&apos;s PayPal account
                  {handle?.value ? (
                    <>
                      {" "}
                      (<span className="font-mono">paypal.me/{String(handle.value)}</span>)
                    </>
                  ) : null}
                  .
                </li>
                <li>
                  Open <span className="font-medium">Activity → Statements → Activity download</span> (German: <em>Aktivitäten → Kontoauszüge → Aktivitäten herunterladen</em>), or go straight to{" "}
                  <span className="font-mono text-xs">paypal.com/reports/dlog</span>.
                </li>
                <li>
                  Transaction type: <span className="font-medium">Balance affecting</span> (<em>Guthabenrelevant</em>) – that has every payment with its fee and the balance.
                </li>
                <li>
                  Format: <span className="font-medium">CSV</span>. Period: since the last import (an overlap does not matter – known transactions are skipped).
                </li>
                <li>
                  Under <span className="font-medium">Customise report fields</span>, keep <em>Transaction details</em> on, including <em>Note</em>, <em>Subject</em> and <em>Balance</em>; shopping cart details are not needed.
                </li>
                <li>Create the report; after a few minutes download it under “Your reports” and choose the file here.</li>
              </Steps>
              <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                What happens: payments whose note names a reference (<span className="font-mono">MESA-XXXXX</span> from a{" "}
                <Link href="/team/finance/links" className="text-esn hover:underline">
                  PayPal link
                </Link>
                ) or a pretix order are booked to their event and category, with the PayPal fee as its own line. Transfers to the bank account and PayPal holds are ignored. Everything else
                lands in{" "}
                <Link href="/team/finance/inbox" className="text-esn hover:underline">
                  To label
                </Link>
                , often with a suggestion. Pending payments and other currencies are left out – they come with a later download.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>pretix ticket sales</CardTitle>
              {api ? <Badge tone="green">API connected</Badge> : <Badge tone="gray">CSV</Badge>}
            </CardHeader>
            <CardContent className="space-y-5">
              {canAct && (
                <>
                  <div>
                    <p className="mb-2 text-sm font-medium">From the pretix API</p>
                    <PretixSync from={addDays(today, -90)} to={addDays(today, 30)} configured={!!api} />
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Or from a CSV export</p>
                    <PretixCsvImport events={eventOptions} />
                  </div>
                </>
              )}
              {unlinked.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="unlinked-pretix">
                  <p className="mb-2 text-sm font-medium text-amber-900">pretix events not linked to an event</p>
                  <ul className="space-y-2 text-sm">
                    {unlinked.map((r) => (
                      <li key={r.slug} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">{r.slug}</span>
                        <span className="text-xs text-gray-600">
                          {plural(r.paid, "paid order")} · {formatCents(r.cents)}
                        </span>
                        {canAct && <LinkSlug slug={r.slug} events={eventOptions} />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {missingSlug > 0 && (
                <p className="text-xs text-gray-500">
                  {plural(missingSlug, "past event")} of the last four months {missingSlug === 1 ? "has" : "have"} no pretix page linked (free events need none). Comms links the page when ticking it off on{" "}
                  <Link href="/team/comms/pretix?show=all" className="text-esn hover:underline">
                    pretix pages
                  </Link>
                  .
                </p>
              )}
              {!pretixRows.filter((r) => r.eventId).length ? (
                <EmptyState>No pretix orders imported yet.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="pretix-events">
                    <thead className="text-left text-xs uppercase text-gray-500">
                      <tr>
                        <th className="py-2 pr-3">Event</th>
                        <th className="py-2 pr-3 text-right">Paid</th>
                        <th className="py-2 pr-3 text-right">via PayPal</th>
                        <th className="py-2 pr-3 text-right">other</th>
                        <th className="py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pretixRows
                        .filter((r) => r.eventId)
                        .map((r) => {
                          const e = titleOf.get(r.eventId!);
                          return (
                            <tr key={r.eventId}>
                              <td className="py-2 pr-3">
                                <Link href={`/events/${r.eventId}`} className="font-medium hover:text-esn">
                                  {e?.title ?? r.slug}
                                </Link>
                                <span className="block text-xs text-gray-500">
                                  {e ? formatDate(e.starts_at) : ""} · {plural(r.paid, "order")}
                                  {r.canceled ? ` · ${r.canceled} cancelled` : ""}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{formatCents(r.cents)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {formatCents(r.viaPaypal)}
                                {r.viaPaypal > r.paypalMatched && <span className="block text-xs text-amber-700">{formatCents(r.viaPaypal - r.paypalMatched)} not in a PayPal import yet</span>}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {formatCents(r.booked + r.toBook)}
                                {r.booked > 0 && <span className="block text-xs text-emerald-700">booked</span>}
                              </td>
                              <td className="py-2 text-right">{canAct && r.toBook > 0 && ticketCat && <BookPretix eventId={r.eventId!} categoryId={ticketCat.id} cents={r.toBook} />}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card id="pretix-guide">
            <CardHeader>
              <CardTitle>How pretix sales reach their events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="mb-1 font-medium">1 · Comms links every pretix page</p>
                <p className="text-gray-700">
                  When Comms ticks off an event&apos;s pretix page, the link is required now (<span className="font-mono text-xs">https://pretix.eu/&lt;organizer&gt;/&lt;event&gt;/</span>). Its last part, the pretix
                  event&apos;s short name, ties orders to the event.
                </p>
              </div>
              <div>
                <p className="mb-1 font-medium">2a · CSV export</p>
                <Steps>
                  <li>
                    In pretix, open the organizer (all events) → <span className="font-medium">Export</span>, or one event → <span className="font-medium">Orders → Export</span>.
                  </li>
                  <li>
                    Choose <span className="font-medium">Order data</span>, format <span className="font-medium">CSV (with commas)</span>, and the events (all of them is fine).
                  </li>
                  <li>Download the file and choose it here. For a one-event export, say which event it is.</li>
                </Steps>
              </div>
              <div>
                <p className="mb-1 font-medium">2b · API (automatic)</p>
                <Steps>
                  <li>
                    In pretix: organizer → <span className="font-medium">Teams</span> → a team with “Can view orders” for all events → <span className="font-medium">API tokens</span> → create one.
                  </li>
                  <li>
                    The admin sets <span className="font-mono text-xs">PRETIX_ORGANIZER</span> (the organizer&apos;s short name) and <span className="font-mono text-xs">PRETIX_API_TOKEN</span> in the server&apos;s environment
                    (<span className="font-mono text-xs">PRETIX_URL</span> only when pretix is not pretix.eu).
                  </li>
                  <li>“Fetch from pretix” then reads the orders of every linked event in the period.</li>
                </Steps>
              </div>
              <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                Orders paid with PayPal are booked when the PayPal import finds their order code. Orders paid otherwise (bank transfer, card) are booked per event with “Book”. Import pretix first, then PayPal –
                or press “Match open payments again” afterwards.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Import history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!imports?.length ? (
              <EmptyState>Nothing imported yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm" data-testid="imports">
                {imports.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                    <Badge tone={i.source === "paypal" ? "blue" : "purple"}>{i.source === "paypal" ? "PayPal" : i.source === "pretix_api" ? "pretix API" : "pretix CSV"}</Badge>
                    <span className="min-w-0 flex-1 truncate">{i.filename || "–"}</span>
                    <span className="text-gray-600">
                      {i.period_from && i.period_to ? `${formatDate(i.period_from)} – ${formatDate(i.period_to)} · ` : ""}
                      {i.rows_new} new of {i.rows_total}
                      {i.rows_skipped ? ` · ${i.rows_skipped} left out` : ""}
                      {i.balance_cents !== null ? ` · balance ${formatCents(i.balance_cents)}` : ""}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDateTime(i.created_at)} · {i.created_by}
                    </span>
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
