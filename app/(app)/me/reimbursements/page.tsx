import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatCents, formatDateTime, formatShortDate } from "@/lib/dates";
import { maskEmail, maskIban, type ClaimStatus, type ExpenseKind } from "@/lib/reimbursement";
import { plural } from "@/lib/plural";
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ClaimStatusBadge } from "@/components/status";
import { ClaimItem } from "@/components/ClaimItem";
import { MyPayoutForm } from "./MyPayoutForm";
import { PayoutDetailsForm } from "./PayoutDetailsForm";

export const metadata: Metadata = { title: "Reimbursements" };

type Ev = { id: string; title: string; starts_at: string };
type Receipt = { expense_kind: ExpenseKind; vendor: string; amount_cents: number; purchased_on: string; beleg_received_at: string | null };

// The member's reimbursements on their own page (round 2026-11-03 (2)):
// where Finance pays them (the profile's IBAN or PayPal, formerly
// /me/payout), the open claims by event, and the settled ones folded away.
// Receipts are registered on the event's Hand-in tab.
export default async function ReimbursementsPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const [{ data: claims }, { data: saved }] = await Promise.all([
    supabase
      .from("reimbursements")
      .select(
        "id, status, suggested_cents, approved_cents, flags, payout_method, checked_at, paid_at, rejected_reason, created_at, events(id, title, starts_at), receipts(expense_kind, vendor, amount_cents, purchased_on, beleg_received_at), payout_details(iban, paypal_email)"
      )
      .eq("claimant_id", viewer.id)
      .order("created_at"),
    supabase.from("profile_payout_details").select("account_holder, iban, paypal_email, updated_at").eq("profile_id", viewer.id).maybeSingle(),
  ]);
  const all = claims ?? [];
  const open = all.filter((c) => c.status !== "paid" && c.status !== "rejected");
  const settled = all.filter((c) => c.status === "paid" || c.status === "rejected").reverse();
  const missing = open.filter((c) => !c.payout_method).length;
  const paidCents = settled.reduce((sum, c) => sum + (c.status === "paid" ? (c.approved_cents ?? 0) : 0), 0);

  // Open claims grouped by event, newest event first.
  const byEvent = new Map<string, { event: Ev; claims: typeof open }>();
  for (const c of open) {
    const e = c.events as Ev | null;
    if (!e) continue;
    const g = byEvent.get(e.id) ?? { event: e, claims: [] };
    g.claims.push(c);
    byEvent.set(e.id, g);
  }
  const groups = [...byEvent.values()].sort((a, b) => b.event.starts_at.localeCompare(a.event.starts_at));

  return (
    <>
      <PageHeader title="Reimbursements" description="What you paid for MESA events, and where Finance pays you back. Register receipts on the event's Hand-in tab." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card data-testid="my-reimbursements">
            <CardHeader>
              <CardTitle>Open</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {!groups.length && <EmptyState>No open claims.</EmptyState>}
              {groups.map(({ event, claims: list }) => (
                <section key={event.id} aria-label={`Claims for ${event.title}`} className="space-y-3">
                  <h3 className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 pb-1">
                    <Link href={`/events/${event.id}/hand-in?from=reimbursements`} className="font-semibold text-gray-900 hover:text-esn">
                      {event.title}
                    </Link>
                    <span className="text-xs text-gray-500">{formatShortDate(event.starts_at)}</span>
                  </h3>
                  <ul className="divide-y divide-gray-100 [&>li]:py-3 [&>li:first-child]:pt-0">
                    {list.map((c) => {
                      const r = c.receipts as Receipt | null;
                      const d = c.payout_details as { iban: string | null; paypal_email: string | null } | null;
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
                            {/* Saved profile details reach every open claim; only a claim still without any says so. */}
                            {!d && (
                              <div className="space-y-1 text-xs" data-testid="payout-line">
                                <p className="text-amber-800">⚠️ No bank or PayPal details for this claim yet</p>
                                <PayoutDetailsForm claimId={c.id} hasDetails={false} />
                              </div>
                            )}
                          </ClaimItem>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </CardContent>
          </Card>

          {settled.length > 0 && (
            <Card>
              <details data-testid="my-settled">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 px-5 py-4">
                  <span className="text-base font-semibold text-gray-900">Paid and rejected</span>
                  <span className="text-sm text-gray-600">
                    {plural(settled.length, "claim")} · {formatCents(paidCents)} paid
                  </span>
                  <span className="ml-auto text-sm text-esn">Show</span>
                </summary>
                <CardContent>
                  <ul className="divide-y divide-gray-100 text-sm">
                    {settled.map((c) => {
                      const r = c.receipts as Receipt | null;
                      const e = c.events as Ev | null;
                      return (
                        <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2" data-testid={`settled-${r?.vendor ?? c.id}`}>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-gray-900">{r?.vendor}</span>
                            {e && (
                              <Link href={`/events/${e.id}/hand-in?from=reimbursements`} className="block text-xs text-gray-500 hover:text-esn">
                                {e.title} · {formatShortDate(e.starts_at)}
                              </Link>
                            )}
                            {c.rejected_reason && <span className="block text-xs text-red-700">Rejected: {c.rejected_reason}</span>}
                          </span>
                          {c.paid_at && <span className="text-xs text-gray-500">{formatShortDate(c.paid_at)}</span>}
                          <span className="w-20 text-right tabular-nums">{c.status === "paid" ? formatCents(c.approved_cents) : "–"}</span>
                          <ClaimStatusBadge status={c.status as ClaimStatus} />
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </details>
            </Card>
          )}
        </div>

        <Card id="payout" className="self-start scroll-mt-20">
          <CardHeader>
            <CardTitle>Payout details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {saved ? (
              <p data-testid="saved-payout">
                {saved.iban ? (
                  <>
                    🏦 Bank transfer to <strong>{maskIban(saved.iban)}</strong> ({saved.account_holder})
                  </>
                ) : (
                  <>
                    💙 PayPal <strong>{maskEmail(saved.paypal_email ?? "")}</strong>
                  </>
                )}
                <span className="block text-xs text-gray-500">updated {formatDateTime(saved.updated_at)}</span>
              </p>
            ) : (
              <Alert tone="warning" data-testid="payout-missing">
                No IBAN or PayPal yet – Finance cannot pay your reimbursements{missing ? ` (${missing} open)` : ""} until you add one.
              </Alert>
            )}
            <MyPayoutForm saved={!!saved} />
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer text-esn">Who sees them, and when they are deleted</summary>
              <div className="mt-2 space-y-1.5">
                <p>Only you and the Finance team see them; Finance sees them on each of your claims.</p>
                <p>Saving copies them onto your claims that are not paid yet. A claim keeps its copy until it is paid – then it is deleted.</p>
                <p>Deleting removes them from your profile and from the claims Finance has not checked yet. Checked claims keep theirs until they are paid.</p>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
