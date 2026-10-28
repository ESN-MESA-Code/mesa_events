import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, monthLabel, nowMs } from "@/lib/dates";
import { CYCLE_STATUS_LABELS, EVENT_STATUS_LABELS, EVENT_STATUS_TONES } from "@/lib/labels";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";

// The Events team's overview: the schedule ahead, events short of people,
// and the state of open volunteer forms.
export async function EventsDashboard() {
  const supabase = await createSessionClient();
  const now = new Date(nowMs()).toISOString();
  const [{ data: upcoming }, { data: slots }, { data: cycles }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, starts_at, status, helpers_needed")
      .gte("starts_at", now)
      .in("status", ["scheduled", "confirmed", "understaffed"])
      .order("starts_at")
      .limit(12),
    supabase.rpc("open_slots"),
    supabase.from("planning_cycles").select("id, month, status, form_closes_at").in("status", ["form_open", "form_closed", "allocated"]).order("month"),
  ]);
  const short = new Map((slots ?? []).map((s) => [s.event_id, s]));
  const responses = await Promise.all(
    (cycles ?? []).map(async (c) => {
      const { count } = await supabase.from("volunteer_responses").select("id", { count: "exact", head: true }).eq("cycle_id", c.id);
      return [c.id, count ?? 0] as const;
    })
  );
  const responseCount = new Map(responses);
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
                <Link href={`/events/${e.id}`} className="font-medium text-gray-900 hover:text-esn">
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
                    <Link href={`/events/${e.id}`} className="text-esn hover:underline">
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
        <Card>
          <CardHeader>
            <CardTitle>Volunteer forms</CardTitle>
          </CardHeader>
          <CardContent>
            {!cycles?.length && <EmptyState>No form open.</EmptyState>}
            <ul className="text-sm space-y-2" data-testid="form-status">
              {(cycles ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/team/events/cycles/${c.id}`} className="font-medium text-esn hover:underline">
                    {monthLabel(c.month)}
                  </Link>
                  <span className="text-gray-500">
                    {" "}
                    · {CYCLE_STATUS_LABELS[c.status]} · {responseCount.get(c.id)} response{responseCount.get(c.id) === 1 ? "" : "s"}
                    {c.status === "form_open" && c.form_closes_at ? ` · closes ${formatDateTime(c.form_closes_at)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
