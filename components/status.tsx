// The same status chips and step displays on every page (review C11).
import { Badge } from "@/components/ui";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, type EventStatus } from "@/lib/labels";
import { STATUS_LABELS, type ClaimStatus } from "@/lib/reimbursement";
import { cn } from "@/lib/utils";

export function EventStatusBadge({ status, className }: { status: EventStatus; className?: string }) {
  return (
    <Badge tone={EVENT_STATUS_TONES[status]} className={className}>
      {EVENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export const CLAIM_TONES: Record<ClaimStatus, "gray" | "blue" | "green" | "red" | "purple"> = {
  not_submitted: "gray",
  beleg_received: "blue",
  checked: "green",
  paid: "purple",
  rejected: "red",
};

export function ClaimStatusBadge({ status, className }: { status: ClaimStatus; className?: string }) {
  return (
    <Badge tone={CLAIM_TONES[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export const DESCRIPTION_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "amber" | "green" | "purple" | "red" }> = {
  missing: { label: "Not started", tone: "gray" },
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Waiting for Comms review", tone: "blue" },
  changes_requested: { label: "Changes requested", tone: "amber" },
  approved: { label: "Approved – ready to publish", tone: "green" },
  published: { label: "Published", tone: "purple" },
};

export interface StepView {
  label: string;
  state: "done" | "current" | "todo" | "failed";
  /** A second line, e.g. who and when. */
  note?: string;
}

/** Steps in a row (wrapping on phones): done ✓, the current one highlighted. */
export function Stepper({ steps, label, compact = false, testId }: { steps: StepView[]; label: string; compact?: boolean; testId?: string }) {
  return (
    <ol aria-label={label} className={cn("flex flex-wrap items-start gap-x-1 gap-y-2", compact ? "text-[11px]" : "text-xs")} data-testid={testId}>
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1" aria-current={s.state === "current" ? "step" : undefined} data-state={s.state}>
          {i > 0 && <span aria-hidden="true" className="text-gray-300">›</span>}
          <span
            className={cn(
              "inline-flex flex-col rounded-full px-2 py-0.5 font-medium",
              s.state === "done" && "bg-emerald-50 text-emerald-800",
              s.state === "current" && "bg-esn text-white",
              s.state === "todo" && "bg-gray-100 text-gray-500",
              s.state === "failed" && "bg-red-50 text-red-700"
            )}
          >
            <span>
              {s.state === "done" && "✓ "}
              {s.state === "failed" && "✕ "}
              {s.label}
            </span>
            {s.note && !compact && <span className="font-normal opacity-80">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
