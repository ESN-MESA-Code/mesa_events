import type { Metadata } from "next";
import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatCents, formatShortDate, berlinDate, daysSpanned, nowMs } from "@/lib/dates";
import { kindsFor, receiptsStatus, type ClaimStatus, type ExpenseKind, type Rule, maskEmail, maskIban } from "@/lib/reimbursement";
import { ClaimItem } from "@/components/ClaimItem";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { withdrawReceipt } from "@/app/actions/handin";
import { PhotoFolder, PreapprovalForm, ReceiptForm } from "./HandInClient";
import { photosIn } from "@/lib/photos";
import { plural } from "@/lib/plural";
import { EventReportForm } from "./EventReport";
import { EsnUpload } from "@/components/EsnUpload";
import { loadEsn } from "@/lib/esn/load";
import type { EventReport } from "@/lib/esn/formData";
import { hasRole } from "@/lib/roles";

export const metadata: Metadata = { title: "Hand-in" };


// After the event: photos (in the event's Drive folder), the attendance
// list closed, the event report (for ESN Activities), every receipt
// registered and the paper Beleg handed to Finance. Comms, Events and
// executives also see the event's ESN Activities status here.
export default async function HandInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, supabase, viewer, isStaff, isTeam, isOc, isEvents, myAssignment } = await loadEventForPage(id);
  if (!isStaff && !isTeam) {
    return (
      <Card>
        <EmptyState>The hand-in is for the event&apos;s OC and helpers.</EmptyState>
      </Card>
    );
  }

  const seesEsn = hasRole(viewer.roles, "comms") || isEvents || hasRole(viewer.roles, "executive");
  const [{ data: list }, { data: photos }, { data: claims }, { data: summary }, { data: policyId }, { data: preapprovals }, { data: budget }, { data: report }, { data: prefill }, esn] = await Promise.all([
    supabase.from("attendance_lists").select("signed_off_at, headcount").eq("event_id", id).maybeSingle(),
    supabase
      .from("event_photo_folders")
      .select("folder_url, folder_path, photo_count, counted_at, count_error, marked_uploaded_at, marked_uploaded_by")
      .eq("event_id", id)
      .maybeSingle(),
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
    supabase.from("event_reports").select("*").eq("event_id", id).maybeSingle(),
    supabase.rpc("event_report_prefill", { event: id }),
    seesEsn ? loadEsn(supabase, [id]).then((m) => m.get(id) ?? null) : Promise.resolve(null),
  ]);
  const { data: myPayout } = await supabase.from("profile_payout_details").select("iban, paypal_email").eq("profile_id", viewer.id).maybeSingle();
  const payoutLabel = myPayout ? (myPayout.iban ? `bank account ${maskIban(myPayout.iban)}` : `PayPal ${maskEmail(myPayout.paypal_email ?? "")}`) : null;
  const pre = (prefill ?? [])[0];
  const canReport = isOc || isEvents;
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
        <CardContent className="text-sm grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="handin-status">
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
            {photosIn(photos) ? "✅" : "⬜"} Photos in Drive:{" "}
            {photos?.photo_count ? plural(photos.photo_count, "file") : photos?.marked_uploaded_at ? "ticked by hand" : started ? "none yet" : <span className="text-gray-500">– after the event</span>}
          </p>
          <p data-testid="report-status">
            {report ? "✅" : "⬜"} Event report{" "}
            {report ? (
              "written"
            ) : started ? (
              <a href="#event-report" className="text-esn hover:underline">
                not written yet
              </a>
            ) : (
              <span className="text-gray-500">– after the event</span>
            )}
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
                  profilePayout={payoutLabel}
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
                      {/* The steps above show the status; no badge repeating it (review 2026-10-29 B5). */}
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {c.status === "not_submitted" && <span className="text-amber-800">Beleg not handed in yet – bring the paper Beleg to Finance</span>}
                        {!c.payout_method && (
                          <Link href="/me/payout" className="text-amber-800 underline">
                            ⚠️ Add your IBAN or PayPal to your profile
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
        <Card id="photos" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {handInOpen ? (
              <PhotoFolder eventId={id} folder={photos ?? null} canTick={isOc || isEvents} canCheck={isStaff || isTeam} />
            ) : (
              <p className="text-sm text-gray-500">The event&apos;s photo folder in Drive opens on the day of the event.</p>
            )}
          </CardContent>
        </Card>

        <Card id="event-report" className="scroll-mt-4">
          <CardHeader>
            <CardTitle>Event report</CardTitle>
            {report && <Badge tone="green">Written</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">Participants and results for ESN Activities – one report per event, by the OC.</p>
            {!started ? (
              <p className="text-sm text-gray-500">The report is written after the event has started.</p>
            ) : canReport && ["confirmed", "understaffed", "completed"].includes(event.status) ? (
              <EventReportForm eventId={id} report={(report as EventReport | null) ?? null} prefill={{ headcount: pre?.headcount ?? null, local: pre?.local_participants ?? 0, organizers: pre?.organizers ?? 0 }} />
            ) : report ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm" data-testid="event-report">
                <dt className="text-gray-500">International</dt>
                <dd>{report.intl_participants}</dd>
                <dt className="text-gray-500">Local</dt>
                <dd>{report.local_participants}</dd>
                <dt className="text-gray-500">Organizers</dt>
                <dd>{report.organizers}</dd>
                <dt className="text-gray-500">Goals reached</dt>
                <dd>{report.goals_reached ? "Yes" : "No"}</dd>
                <dt className="text-gray-500">Went well</dt>
                <dd className="break-words">{report.went_well}</dd>
                {report.could_be_better && (
                  <>
                    <dt className="text-gray-500">Could be better</dt>
                    <dd className="break-words">{report.could_be_better}</dd>
                  </>
                )}
              </dl>
            ) : (
              <EmptyState>The OC has not written the report yet.</EmptyState>
            )}
          </CardContent>
        </Card>

        {esn && (
          <Card id="esn-activities" className="scroll-mt-4">
            <CardHeader>
              <CardTitle>ESN Activities</CardTitle>
            </CardHeader>
            <CardContent>
              <EsnUpload eventId={id} status={esn.status} canSet={hasRole(viewer.roles, "executive")} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </div>
  );
}
