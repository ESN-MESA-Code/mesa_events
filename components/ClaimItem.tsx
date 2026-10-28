// One reimbursement claim as its owner sees it (My events, the event's
// hand-in): labelled amounts and progress steps (review C7).
import { claimSteps, EXPENSE_KIND_LABELS, type ClaimStatus, type ExpenseKind } from "@/lib/reimbursement";
import { formatCents, formatShortDate } from "@/lib/dates";
import { Stepper } from "@/components/status";

export interface ClaimView {
  id: string;
  status: ClaimStatus;
  kind: ExpenseKind | null;
  vendor: string;
  purchasedOn: string | null;
  receiptCents: number | null;
  suggestedCents: number;
  approvedCents: number | null;
  flags: string[];
  belegReceivedAt: string | null;
  checkedAt: string | null;
  paidAt: string | null;
  rejectedReason: string | null;
}

function Amount({ label, cents, strong }: { label: string; cents: number | null; strong?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{formatCents(cents)}</dd>
    </div>
  );
}

export function ClaimItem({ claim, children }: { claim: ClaimView; children?: React.ReactNode }) {
  const steps = claimSteps(claim).map((s) => ({ label: s.label, state: s.state, note: s.at ? formatShortDate(s.at) : undefined }));
  return (
    <div className="space-y-2" data-testid={`claim-item-${claim.vendor}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-gray-900">{claim.vendor}</span>
        {claim.kind && <span className="text-xs text-gray-500">{EXPENSE_KIND_LABELS[claim.kind].split(" (")[0]}</span>}
        {claim.purchasedOn && <span className="text-xs text-gray-500">· bought {formatShortDate(`${claim.purchasedOn}T12:00:00Z`)}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Amount label="Receipt amount" cents={claim.receiptCents} />
        <Amount label="Suggested" cents={claim.suggestedCents} />
        <Amount label="Approved" cents={claim.approvedCents} />
        <Amount label="Paid" cents={claim.status === "paid" ? claim.approvedCents : null} strong />
      </dl>
      <Stepper steps={steps} label={`Progress of ${claim.vendor}`} testId="claim-steps" />
      {claim.flags.length > 0 && <p className="text-xs text-amber-800">{claim.flags.join(", ").replace(/_/g, " ")}</p>}
      {claim.rejectedReason && <p className="text-xs text-red-700">Rejected: {claim.rejectedReason}</p>}
      {children}
    </div>
  );
}
