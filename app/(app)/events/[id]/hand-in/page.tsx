import type { Metadata } from "next";
import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatCents, formatShortDate, berlinDate, daysSpanned, nowMs } from "@/lib/dates";
import { kindsFor, receiptsStatus, type ClaimStatus, type ExpenseKind, type Rule, maskEmail, maskIban } from "@/lib/reimbursement";
import { ClaimItem } from "@/components/ClaimItem";
import { Alert, Badge, Card, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { withdrawReceipt } from "@/app/actions/handin";
import { PhotoFolder, PreapprovalForm, ReceiptForm } from "./HandInClient";
import { Fold, RevealOnHash } from "@/components/Fold";
import { photosIn } from "@/lib/photos";
import { plural } from "@/lib/plural";
import { EventReportForm } from "./EventReport";
import { EsnUpload } from "@/components/EsnUpload";
import { loadEsn } from "@/lib/esn/load";
import { ESN_STATUS_LABEL, type EventReport } from "@/lib/esn/formData";
import { hasRole } from "@/lib/roles";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Hand-in" };


// After the event: photos (in the event's Drive folder), the attendance
// list closed, the event report (for ESN Activities), every receipt
// registered and the paper Beleg handed to Finance. Comms, Events and
// executives also see the event's ESN Activities status here. One column of
// folding steps (round 2026-11-03 (2)) instead of a status card above two
// columns of open forms.
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
  // The steps after the event, each one row that unfolds where it is done
  // (round 2026-11-03 (2)): done ones stay folded, the viewer's first open
  // one starts unfolded. Attendance and the report are the OC's – a helper
  // sees them as such, not as their own to-dos.
  const ocOnly = myAssignment?.role === "helper" && !isEvents;
  const stateOf = (done: boolean, own = true): StepState => (done ? "done" : !started ? "later" : own ? "todo" : "others");
  const myClaims = claims ?? [];
  const photosDone = photosIn(photos);
  const states = {
    attendance: stateOf(!!list?.signed_off_at, !ocOnly),
    photos: stateOf(photosDone),
    report: stateOf(!!report, !ocOnly),
    receipts: stateOf(!!s.receipts && !s.belege_missing, !!myAssignment),
    esn: esn ? (esn.status.state === "uploaded" ? "done" : esn.status.state === "ready" && hasRole(viewer.roles, "executive") ? "todo" : "later") : "later",
  } satisfies Record<string, StepState>;
  // The first of the viewer's open steps that unfolds (attendance is on its own tab).
  const first = handInOpen ? (["photos", "report", "receipts", "esn"] as const).find((k) => states[k] === "todo" && (k !== "receipts" || !!myAssignment) && (k !== "esn" || !!esn)) : undefined;
  const counted = [states.attendance, states.photos, states.report, states.receipts];

  return (
    <div className="max-w-3xl space-y-4">
      <RevealOnHash />
      {!handInOpen && (
        <Alert tone="info" data-testid="receipts-later">
          Hand-in opens on the day of the event ({formatShortDate(event.starts_at)}). Keep every paper receipt until then.
        </Alert>
      )}
      <Card id="hand-in-status" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Hand-in</CardTitle>
          <span className="text-xs text-gray-500" data-testid="handin-count">
            {counted.filter((x) => x === "done").length} of {counted.length} done
          </span>
        </CardHeader>
        <ul className="divide-y divide-gray-100 border-t border-gray-100" data-testid="handin-status">
          <Step
            id="attendance"
            title="Attendance list"
            state={states.attendance}
            detail={list?.signed_off_at ? `Signed off (${list.headcount} counted)` : started ? "Not signed off yet" : "On the day"}
            link={{ href: `/events/${id}/attendance`, label: list?.signed_off_at ? "Open" : states.attendance === "todo" ? "Sign off →" : "Open" }}
          />

          <Step
            id="photos"
            title="Photos in Drive"
            state={states.photos}
            open={first === "photos"}
            detail={photos?.photo_count ? plural(photos.photo_count, "file") : photos?.marked_uploaded_at ? "Ticked by hand" : started ? "None yet" : "After the event"}
            extra={
              photos?.folder_url && (
                <a href={photos.folder_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-esn hover:underline">
                  Open folder ↗
                </a>
              )
            }
          >
            {handInOpen ? (
              <PhotoFolder eventId={id} folder={photos ?? null} canTick={isOc || isEvents} canCheck={isStaff || isTeam} />
            ) : (
              <p className="text-sm text-gray-500">The event&apos;s photo folder in Drive opens on the day of the event.</p>
            )}
          </Step>

          <Step id="event-report" testId="report-status" title="Event report" state={states.report} open={first === "report"} detail={report ? "Written" : ocOnly ? "The OC writes it" : started ? "Not written yet" : "After the event"}>
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
          </Step>

          <Step
            id="receipts"
            testId="receipts-status"
            title="Receipts and paper receipts"
            state={states.receipts}
            open={first === "receipts"}
            detail={receiptsStatus({
              mine: myClaims.length,
              myMissing: myClaims.filter((c) => c.status === "not_submitted").length,
              all: s.receipts ?? 0,
              allMissing: s.belege_missing ?? 0,
              onTeam: !!myAssignment,
            })}
          >
            {myAssignment && (
              <>
                {myClaims.length > 0 && (
                  <ul id="your-receipts" className="scroll-mt-4 divide-y divide-gray-100 text-sm [&>li]:py-3 [&>li:first-child]:pt-0" data-testid="my-claims">
                    {myClaims.map((c) => {
                      const r = c.receipts as { expense_kind: ExpenseKind; vendor: string; amount_cents: number; purchased_on: string; beleg_received_at: string | null } | null;
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
                            {/* The card's status line says where it stands; no badge or note repeating it (review 2026-10-29 B5). */}
                            {((!c.payout_method && !myPayout) || c.status === "not_submitted") && (
                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                {/* Saved details reach every claim; only without them is there anything to add – once, on Expenses. */}
                                {!c.payout_method && !myPayout && (
                                  <Link href="/me/reimbursements#payout" className="text-amber-800 underline">
                                    ⚠️ Add your IBAN or PayPal
                                  </Link>
                                )}
                                {c.status === "not_submitted" && (
                                  <ActionButton action={withdrawReceipt} input={{ claim_id: c.id }} variant="ghost" confirm="Withdraw this receipt?">
                                    Withdraw
                                  </ActionButton>
                                )}
                              </div>
                            )}
                          </ClaimItem>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {handInOpen && (
                  <Fold id="register-receipt" defaultOpen={!myClaims.length} className="group/form scroll-mt-4 rounded-lg border border-gray-200">
                    <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-esn hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                      <span className="group-open/form:hidden">＋ Register a receipt</span>
                      <span className="hidden group-open/form:inline">Register a receipt</span>
                    </summary>
                    <div className="border-t border-gray-100 p-3">
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
                          profilePayout={payoutLabel}
                        />
                      ) : (
                        <EmptyState>No reimbursement rules apply to this event.</EmptyState>
                      )}
                    </div>
                  </Fold>
                )}
                <p className="text-xs text-gray-500">
                  Hand every paper receipt (<strong>Beleg</strong>) to Finance – without it nothing is paid. Claims are paid monthly; above €100 earlier.
                </p>
                {event.type === "weekend_trip" && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-esn">Attractions or museums? Ask the Treasurer first</summary>
                    <div className="mt-2 space-y-3">
                      <p className="text-gray-600">Attractions and museums on weekend trips are reimbursed only with the Treasurer&apos;s approval before you buy.</p>
                      <PreapprovalForm eventId={id} />
                      <ul className="space-y-1">
                        {(preapprovals ?? []).map((p) => (
                          <li key={p.id}>
                            {p.description} ({formatCents(p.estimated_cents)}) –{" "}
                            <Badge tone={p.status === "approved" ? "green" : p.status === "rejected" ? "red" : "gray"}>{p.status}</Badge>
                            {p.note && <span className="text-xs text-gray-500"> {p.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                )}
              </>
            )}
          </Step>

          {esn && (
            <Step id="esn-activities" title="ESN Activities" state={states.esn} open={first === "esn"} detail={ESN_STATUS_LABEL[esn.status.state]}>
              <EsnUpload eventId={id} status={esn.status} canSet={hasRole(viewer.roles, "executive")} />
            </Step>
          )}
        </ul>
      </Card>
    </div>
  );
}

type StepState = "done" | "todo" | "later" | "others";

const TAGS: Record<Exclude<StepState, "done">, { label: string; className: string }> = {
  todo: { label: "To do", className: "bg-amber-100 text-amber-900" },
  later: { label: "Later", className: "bg-gray-100 text-gray-500" },
  others: { label: "OC", className: "bg-gray-100 text-gray-600" },
};

/**
 * One step of the hand-in: ✓ / To do / Later (/ OC for a helper), what it
 * is and where it stands; it unfolds to where it is done, or links there.
 */
function Step({
  id,
  testId,
  title,
  state,
  detail,
  open = false,
  extra,
  link,
  children,
}: {
  id: string;
  testId?: string;
  title: string;
  state: StepState;
  detail: React.ReactNode;
  open?: boolean;
  extra?: React.ReactNode;
  link?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  const head = (
    <>
      <span className="mt-0.5 flex w-12 shrink-0 justify-center">
        {state === "done" ? (
          <Check role="img" aria-label="Done" className="h-4 w-4 text-emerald-600" strokeWidth={3} />
        ) : (
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", TAGS[state].className)}>{TAGS[state].label}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", state === "done" ? "text-gray-500" : "text-gray-900")}>{title}</span>
        <span className="block text-xs text-gray-600">{detail}</span>
      </span>
      {extra}
    </>
  );
  // Without anything to unfold: a plain row, leading to its tab.
  if (!children) {
    return (
      <li id={id} data-testid={testId} data-state={state} className="flex scroll-mt-4 items-start gap-3 px-5 py-3">
        {head}
        {link && (
          <Link href={link.href} className="shrink-0 text-xs font-medium text-esn hover:underline">
            {link.label}
          </Link>
        )}
      </li>
    );
  }
  return (
    <li data-testid={testId} data-state={state}>
      <Fold id={id} defaultOpen={open} className="group scroll-mt-4">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
          {head}
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-xs text-gray-400 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="space-y-3 px-5 pb-4 sm:pl-[5.75rem]">{children}</div>
      </Fold>
    </li>
  );
}
