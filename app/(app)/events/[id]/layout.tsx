import { Suspense } from "react";
import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatDateTime, formatDue, nowMs } from "@/lib/dates";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { nextStep, type NextStep } from "@/lib/checklist";
import { checklistInput } from "@/lib/eventStatus";
import { Badge } from "@/components/ui";
import { EventStatusBadge } from "@/components/status";
import { cn } from "@/lib/utils";
import { EventBreadcrumb, EventTabs } from "./EventTabs";

const TAB_LABEL: Record<NextStep["tab"], string> = { "": "Overview", description: "Description", attendance: "Attendance", "hand-in": "Hand-in" };

export default async function EventLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const { event, myAssignment, supabase, cycle } = await loadEventForPage(id);

  // The OC's (or helper's) one next step, on every tab.
  const step = myAssignment ? nextStep(await checklistInput(supabase, event, cycle?.description_deadline ?? null), myAssignment.role as "oc" | "helper") : null;
  const notes = step?.kind === "action" ? { [TAB_LABEL[step.tab]]: "Your next step is here" } : {};

  return (
    <div className="space-y-5">
      <div>
        <Suspense fallback={<span className="text-sm text-esn">← Back</span>}>
          <EventBreadcrumb fallback={myAssignment ? "me" : "calendar"} />
        </Suspense>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900 mr-2 break-words" data-testid="event-title">
            {event.title}
          </h1>
          <Badge>{EVENT_TYPE_LABELS[event.type]}</Badge>
          <span data-testid="event-status">
            <EventStatusBadge status={event.status} />
          </span>
          {myAssignment && <Badge tone="blue">You: {myAssignment.role === "oc" ? "OC" : "helper"}</Badge>}
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {formatDateTime(event.starts_at)}
          {event.ends_at && ` – ${formatDateTime(event.ends_at)}`}
          {event.location && ` · ${event.location}`}
        </p>
      </div>
      {step && step.kind !== "done" && (
        <Link
          href={`/events/${id}${step.tab ? `/${step.tab}` : ""}`}
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 hover:shadow-sm",
            step.kind === "action" ? "border-esn/30 bg-esn/5" : "border-gray-200 bg-white"
          )}
          data-testid="next-step-banner"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{step.kind === "action" ? "Your next step" : "Status"}</span>
          <span className="font-semibold text-esn-dark">{step.label}</span>
          {step.due && <span className="text-sm text-gray-600">{formatDue(step.due, nowMs())}</span>}
          <span className="ml-auto text-sm text-esn">{TAB_LABEL[step.tab]} →</span>
        </Link>
      )}
      <Suspense>
        <EventTabs id={id} notes={notes} />
      </Suspense>
      {children}
    </div>
  );
}
