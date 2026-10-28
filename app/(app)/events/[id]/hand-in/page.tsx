import type { Metadata } from "next";
import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatCents, formatDateTime, berlinDate, daysSpanned, nowMs } from "@/lib/dates";
import { STATUS_LABELS, EXPENSE_KIND_LABELS, kindsFor, type ClaimStatus, type ExpenseKind, type Rule } from "@/lib/reimbursement";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { withdrawReceipt } from "@/app/actions/handin";
import { PhotoUploader, PreapprovalForm, ReceiptForm } from "./HandInClient";

export const metadata: Metadata = { title: "Hand-in" };

const TONE: Record<ClaimStatus, "gray" | "blue" | "green" | "red" | "purple"> = {
  not_submitted: "gray",
  beleg_received: "blue",
  checked: "green",
  paid: "purple",
  rejected: "red",
};

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
      .select("id, status, suggested_cents, approved_cents, flags, payout_method, rejected_reason, receipts(expense_kind, vendor, amount_cents, purchased_on)")
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <Alert tone="info">
          The paper receipt (<strong>Beleg</strong>) is mandatory: register each receipt here, then hand the paper Beleg to Finance. Claims are paid
          monthly; above €100 Finance can pay earlier.
        </Alert>

        {myAssignment && (
          <Card>
            <CardHeader>
              <CardTitle>Register a receipt</CardTitle>
            </CardHeader>
            <CardContent>
              {kinds.length ? (
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

        <Card>
          <CardHeader>
            <CardTitle>Your receipts</CardTitle>
          </CardHeader>
          <CardContent>
            {!claims?.length && <EmptyState>No receipts registered yet.</EmptyState>}
            <ul className="divide-y divide-gray-100 text-sm" data-testid="my-claims">
              {(claims ?? []).map((c) => {
                const r = c.receipts as { expense_kind: ExpenseKind; vendor: string; amount_cents: number; purchased_on: string } | null;
                return (
                  <li key={c.id} className="py-2.5 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r?.vendor}</span>
                      <span className="text-gray-500">{r ? EXPENSE_KIND_LABELS[r.expense_kind].split(" (")[0] : ""}</span>
                      <Badge tone={TONE[c.status as ClaimStatus]} className="ml-auto">
                        {STATUS_LABELS[c.status as ClaimStatus]}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600">
                      Paid {formatCents(r?.amount_cents)} on {r?.purchased_on} · suggested {formatCents(c.suggested_cents)}
                      {c.approved_cents !== null && ` · approved ${formatCents(c.approved_cents)}`}
                      {c.flags.length > 0 && ` · ${c.flags.join(", ").replace(/_/g, " ")}`}
                      {!c.payout_method && " · ⚠️ add bank or PayPal details on “My events”"}
                    </p>
                    {c.rejected_reason && <p className="text-xs text-red-700">Rejected: {c.rejected_reason}</p>}
                    <div className="flex gap-3">
                      {c.status === "not_submitted" && (
                        <ActionButton action={withdrawReceipt} input={{ claim_id: c.id }} variant="ghost" confirm="Withdraw this receipt?">
                          Withdraw
                        </ActionButton>
                      )}
                    </div>
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
            <CardTitle>Hand-in status</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2" data-testid="handin-status">
            <p>
              {list?.signed_off_at ? "✅" : "⬜"} Attendance list{" "}
              {list?.signed_off_at ? `signed off (${list.headcount} counted)` : <Link href={`/events/${id}/attendance`} className="text-esn hover:underline">not signed off yet</Link>}
            </p>
            <p>
              {(photos ?? []).length ? "✅" : "⬜"} Photos: {(photos ?? []).length}
            </p>
            <p>
              {s.receipts ? "✅" : "⬜"} Receipts registered: {s.receipts ?? 0}
              {s.belege_missing ? ` · ${s.belege_missing} Beleg(e) not handed in yet` : ""}
            </p>
            {!started && <p className="text-xs text-gray-500">The event has not started yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isStaff && <PhotoUploader eventId={id} />}
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
  );
}
