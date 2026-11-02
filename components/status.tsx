// The same status chips and step displays on every page (review C11).
import Link from "next/link";
import { Badge } from "@/components/ui";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, type EventStatus } from "@/lib/labels";
import { STATUS_LABELS, type ClaimStatus } from "@/lib/reimbursement";
import { cn } from "@/lib/utils";
import { dueUrgency, formatDue } from "@/lib/dates";

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
  /** Where the step is done: the step becomes a link (the cycle's breadcrumb). */
  href?: string;
  /** The page shown is this step's. */
  here?: boolean;
  /** The current step is behind the cycle's timeline (round 2026-11-02). */
  late?: boolean;
}

/**
 * An event's stage track (Comms page): the whole stepper from the small
 * breakpoint on; on phones only the current stage and "n of m".
 */
export function StageTrack({ steps, label, position, testId }: { steps: StepView[]; label: string; position: number; testId?: string }) {
  const current = steps.find((s) => s.state === "current");
  return (
    <div data-testid={testId}>
      <div className="hidden sm:block">
        <Stepper steps={steps} label={label} compact />
      </div>
      <p className="sm:hidden text-[11px] text-gray-600" data-testid="stage-compact">
        <span className={cn("rounded-full px-2 py-0.5 font-medium", current ? "bg-esn text-white" : "bg-emerald-50 text-emerald-800")}>{current ? current.label : "✓ All done"}</span>{" "}
        {position} of {steps.length}
      </p>
    </div>
  );
}

/** Steps in a row (wrapping on phones): done ✓, the current one highlighted; steps with `href` are links. */
export function Stepper({ steps, label, compact = false, testId }: { steps: StepView[]; label: string; compact?: boolean; testId?: string }) {
  return (
    <ol aria-label={label} className={cn("flex flex-wrap items-start gap-x-1 gap-y-2", compact ? "text-[11px]" : "text-xs")} data-testid={testId}>
      {steps.map((s, i) => {
        const chip = cn(
          "inline-flex flex-col rounded-full px-2 py-0.5 font-medium",
          s.state === "done" && "bg-emerald-50 text-emerald-800",
          s.state === "current" && (s.late ? "bg-red-600 text-white" : "bg-esn text-white"),
          s.state === "todo" && "bg-gray-100 text-gray-500",
          s.state === "failed" && "bg-red-50 text-red-700",
          s.href && "hover:ring-2 hover:ring-esn/40",
          s.here && "ring-2 ring-esn-dark ring-offset-1"
        );
        const body = (
          <>
            <span>
              {s.state === "done" && "✓ "}
              {s.state === "failed" && "✕ "}
              {s.label}
            </span>
            {s.note && !compact && <span className="font-normal opacity-80">{s.note}</span>}
          </>
        );
        return (
          <li key={s.label} className="flex items-center gap-1" aria-current={s.here ? "page" : s.state === "current" ? "step" : undefined} data-state={s.state} data-late={s.late || undefined}>
            {i > 0 && <span aria-hidden="true" className="text-gray-300">›</span>}
            {s.href ? (
              <Link href={s.href} className={chip}>
                {body}
              </Link>
            ) : (
              <span className={chip}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * "due Mon 2 Nov, 19:00 – after that the event is cancelled": amber within
 * 48 hours, red within 24 hours or once passed (usability review #1).
 */
export function DueLabel({ iso, now, note, className }: { iso: string; now: number; note?: string; className?: string }) {
  const urgency = dueUrgency(iso, now);
  return (
    <span
      className={cn(urgency === "urgent" ? "font-semibold text-red-700" : urgency === "soon" ? "font-semibold text-amber-700" : "opacity-80", className)}
      data-urgency={urgency}
      data-testid="due"
    >
      {formatDue(iso, now)}
      {note && ` – ${note}`}
    </span>
  );
}
