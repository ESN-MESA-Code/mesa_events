import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatCents, formatDateTime, nowMs } from "@/lib/dates";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES } from "@/lib/labels";
import { STATUS_LABELS, maskIban, type ClaimStatus } from "@/lib/reimbursement";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { PayoutDetailsForm } from "./PayoutDetailsForm";

export const metadata: Metadata = { title: "My events" };

type MyEvent = { id: string; role: string; event: { id: string; title: string; starts_at: string; status: keyof typeof EVENT_STATUS_LABELS } };

function EventList({ list }: { list: MyEvent[] }) {
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {list.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="w-40 tabular-nums text-gray-600">{formatDateTime(a.event.starts_at)}</span>
          <Link href={`/events/${a.event.id}`} className="font-medium text-gray-900 hover:text-esn">
            {a.event.title}
          </Link>
          <Badge tone="blue">{a.role === "oc" ? "OC" : "Helper"}</Badge>
          <Badge tone={EVENT_STATUS_TONES[a.event.status]} className="ml-auto">
            {EVENT_STATUS_LABELS[a.event.status]}
          </Badge>
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
      .select("id, status, suggested_cents, approved_cents, payout_method, events(id, title), receipts(vendor, amount_cents), payout_details(iban, paypal_email)")
      .eq("claimant_id", viewer.id)
      .order("created_at", { ascending: false }),
  ]);
  const now = nowMs();
  const events = (assignments ?? [])
    .map((a) => ({ ...a, event: a.events as { id: string; title: string; starts_at: string; status: keyof typeof EVENT_STATUS_LABELS } }))
    .filter((a) => a.event)
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  const upcoming = events.filter((a) => Date.parse(a.event.starts_at) >= now - 86_400_000);
  const past = events.filter((a) => Date.parse(a.event.starts_at) < now - 86_400_000).reverse();


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
        <Card>
          <CardHeader>
            <CardTitle>My reimbursements</CardTitle>
          </CardHeader>
          <CardContent>
            {!claims?.length && <EmptyState>No receipts registered.</EmptyState>}
            <ul className="divide-y divide-gray-100 text-sm" data-testid="my-reimbursements">
              {(claims ?? []).map((c) => {
                const e = c.events as { id: string; title: string } | null;
                const r = c.receipts as { vendor: string; amount_cents: number } | null;
                const d = c.payout_details as { iban: string | null; paypal_email: string | null } | null;
                const settled = c.status === "paid" || c.status === "rejected";
                return (
                  <li key={c.id} className="py-2.5 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/events/${e?.id}/hand-in`} className="font-medium hover:text-esn">
                        {e?.title}
                      </Link>
                      <span className="text-gray-500">· {r?.vendor}</span>
                      <Badge className="ml-auto">{STATUS_LABELS[c.status as ClaimStatus]}</Badge>
                    </div>
                    <p className="text-xs text-gray-600">
                      Paid {formatCents(r?.amount_cents)} · {c.approved_cents !== null ? `approved ${formatCents(c.approved_cents)}` : `suggested ${formatCents(c.suggested_cents)}`}
                      {d?.iban && ` · to ${maskIban(d.iban)}`}
                      {d?.paypal_email && ` · PayPal ${d.paypal_email}`}
                    </p>
                    {!settled && <PayoutDetailsForm claimId={c.id} hasDetails={!!d} />}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-gray-500 mt-3">Bank and PayPal details are only seen by Finance and deleted once you are paid.</p>
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
