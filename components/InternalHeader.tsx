import Link from "next/link";
import { Badge } from "@/components/ui";
import { berlinTime, formatDateTime } from "@/lib/dates";
import { INTERNAL_KIND_LABELS, INTERNAL_KIND_TONES, type InternalKind } from "@/lib/internal";

/** Title, kind, time and place of an internal event, with the way back. */
export function InternalHeader({
  event,
  back,
  role,
  planner,
}: {
  event: { id: string; kind: InternalKind; title: string; starts_at: string; ends_at: string | null; location: string; status: string };
  back: { href: string; label: string };
  role: "oc" | "helper" | "attendee" | null;
  planner: boolean;
}) {
  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={back.href} className="text-esn hover:underline" data-testid="breadcrumb">
          ← {back.label}
        </Link>
      </nav>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 break-words text-2xl font-bold text-gray-900" data-testid="internal-title">
          {event.title}
        </h1>
        <Badge tone={INTERNAL_KIND_TONES[event.kind]}>{INTERNAL_KIND_LABELS[event.kind]}</Badge>
        {event.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
        {role && <Badge tone="blue">You: {role === "oc" ? "OC" : role === "helper" ? "helper" : "signed up"}</Badge>}
        {planner && (
          <Link href={`/team/internal?month=${event.starts_at.slice(0, 7)}`} className="ml-auto text-sm text-esn hover:underline">
            Edit in the planner →
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {formatDateTime(event.starts_at)}
        {event.ends_at && ` – ${berlinTime(event.ends_at)}`}
        {event.location && ` · ${event.location}`}
      </p>
    </div>
  );
}
