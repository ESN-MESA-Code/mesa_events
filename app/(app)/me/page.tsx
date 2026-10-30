import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatDateTime, formatShortDate, nowMs } from "@/lib/dates";
import type { EventStatus } from "@/lib/labels";
import { maskEmail, maskIban, payoutLine, type ClaimStatus, type ExpenseKind } from "@/lib/reimbursement";
import { nextStep } from "@/lib/checklist";
import { checklistInput } from "@/lib/eventStatus";
import { groupEvents, handInState, type HandInState } from "@/lib/myEvents";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { EventStatusBadge } from "@/components/status";
import { ClaimItem } from "@/components/ClaimItem";
import { PayoutDetailsForm } from "./PayoutDetailsForm";

export const metadata: Metadata = { title: "My events" };

type MyEvent = {
  id: string;
  role: string;
  event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    status: EventStatus;
    helpers_needed: number;
    chat_space_name: string | null;
    chat_space_requested_at: string | null;
    planning_cycles: { description_deadline: string | null } | null;
  };
  handIn?: HandInState;
};

function EventList({ list, testId }: { list: MyEvent[]; testId: string }) {
  return (
    <ul className="divide-y divide-gray-100 text-sm" data-testid={testId}>
      {list.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
          <span className="w-full sm:w-40 tabular-nums text-gray-600">{formatDateTime(a.event.starts_at)}</span>
          <Link href={`/events/${a.event.id}${a.handIn?.label === "Hand-in open" ? "/hand-in" : ""}?from=me`} className="font-medium text-gray-900 hover:text-esn break-words">
            {a.event.title}
          </Link>
          <Badge tone="blue">{a.role === "oc" ? "OC" : "Helper"}</Badge>
          {a.handIn ? (
            <Badge tone={a.handIn.tone} className="ml-auto">
              {a.handIn.label}
            </Badge>
          ) : (
            <EventStatusBadge status={a.event.status} className="ml-auto" />
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function MePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const [{ data: assignments }, { data: claims }, { data: payout }] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, role, status, events(id, title, starts_at, ends_at, status, helpers_needed, chat_space_name, chat_space_requested_at, planning_cycles(description_deadline))")
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
    supabase.from("profile_payout_details").select("iban, paypal_email").eq("profile_id", viewer.id).maybeSingle(),
  ]);
  const now = nowMs();
  const events: MyEvent[] = (assignments ?? [])
    .map((a) => ({ id: a.id, role: a.role, event: a.events as unknown as MyEvent["event"] }))
    .filter((a) => a.event && !["draft"].includes(a.event.status));
  const byTime = groupEvents(events, (a) => a.event, now);
  // Past events are labelled by their hand-in: is something still mine to do?
  const past = await Promise.all(
    byTime.past.map(async (a) => {
      const input = await checklistInput(supabase, a.event, a.event.planning_cycles?.description_deadline ?? null);
      return { ...a, handIn: handInState(a.event.status, nextStep(input, a.role as "oc" | "helper")) };
    })
  );

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
        <div className="space-y-6">
          {byTime.today.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Today</CardTitle>
              </CardHeader>
              <CardContent>
                <EventList list={byTime.today} testId="my-today" />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Coming up</CardTitle>
            </CardHeader>
            <CardContent data-testid="my-upcoming">
              {byTime.upcoming.length ? <EventList list={byTime.upcoming} testId="my-upcoming-list" /> : <EmptyState>Nothing planned – volunteer or claim an open slot.</EmptyState>}
            </CardContent>
          </Card>
        </div>
        <Card id="claims">
          <CardHeader>
            <CardTitle>My reimbursements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5" data-testid="my-reimbursements">
            {payout ? (
              <p className="text-sm text-gray-600" data-testid="profile-payout">
                Paid to {payout.iban ? `your bank account ${maskIban(payout.iban)}` : `your PayPal ${maskEmail(payout.paypal_email ?? "")}`} ·{" "}
                <Link href="/me/payout" className="text-esn hover:underline">
                  change
                </Link>
              </p>
            ) : (
              <Alert tone="warning" data-testid="profile-payout-missing">
                No IBAN or PayPal on your profile – Finance cannot pay your reimbursements.{" "}
                <Link href="/me/payout" className="font-medium underline">
                  Add payout details
                </Link>
              </Alert>
            )}
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
                          {!settled ? (
                            <div className="text-xs text-gray-600 space-y-1">
                              <p data-testid="payout-line">
                                {payoutLine({ status: c.status as ClaimStatus, payoutMethod: c.payout_method, iban: d?.iban ?? null, paypalEmail: d?.paypal_email ?? null }) ?? (
                                  <span className="text-amber-800">⚠️ No bank or PayPal details yet</span>
                                )}
                              </p>
                              <PayoutDetailsForm claimId={c.id} hasDetails={!!d} />
                            </div>
                          ) : (
                            c.status === "paid" && (
                              <p className="text-xs text-gray-600" data-testid="payout-line">
                                {payoutLine({ status: "paid", payoutMethod: c.payout_method, iban: null, paypalEmail: null })}
                              </p>
                            )
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
              <EventList list={past} testId="my-past" />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
