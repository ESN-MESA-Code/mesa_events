import type { Metadata } from "next";
import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatCents, formatDateTime, formatShortDate, berlinDate, daysSpanned, nowMs } from "@/lib/dates";
import { kindsFor, receiptsStatus, type ClaimStatus, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { ClaimItem } from "@/components/ClaimItem";
import { ClaimStatusBadge } from "@/components/status";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { withdrawReceipt } from "@/app/actions/handin";
import { PhotoUploader, PreapprovalForm, ReceiptForm } from "./HandInClient";

export const metadata: Metadata = { title: "Hand-in" };


// After the event: photos (to Drive), the attendance list closed, every
// receipt registered and the paper Beleg handed to Finance.
export default async function HandInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, supabase, viewer, isStaff, isTeam, myAssignment } = await loadEventForPage(id);
  if (!isStaff && !isTeam) {
    return (
      <Card>
        <EmptyState>The hand-in is for the event&apos;s OC and helpers.</EmptyState>
      </Card>
    );
  }

  const [{ data: list }, { data: photos }, { data: claims }, { data: summary }, { data: policyId }, { data: preapprovals }, { data: budget }] = await Promise.all([
    supabase.from("attendance_lists").select("signed_off_at, headcount").eq("event_id", id).maybeSingle(),
    supabase.from("event_photos").select("id, file_name, status, drive_url, uploaded_by, created_at").eq("event_id", id).order("created_at"),
    supabase
      .from("reimbursements")
      .select("id, status, suggested_cents, approved_cents, flags, payout_method, rejected_reason, checked_at, paid_at, receipts(expense_kind, vendor, amount_cents, purchased_on, beleg_received_at)")
      .eq("event_id", id)
      .eq("claimant_id", viewer.id)
      .order("created_at"),
    supabase.rpc("event_claims_summary", { event: id }),
    supabase.rpc("policy_for", { day: berlinDate(event.starts_at) }),
    supabase.from("preapprovals").select("id, description, estimated_cents, status, note").eq("event_id", id).eq("requester_id", viewer.id),
    supabase.from("trip_budgets").select("amount_cents").eq("event_id", id).maybeSingle(),
  ]);
  const { data: rules } = policyId ? await supabase.from("reimbursement_rules").select("*").eq("policy_id", policyId as string) : { data: [] };
  const eventType = event.type as Exclude<Rule["event_type"], "any">;
  const kinds = kindsFor((rules ?? []) as Rule[], eventType);
  const s = (summary ?? {}) as { receipts?: number; belege_missing?: number };
  const started = Date.parse(event.starts_at) <= nowMs();
  // Receipts and photos from the day of the event on (Berlin).
  const handInOpen = berlinDate(new Date(nowMs()).toISOString()) >= berlinDate(event.starts_at);

  return (
    <div className="space-y-6">
      <Card id="hand-in-status" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Hand-in status</CardTitle>
          {!handInOpen && <Badge>Opens on {formatShortDate(event.starts_at)}</Badge>}
        </CardHeader>
        <CardContent className="text-sm grid gap-2 sm:grid-cols-3" data-testid="handin-status">
          <p>
            {list?.signed_off_at ? "✅" : "⬜"} Attendance list{" "}
            {list?.signed_off_at ? (
              `signed off (${list.headcount} counted)`
            ) : started ? (
              <Link href={`/events/${id}/attendance`} className="text-esn hover:underline">
                not signed off yet
              </Link>
            ) : (
              <span className="text-gray-500">– on the day</span>
            )}
          </p>
          <p>
            {(photos ?? []).length ? "✅" : "⬜"} Photos: {(photos ?? []).length}
          </p>
          <p data-testid="receipts-status">
            {s.receipts && !s.belege_missing ? "✅" : "⬜"}{" "}
            {receiptsStatus({
              mine: (claims ?? []).length,
              myMissing: (claims ?? []).filter((c) => c.status === "not_submitted").length,
              all: s.receipts ?? 0,
              allMissing: s.belege_missing ?? 0,
              onTeam: !!myAssignment,
            })}
          </p>
        </CardContent>
      </Card>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <Alert tone="info">
          The paper receipt (<strong>Beleg</strong>) is mandatory: register each receipt here, then hand the paper Beleg to Finance. Claims are paid
          monthly; above €100 Finance can pay earlier.
        </Alert>

        {myAssignment && (
          <Card id="register-receipt" className="scroll-mt-4">
            <CardHeader>
              <CardTitle>Register a receipt</CardTitle>
            </CardHeader>
            <CardContent>
              {!handInOpen ? (
                <p className="text-sm text-gray-500" data-testid="receipts-later">
                  Hand-in opens on the day of the event ({formatShortDate(event.starts_at)}). Keep every paper Beleg until then.
                </p>
              ) : kinds.length ? (
                <ReceiptForm
                  eventId={id}
                  role={myAssignment.role as "oc" | "helper"}
                  eventType={eventType}
                  rules={(rules ?? []) as Rule[]}
                  kinds={kinds}
                  tripDays={daysSpanned(event.starts_at, event.ends_at)}
                  hasTripBudget={!!budget}
                  preapprovals={(preapprovals ?? []).filter((p) => p.status === "approved").map((p) => ({ id: p.id, label: `${p.description} (${formatCents(p.estimated_cents)})` }))}
                  defaultDate={berlinDate(event.starts_at)}
                />
              ) : (
                <EmptyState>No reimbursement rules apply to this event.</EmptyState>
              )}
            </CardContent>
          </Card>
        )}

        <Card id="your-receipts" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Your receipts</CardTitle>
          </CardHeader>
          <CardContent>
            {!claims?.length && <EmptyState>No receipts registered yet.</EmptyState>}
            <ul className="divide-y divide-gray-100 text-sm" data-testid="my-claims">
              {(claims ?? []).map((c) => {
                const r = c.receipts as { expense_kind: ExpenseKind; vendor: string; amount_cents: number; purchased_on: string; beleg_received_at: string | null } | null;
                return (
                  <li key={c.id} className="py-3">
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
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <ClaimStatusBadge status={c.status as ClaimStatus} />
                        {!c.payout_method && (
                          <Link href="/me#claims" className="text-amber-800 underline">
                            ⚠️ Add bank or PayPal details
                          </Link>
                        )}
                        {c.status === "not_submitted" && (
                          <ActionButton action={withdrawReceipt} input={{ claim_id: c.id }} variant="ghost" confirm="Withdraw this receipt?">
                            Withdraw
                          </ActionButton>
                        )}
                      </div>
                    </ClaimItem>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {myAssignment && event.type === "weekend_trip" && (
          <Card>
            <CardHeader>
              <CardTitle>Pre-approval for further expenses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600">Attractions and museums on weekend trips are reimbursed only with the Treasurer&apos;s approval before you buy.</p>
              <PreapprovalForm eventId={id} />
              <ul className="text-sm space-y-1">
                {(preapprovals ?? []).map((p) => (
                  <li key={p.id}>
                    {p.description} ({formatCents(p.estimated_cents)}) –{" "}
                    <Badge tone={p.status === "approved" ? "green" : p.status === "rejected" ? "red" : "gray"}>{p.status}</Badge>
                    {p.note && <span className="text-xs text-gray-500"> {p.note}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isStaff && (handInOpen ? <PhotoUploader eventId={id} /> : <p className="text-sm text-gray-500">Photos can be handed in from the day of the event.</p>)}
            <ul className="text-sm space-y-1" data-testid="photos">
              {(photos ?? []).map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="truncate">{p.file_name}</span>
                  {p.status === "uploaded" && p.drive_url ? (
                    <a href={p.drive_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-esn hover:underline">
                      in Drive
                    </a>
                  ) : (
                    <span className="ml-auto text-xs text-gray-500">uploading to Drive…</span>
                  )}
                </li>
              ))}
            </ul>
            {(photos ?? []).length > 0 && <p className="text-xs text-gray-500">Last upload {formatDateTime(photos!.at(-1)!.created_at)}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
    </div>
  );
}
