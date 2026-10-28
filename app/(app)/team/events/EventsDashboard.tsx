import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, nowMs } from "@/lib/dates";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES } from "@/lib/labels";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";

// The Events team's overview: the schedule ahead and events short of
// people (the cycles are cards with their step, see page.tsx).
export async function EventsDashboard() {
  const supabase = await createSessionClient();
  const now = new Date(nowMs()).toISOString();
  const [{ data: upcoming }, { data: slots }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, starts_at, status, helpers_needed")
      .gte("starts_at", now)
      .in("status", ["scheduled", "confirmed", "understaffed"])
      .order("starts_at")
      .limit(12),
    supabase.rpc("open_slots"),
  ]);
  const short = new Map((slots ?? []).map((s) => [s.event_id, s]));
  const unstaffed = (upcoming ?? []).filter((e) => e.status === "understaffed" || short.has(e.id));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Coming up</CardTitle>
        </CardHeader>
        <CardContent>
          {!upcoming?.length && <EmptyState>Nothing scheduled.</EmptyState>}
          <ul className="divide-y divide-gray-100 text-sm" data-testid="upcoming-events">
            {(upcoming ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-40 tabular-nums text-gray-600">{formatDateTime(e.starts_at)}</span>
                <Link href={`/events/${e.id}?from=events`} className="font-medium text-gray-900 hover:text-esn">
                  {e.title}
                </Link>
                <Badge tone={EVENT_STATUS_TONES[e.status]} className="ml-auto">
                  {EVENT_STATUS_LABELS[e.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Short of people</CardTitle>
            <Badge tone={unstaffed.length ? "amber" : "green"}>{unstaffed.length}</Badge>
          </CardHeader>
          <CardContent>
            {!unstaffed.length && <EmptyState>Every upcoming event is staffed.</EmptyState>}
            <ul className="text-sm space-y-1.5" data-testid="unstaffed-events">
              {unstaffed.map((e) => {
                const s = short.get(e.id);
                return (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}?from=events`} className="text-esn hover:underline">
                      {e.title}
                    </Link>{" "}
                    <span className="text-gray-500">
                      {s?.open_oc ? "no OC" : s ? `${s.open_helpers} helper(s) missing` : "under-staffed"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
