import { Suspense } from "react";
import { Clock, MapPin, Navigation } from "lucide-react";
import { loadEventForPage } from "@/lib/events";
import { berlinTime, formatDate, formatDateTime, nowMs } from "@/lib/dates";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { TAB_LABEL, nextStep } from "@/lib/checklist";
import { checklistInput } from "@/lib/eventStatus";
import { hasRole } from "@/lib/roles";
import { Badge } from "@/components/ui";
import { DateTile } from "@/components/DateTile";
import { EventStatusBadge } from "@/components/status";
import { EventBreadcrumb, EventTabs, NextStepBanner } from "./EventTabs";
import { eventMeeting, meetingShort } from "@/lib/meeting";
import { venue } from "@/lib/calendarView";

/**
 * Every tab of an event under one header (redesign 2026-11-07, like the
 * Home and My events cards): the day as a date tile, status and the
 * viewer's role first, the title, when and where, and the viewer's next
 * step as the foot of the header.
 */
export default async function EventLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const { event, myAssignment, supabase, cycle, viewer, isEvents } = await loadEventForPage(id);
  const cash = !!myAssignment || isEvents || hasRole(viewer.roles, "finance") || viewer.roles.includes("executive");

  // The OC's (or helper's) one next step, on every tab.
  const step = myAssignment ? nextStep(await checklistInput(supabase, event, cycle?.description_deadline ?? null, viewer.id), myAssignment.role as "oc" | "helper") : null;
  const notes = step?.kind === "action" ? { [TAB_LABEL[step.tab]]: "Your next step is here" } : {};
  const off = event.status === "cancelled" || event.status === "dropped";
  const sameDay = event.ends_at && formatDate(event.ends_at) === formatDate(event.starts_at);
  const meeting = meetingShort(eventMeeting(event));
  const place = venue(event.location);

  return (
    <div className="space-y-5">
      <Suspense fallback={<span className="text-sm text-esn">← Back</span>}>
        <EventBreadcrumb fallback={myAssignment ? "me" : "calendar"} />
      </Suspense>
      <header className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex gap-4 p-4 sm:p-5">
          <DateTile iso={event.starts_at} tone={off ? "muted" : "default"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span data-testid="event-status">
                <EventStatusBadge status={event.status} />
              </span>
              {event.type !== "standard" && <Badge>{EVENT_TYPE_LABELS[event.type]}</Badge>}
              {myAssignment && (
                <span className="inline-flex items-center rounded-full bg-esn px-2 py-0.5 text-xs font-semibold text-white">You: {myAssignment.role === "oc" ? "OC" : "helper"}</span>
              )}
            </div>
            <h1 className={`mt-1.5 text-xl font-bold leading-snug break-words sm:text-2xl ${off ? "text-gray-500 line-through" : "text-gray-900"}`} data-testid="event-title">
              {event.title}
            </h1>
            <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                {formatDateTime(event.starts_at)}
                {event.ends_at && (sameDay ? `–${berlinTime(event.ends_at)}` : ` – ${formatDateTime(event.ends_at)}`)}
              </span>
              {place && (
                <span className="inline-flex min-w-0 items-center gap-1.5" title={event.location ?? undefined}>
                  <MapPin className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  <span className="truncate">{place}</span>
                </span>
              )}
              {meeting && (
                <span className="inline-flex items-center gap-1.5">
                  <Navigation className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                  {meeting}
                </span>
              )}
            </p>
          </div>
        </div>
        {step && step.kind !== "done" && (
          <Suspense>
            <NextStepBanner id={id} step={step} now={nowMs()} />
          </Suspense>
        )}
      </header>
      <Suspense>
        <EventTabs id={id} notes={notes} cash={cash} />
      </Suspense>
      {children}
    </div>
  );
}
