import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, formatDate, nowMs } from "@/lib/dates";
import { addDays } from "@/lib/month";
import { hasRole } from "@/lib/roles";
import { INTERNAL_KIND_LABELS, type InternalKind } from "@/lib/internal";
import { Badge, Card, PageHeader } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";
import { cn } from "@/lib/utils";
import { InboxList, type InboxPayment, type Option } from "./InboxClient";

export const metadata: Metadata = { title: "Payments to label" };

type Show = "open" | "booked" | "ignored";

// Finance's queue (round 2026-11-11): imported PayPal payments the import
// could not book by itself – no reference, a reference with money going
// out, an unknown pretix event … – each with what the import suggests.
// Finance confirms the suggestion, picks a category (and event) for one or
// many, or ignores them (transfers, private mistakes). Booked and ignored
// payments can be looked up and undone.
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  const viewer = await requirePageRole(["finance"], { executiveMayRead: true, page: "Finance" });
  const canAct = hasRole(viewer.roles, "finance");
  const sp = await searchParams;
  const show: Show = sp.show === "booked" || sp.show === "ignored" ? sp.show : "open";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const supabase = await createSessionClient();
  const today = berlinDate(new Date(nowMs()).toISOString());

  let query = supabase
    .from("payments")
    .select(
      "id, external_id, booked_on, type, name, email, gross_cents, fee_cents, subject, note, invoice, status, suggestion, suggested_link_id, suggested_category_id, suggested_event_id, suggested_internal_event_id, matched_by, ignore_reason, decided_by, finance_entries(category_id, event_id, internal_event_id, is_fee, description)"
    )
    .eq("status", show)
    .order("booked_on", { ascending: show !== "open" ? false : true })
    .limit(show === "open" ? 500 : 300);
  if (q) query = query.or(["name", "email", "subject", "note", "external_id"].map((c) => `${c}.ilike.%${q.replace(/[%,()]/g, " ")}%`).join(","));
  const [{ data: payments }, { data: counts }, { data: cats }, { data: links }] = await Promise.all([
    query,
    supabase.from("payments").select("status").limit(10000),
    supabase.from("finance_categories").select("id, name, direction, active").order("sort").order("name"),
    supabase.from("payment_links").select("id, reference, title, amount_cents, category_id, event_id, internal_event_id, active").order("created_at", { ascending: false }),
  ]);
  const days = (payments ?? []).map((p) => p.booked_on).sort();
  const from = addDays(days[0] ?? today, -60);
  const to = addDays(days[days.length - 1] ?? today, 60);
  const [{ data: events }, { data: internals }] = await Promise.all([
    supabase.from("events").select("id, title, starts_at").not("status", "in", "(draft,dropped)").gte("starts_at", `${from}T00:00:00Z`).lte("starts_at", `${to}T23:59:59Z`).order("starts_at"),
    supabase.from("internal_events").select("id, title, kind, starts_at").in("kind", ["office_hour", "stammtisch", "internal"]).gte("starts_at", `${from}T00:00:00Z`).lte("starts_at", `${to}T23:59:59Z`).order("starts_at"),
  ]);

  const tally = { open: 0, booked: 0, ignored: 0 } as Record<Show, number>;
  for (const c of counts ?? []) tally[c.status as Show] = (tally[c.status as Show] ?? 0) + 1;
  const eventOptions: Option[] = (events ?? []).map((e) => ({ id: e.id, label: `${formatDate(e.starts_at)} · ${e.title}`, day: berlinDate(e.starts_at) }));
  const internalOptions: Option[] = (internals ?? []).map((e) => ({ id: e.id, label: `${formatDate(e.starts_at)} · ${INTERNAL_KIND_LABELS[e.kind as InternalKind]}${e.title && e.kind !== "office_hour" ? `: ${e.title}` : ""}`, day: berlinDate(e.starts_at) }));
  const titleOf = new Map([...eventOptions, ...internalOptions].map((o) => [o.id, o.label]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));

  const rows: InboxPayment[] = (payments ?? []).map((p) => {
    const main = ((p.finance_entries ?? []) as Array<{ category_id: string; event_id: string | null; internal_event_id: string | null; is_fee: boolean; description: string }>).find((e) => !e.is_fee);
    return {
      id: p.id,
      externalId: p.external_id,
      day: p.booked_on,
      type: p.type,
      name: p.name,
      email: p.email,
      gross: p.gross_cents,
      fee: p.fee_cents,
      text: [p.subject, p.note, p.invoice].filter(Boolean).join(" · "),
      status: p.status as Show,
      suggestion: p.suggestion,
      suggested: {
        linkId: p.suggested_link_id,
        categoryId: p.suggested_category_id,
        eventId: p.suggested_event_id,
        internalEventId: p.suggested_internal_event_id,
      },
      booked: main
        ? {
            category: catName.get(main.category_id) ?? "?",
            target: main.event_id ? (titleOf.get(main.event_id) ?? "an event") : main.internal_event_id ? (titleOf.get(main.internal_event_id) ?? "an office hour") : null,
            description: main.description,
            by: p.matched_by,
          }
        : null,
      ignoreReason: p.ignore_reason,
    };
  });

  const href = (s: Show) => `/team/finance/inbox${s === "open" ? "" : `?show=${s}`}`;
  return (
    <>
      <PageHeader title="Finance" description="Imported payments the import could not book by itself. Confirm the suggestion, label them, or ignore transfers.">
        {!canAct && <Badge className="self-center" data-testid="read-only">Read-only (executive)</Badge>}
      </PageHeader>
      <FinanceTabs current="inbox" />
      <Card className="overflow-hidden" data-testid="inbox">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-4">
          {(["open", "booked", "ignored"] as Show[]).map((tab) => (
            <Link
              key={tab}
              href={href(tab)}
              aria-current={show === tab ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium",
                show === tab ? "border-esn bg-esn text-white" : "border-gray-200 bg-white text-gray-700 hover:border-esn hover:text-esn"
              )}
              data-testid={`inbox-show-${tab}`}
            >
              {tab === "open" ? "To label" : tab === "booked" ? "Booked" : "Ignored"}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", show === tab ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{tally[tab]}</span>
            </Link>
          ))}
          <form className="ml-auto" action="/team/finance/inbox">
            {show !== "open" && <input type="hidden" name="show" value={show} />}
            <input name="q" defaultValue={q} placeholder="Search name, email, note…" aria-label="Search payments" className="h-9 w-56 rounded-md border border-gray-300 px-3 text-sm" />
          </form>
        </div>
        <InboxList
          key={`${show}-${q}`}
          rows={rows}
          show={show}
          canAct={canAct}
          categories={(cats ?? []).map((c) => ({ id: c.id, name: c.name, direction: c.direction as "income" | "expense", active: c.active }))}
          events={eventOptions}
          internals={internalOptions}
          links={(links ?? []).map((l) => ({ id: l.id, label: `${l.reference} · ${l.title}`, categoryId: l.category_id, eventId: l.event_id, internalEventId: l.internal_event_id, amount: l.amount_cents, active: l.active }))}
          emptyHint={
            show === "open" ? (
              <>
                Nothing to label. New payments come with the next{" "}
                <Link href="/team/finance/import" className="text-esn hover:underline">
                  PayPal import
                </Link>
                .
              </>
            ) : (
              "Nothing here."
            )
          }
        />
      </Card>
    </>
  );
}
