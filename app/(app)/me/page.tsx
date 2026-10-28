import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatDateTime, formatShortDate, nowMs } from "@/lib/dates";
import type { EventStatus } from "@/lib/labels";
import { maskIban, type ClaimStatus, type ExpenseKind } from "@/lib/reimbursement";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { EventStatusBadge } from "@/components/status";
import { ClaimItem } from "@/components/ClaimItem";
import { PayoutDetailsForm } from "./PayoutDetailsForm";

export const metadata: Metadata = { title: "My events" };

type MyEvent = { id: string; role: string; event: { id: string; title: string; starts_at: string; status: EventStatus } };

function EventList({ list }: { list: MyEvent[] }) {
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {list.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
          <span className="w-full sm:w-40 tabular-nums text-gray-600">{formatDateTime(a.event.starts_at)}</span>
          <Link href={`/events/${a.event.id}?from=me`} className="font-medium text-gray-900 hover:text-esn break-words">
            {a.event.title}
          </Link>
          <Badge tone="blue">{a.role === "oc" ? "OC" : "Helper"}</Badge>
          <EventStatusBadge status={a.event.status} className="ml-auto" />
        </li>
      ))}
    </ul>
  );
}

export default async function MePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const [{ data: assignments }, { data: claims }] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, role, status, events(id, title, starts_at, status)")
      .eq("profile_id", viewer.id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("reimbursements")
      .select(
        "id, status, suggested_cents, approved_cents, flags, payout_method, checked_at, paid_at, rejected_reason, created_at, events(id, title, starts_at), receipts(expense_kind, vendor, amount_cents, purchased_on, beleg_received_at), payout_details(iban, paypal_email)"
      )
      .eq("claimant_id", viewer.id)
      .order("created_at"),
  ]);
  const now = nowMs();
  const events = (assignments ?? [])
    .map((a) => ({ ...a, event: a.events as MyEvent["event"] }))
    .filter((a) => a.event)
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  const upcoming = events.filter((a) => Date.parse(a.event.starts_at) >= now - 86_400_000);
  const past = events.filter((a) => Date.parse(a.event.starts_at) < now - 86_400_000).reverse();

  // Claims grouped by event, newest event first.
  type Ev = { id: string; title: string; starts_at: string };
  const byEvent = new Map<string, { event: Ev; claims: NonNullable<typeof claims> }>();
  for (const c of claims ?? []) {
    const e = c.events as Ev | null;
    if (!e) continue;
    const g = byEvent.get(e.id) ?? { event: e, claims: [] };
    g.claims.push(c);
    byEvent.set(e.id, g);
  }
  const groups = [...byEvent.values()].sort((a, b) => b.event.starts_at.localeCompare(a.event.starts_at));

  return (
    <>
      <PageHeader title="My events" description="Where you are OC or helper, and your reimbursements." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
          </CardHeader>
          <CardContent data-testid="my-upcoming">{upcoming.length ? <EventList list={upcoming} /> : <EmptyState>Nothing planned – volunteer or claim an open slot.</EmptyState>}</CardContent>
        </Card>
        <Card id="claims">
          <CardHeader>
            <CardTitle>My reimbursements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5" data-testid="my-reimbursements">
            {!groups.length && <EmptyState>No receipts registered. Register them on the event&apos;s Hand-in tab.</EmptyState>}
            {groups.map(({ event, claims: list }) => (
              <section key={event.id} aria-label={`Claims for ${event.title}`} className="space-y-3">
                <h3 className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 pb-1">
                  <Link href={`/events/${event.id}/hand-in?from=me`} className="font-semibold text-gray-900 hover:text-esn">
                    {event.title}
                  </Link>
                  <span className="text-xs text-gray-500">{formatShortDate(event.starts_at)}</span>
                </h3>
                <ul className="space-y-4">
                  {list.map((c) => {
                    const r = c.receipts as { expense_kind: ExpenseKind; vendor: string; amount_cents: number; purchased_on: string; beleg_received_at: string | null } | null;
                    const d = c.payout_details as { iban: string | null; paypal_email: string | null } | null;
                    const settled = c.status === "paid" || c.status === "rejected";
                    return (
                      <li key={c.id}>
                        <ClaimItem
                          claim={{
                            id: c.id,
                            status: c.status as ClaimStatus,
                            kind: r?.expense_kind ?? null,
                            vendor: r?.vendor ?? "",
                            purchasedOn: r?.purchased_on ?? null,
                            receiptCents: r?.amount_cents ?? null,
                            suggestedCents: c.suggested_cents,
                            approvedCents: c.approved_cents,
                            flags: c.flags,
                            belegReceivedAt: r?.beleg_received_at ?? null,
                            checkedAt: c.checked_at,
                            paidAt: c.paid_at,
                            rejectedReason: c.rejected_reason,
                          }}
                        >
                          {!settled && (
                            <div className="text-xs text-gray-600 space-y-1">
                              <p>
                                {d?.iban ? `Paid to ${maskIban(d.iban)}` : d?.paypal_email ? `Paid to PayPal ${d.paypal_email}` : <span className="text-amber-800">⚠️ No bank or PayPal details yet</span>}
                              </p>
                              <PayoutDetailsForm claimId={c.id} hasDetails={!!d} />
                            </div>
                          )}
                        </ClaimItem>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <p className="text-xs text-gray-500">Bank and PayPal details are only seen by Finance and deleted once you are paid.</p>
          </CardContent>
        </Card>
        {past.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Past events</CardTitle>
            </CardHeader>
            <CardContent>
              <EventList list={past} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
