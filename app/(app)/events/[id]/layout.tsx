import { Suspense } from "react";
import { loadEventForPage } from "@/lib/events";
import { formatDateTime, formatDue, nowMs } from "@/lib/dates";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { TAB_LABEL, nextStep } from "@/lib/checklist";
import { checklistInput } from "@/lib/eventStatus";
import { Badge } from "@/components/ui";
import { EventStatusBadge } from "@/components/status";
import { EventBreadcrumb, EventTabs, NextStepBanner } from "./EventTabs";

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
        <Suspense>
          <NextStepBanner id={id} step={step} due={step.due ? formatDue(step.due, nowMs()) : null} />
        </Suspense>
      )}
      <Suspense>
        <EventTabs id={id} notes={notes} />
      </Suspense>
      {children}
    </div>
  );
}
