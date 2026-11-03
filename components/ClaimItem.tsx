// One reimbursement claim as its owner sees it (Reimbursements, the event's
// hand-in). Reworked in round 2026-11-03 (2): the amount that counts on the
// right, one line for where it stands with small progress dots, instead of
// four amount columns and four step chips.
import { claimState, claimSteps, EXPENSE_KIND_LABELS, FLAG_LABELS, type ClaimStatus, type ExpenseKind, type Flag } from "@/lib/reimbursement";
import { formatCents, formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

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

const STATE_TONE = { todo: "font-medium text-amber-800", waiting: "text-gray-700", done: "text-emerald-700", failed: "font-medium text-red-700" } as const;
const DOT_TONE = { done: "bg-emerald-500", current: "bg-esn", todo: "bg-gray-200", failed: "bg-red-500" } as const;

export function ClaimItem({ claim, children }: { claim: ClaimView; children?: React.ReactNode }) {
  const steps = claimSteps(claim);
  const state = claimState(claim, formatShortDate);
  // Approved once Finance checked it, the suggestion before.
  const cents = claim.approvedCents ?? claim.suggestedCents;
  const label = claim.status === "paid" ? "paid" : claim.approvedCents !== null ? "approved" : "expected";
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <div className="space-y-1.5" data-testid={`claim-item-${claim.vendor}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 break-words">{claim.vendor}</p>
          <p className="text-xs text-gray-500">
            {claim.kind && EXPENSE_KIND_LABELS[claim.kind].split(" (")[0]}
            {claim.kind && claim.purchasedOn && " · "}
            {claim.purchasedOn && `bought ${formatShortDate(`${claim.purchasedOn}T12:00:00Z`)}`}
          </p>
        </div>
        <div className="shrink-0 text-right" data-testid="claim-amount">
          <p className={cn("font-semibold tabular-nums", claim.status === "rejected" && "text-gray-400 line-through")}>{formatCents(cents)}</p>
          <p className="text-[11px] text-gray-500">
            {label}
            {claim.receiptCents !== null && claim.receiptCents !== cents && ` · receipt ${formatCents(claim.receiptCents)}`}
          </p>
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs" data-testid="claim-state">
        <span role="img" aria-label={`${done} of ${steps.length} steps done`} className="flex shrink-0 gap-1">
          {steps.map((s) => (
            <span key={s.label} title={s.label} className={cn("h-1.5 w-4 rounded-full", DOT_TONE[s.state])} />
          ))}
        </span>
        <span className={STATE_TONE[state.tone]}>{state.text}</span>
      </p>
      {claim.flags.length > 0 && <p className="text-xs text-amber-800">{claim.flags.map((f) => FLAG_LABELS[f as Flag] ?? f.replace(/_/g, " ")).join(" · ")}</p>}
      {children}
    </div>
  );
}
