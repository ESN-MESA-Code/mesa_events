import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Banknote, CircleCheck, Landmark, ReceiptText, TriangleAlert, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { berlinTime, formatCents, formatDateTime, formatShortDate } from "@/lib/dates";
import { maskEmail, maskIban, type ClaimStatus, type ExpenseKind } from "@/lib/reimbursement";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui";
import { SectionHeader } from "@/components/home";
import { DateTile } from "@/components/DateTile";
import { ClaimStatusBadge } from "@/components/status";
import { ClaimItem } from "@/components/ClaimItem";
import { MyPayoutForm } from "./MyPayoutForm";

export const metadata: Metadata = { title: "Expenses" };

type Ev = { id: string; title: string; starts_at: string };
type Receipt = { expense_kind: ExpenseKind; vendor: string; amount_cents: number; purchased_on: string; beleg_received_at: string | null };

// The member's reimbursements on their own page (round 2026-11-03 (2)):
// where Finance pays them (the profile's IBAN or PayPal, formerly
// /me/payout), the open claims by event, and the settled ones folded away.
// Receipts are registered on the event's Hand-in tab. Redesign 2026-11-07:
// three totals on top, each event's claims as a card, payout details beside.
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
  const openCents = open.reduce((sum, c) => sum + (c.approved_cents ?? c.suggested_cents), 0);
  const yourTurn = open.filter((c) => c.status === "not_submitted").length;

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
      <PageHeader title="Expenses" description="What you paid for MESA events, and where Finance pays you back. Register receipts on the event's Hand-in tab." />

      <div className="space-y-8">
        <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Totals">
          <Stat icon={Wallet} label="Open" value={formatCents(openCents)} note={open.length ? `${plural(open.length, "claim")} on the way` : "Nothing open"} />
          <Stat
            icon={ReceiptText}
            label="Your turn"
            value={String(yourTurn)}
            note={yourTurn ? `paper ${yourTurn === 1 ? "receipt" : "receipts"} to hand to Finance` : "No paper receipts to hand in"}
            tone={yourTurn ? "todo" : "default"}
          />
          <Stat icon={CircleCheck} label="Paid back" value={formatCents(paidCents)} note={`${plural(settled.filter((c) => c.status === "paid").length, "claim")} so far`} tone="done" />
        </ul>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 space-y-8">
            <section aria-labelledby="open-heading" className="space-y-3" data-testid="my-reimbursements">
              <SectionHeader id="open-heading" title="Open claims" count={open.length} />
              {!saved && missing > 0 && (
                <a
                  href="#payout"
                  className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100/70"
                  data-testid="payout-prompt"
                >
                  <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Add your IBAN or PayPal once</span>
                    <span className="block text-amber-800">Finance pays all {plural(missing, "open claim")} – and every later one – to it.</span>
                  </span>
                  <span className="shrink-0 font-semibold lg:hidden">Add ↓</span>
                </a>
              )}
              {!groups.length && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
                  <Banknote className="h-8 w-8 text-gray-300" aria-hidden="true" />
                  <p className="font-semibold text-gray-900">No open claims.</p>
                  <p className="max-w-sm text-sm text-gray-600">Paid for something at an event? Register the receipt on that event&apos;s Hand-in tab.</p>
                </div>
              )}
              {groups.map(({ event, claims: list }) => {
                const total = list.reduce((sum, c) => sum + (c.approved_cents ?? c.suggested_cents), 0);
                return (
                  <section key={event.id} aria-label={`Claims for ${event.title}`} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
                      <DateTile iso={event.starts_at} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-600">
                          {berlinTime(event.starts_at)} · {plural(list.length, "claim")} · {formatCents(total)}
                        </p>
                        <h3 className="font-semibold leading-snug text-gray-900 break-words">{event.title}</h3>
                      </div>
                      <Link
                        href={`/events/${event.id}/hand-in?from=reimbursements`}
                        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-esn hover:underline"
                        aria-label={`Hand-in of ${event.title}`}
                      >
                        <span className="hidden sm:inline">Hand-in</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {list.map((c) => {
                        const r = c.receipts as Receipt | null;
                        const d = c.payout_details as { iban: string | null; paypal_email: string | null } | null;
                        return (
                          <li key={c.id} className="px-4 py-3 sm:px-5">
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
                              {/* One set of details for all claims (round 2026-11-07): nothing to fill in per claim. */}
                              {!d && !saved && (
                                <a href="#payout" className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:underline" data-testid="payout-line">
                                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  Paid once you add your IBAN or PayPal
                                </a>
                              )}
                            </ClaimItem>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </section>

            {settled.length > 0 && (
              <details className="group rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="my-settled">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-lg font-bold text-gray-900">Paid and rejected</span>
                  <span className="text-sm text-gray-600">
                    {plural(settled.length, "claim")} · {formatCents(paidCents)} paid
                  </span>
                  <span className="ml-auto text-sm font-semibold text-esn group-open:hidden">Show</span>
                  <span className="ml-auto hidden text-sm font-semibold text-gray-500 group-open:inline">Hide</span>
                </summary>
                <ul className="divide-y divide-gray-100 border-t border-gray-100 text-sm">
                  {settled.map((c) => {
                    const r = c.receipts as Receipt | null;
                    const e = c.events as Ev | null;
                    return (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5" data-testid={`settled-${r?.vendor ?? c.id}`}>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-gray-900">{r?.vendor}</span>
                          {e && (
                            <Link href={`/events/${e.id}/hand-in?from=reimbursements`} className="block text-xs text-gray-500 hover:text-esn">
                              {e.title} · {formatShortDate(e.starts_at)}
                            </Link>
                          )}
                          {c.rejected_reason && <span className="block text-xs text-red-700">Rejected: {c.rejected_reason}</span>}
                        </span>
                        <span className="flex items-center gap-3">
                          {c.paid_at && <span className="text-xs text-gray-500">{formatShortDate(c.paid_at)}</span>}
                          <span className="w-20 text-right font-semibold tabular-nums">{c.status === "paid" ? formatCents(c.approved_cents) : "–"}</span>
                          <ClaimStatusBadge status={c.status as ClaimStatus} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </div>

          <section id="payout" aria-labelledby="payout-heading" className="scroll-mt-20 space-y-3 lg:sticky lg:top-20">
            <SectionHeader id="payout-heading" title="Payout details" />
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm shadow-sm sm:p-5">
              {saved ? (
                <div className="flex items-start gap-3" data-testid="saved-payout">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-esn/5 text-esn" aria-hidden="true">
                    {saved.iban ? <Landmark className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                  </span>
                  <p className="min-w-0">
                    {saved.iban ? (
                      <>
                        Bank transfer to <strong className="whitespace-nowrap">{maskIban(saved.iban)}</strong>
                        <span className="block text-gray-600">{saved.account_holder}</span>
                      </>
                    ) : (
                      <>
                        PayPal <strong className="break-all">{maskEmail(saved.paypal_email ?? "")}</strong>
                      </>
                    )}
                    <span className="block text-xs text-gray-500">updated {formatDateTime(saved.updated_at)}</span>
                  </p>
                </div>
              ) : (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-900" data-testid="payout-missing">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>No IBAN or PayPal yet – Finance cannot pay your reimbursements{missing ? ` (${missing} open)` : ""} until you add one.</span>
                </p>
              )}
              <MyPayoutForm saved={!!saved} />
              <details className="border-t border-gray-100 pt-3 text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-esn">Who sees them, and when they are deleted</summary>
                <div className="mt-2 space-y-1.5">
                  <p>Only you and the Finance team see them; Finance sees them on each of your claims.</p>
                  <p>Saving copies them onto your claims that are not paid yet. A claim keeps its copy until it is paid – then it is deleted.</p>
                  <p>Deleting removes them from your profile and from the claims Finance has not checked yet. Checked claims keep theirs until they are paid.</p>
                </div>
              </details>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

const STAT_TONE = { default: "bg-esn/5 text-esn", todo: "bg-amber-50 text-amber-700", done: "bg-emerald-50 text-emerald-700" } as const;

/** One total on top: an icon, the figure, a line under it. */
function Stat({ icon: Icon, label, value, note, tone = "default" }: { icon: LucideIcon; label: string; value: string; note: string; tone?: keyof typeof STAT_TONE }) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
      <span className={cn("hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex", STAT_TONE[tone])} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-500 sm:text-xs">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-gray-900 sm:text-xl">{value}</p>
        <p className="hidden truncate text-xs text-gray-600 sm:block">{note}</p>
      </div>
    </li>
  );
}

