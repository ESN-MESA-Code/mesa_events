import Link from "next/link";
import { loadEventForPage } from "@/lib/events";
import { formatDateTime } from "@/lib/dates";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { Badge } from "@/components/ui";
import { EventTabs } from "./EventTabs";

export default async function EventLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const { event, myAssignment } = await loadEventForPage(id);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/calendar" className="text-sm text-esn hover:underline">
          ← Calendar
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900 mr-2 break-words" data-testid="event-title">
            {event.title}
          </h1>
          <Badge>{EVENT_TYPE_LABELS[event.type]}</Badge>
          <Badge tone={EVENT_STATUS_TONES[event.status]} data-testid="event-status">
            {EVENT_STATUS_LABELS[event.status]}
          </Badge>
          {myAssignment && <Badge tone="blue">You: {myAssignment.role === "oc" ? "OC" : "helper"}</Badge>}
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {formatDateTime(event.starts_at)}
          {event.ends_at && ` – ${formatDateTime(event.ends_at)}`}
          {event.location && ` · ${event.location}`}
        </p>
      </div>
      <EventTabs id={id} />
      {children}
    </div>
  );
}
