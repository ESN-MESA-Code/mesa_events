import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatDateTime, monthLabel, monthOf, nowMs } from "@/lib/dates";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { plural } from "@/lib/plural";

export const metadata: Metadata = { title: "Calendar" };

// The internal calendar: every scheduled event (RLS decides what a member
// sees), with the member's own role and open slots anyone can claim.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ past?: string }> }) {
  const { past } = await searchParams;
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const since = new Date(nowMs() - (past ? 365 : 1) * 86_400_000);

  const [{ data: events }, { data: mine }, { data: slots }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, type, starts_at, location, status, helpers_needed")
      .gte("starts_at", since.toISOString())
      .neq("status", "draft")
      .neq("status", "dropped")
      // History imported from the bot is for "Get inspired" on /ideas, not the calendar.
      .eq("source", "platform")
      .order("starts_at"),
    supabase.from("assignments").select("event_id, role").eq("profile_id", viewer.id).eq("status", "active"),
    supabase.rpc("open_slots"),
  ]);

  const myRole = new Map((mine ?? []).map((a) => [a.event_id, a.role]));
  const openSlots = new Map((slots ?? []).map((s) => [s.event_id, s]));
  const byMonth = new Map<string, NonNullable<typeof events>>();
  for (const e of events ?? []) {
    const m = monthOf(e.starts_at);
    byMonth.set(m, [...(byMonth.get(m) ?? []), e]);
  }

  return (
    <>
      <PageHeader title="Calendar" description="All scheduled MESA events. Open slots can be claimed by any member.">
        <Link href={past ? "/calendar" : "/calendar?past=1"} className="text-sm text-esn hover:underline self-center">
          {past ? "Hide past events" : "Show past events"}
        </Link>
      </PageHeader>
      {byMonth.size === 0 && (
        <Card>
          <EmptyState>No events scheduled yet.</EmptyState>
        </Card>
      )}
      <div className="space-y-6">
        {[...byMonth].map(([month, list]) => (
          <section key={month} aria-label={monthLabel(month)}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">{monthLabel(month)}</h2>
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-gray-100">
                  {list.map((e) => {
                    const slot = openSlots.get(e.id);
                    const role = myRole.get(e.id);
                    return (
                      <li key={e.id}>
                        <Link href={`/events/${e.id}?from=calendar`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-gray-50">
                          <span className="w-44 shrink-0 text-sm tabular-nums text-gray-600">{formatDateTime(e.starts_at)}</span>
                          <span className="font-medium text-gray-900 min-w-0 break-words">{e.title}</span>
                          <Badge>{EVENT_TYPE_LABELS[e.type]}</Badge>
                          {e.status !== "confirmed" && e.status !== "scheduled" && (
                            <Badge tone={EVENT_STATUS_TONES[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>
                          )}
                          {role && <Badge tone="blue">You: {role === "oc" ? "OC" : "helper"}</Badge>}
                          {slot && (slot.open_oc || slot.open_helpers > 0) && (
                            <Badge tone="amber">
                              {slot.open_oc ? "OC needed" : `${plural(slot.open_helpers, "helper slot")} open`}
                            </Badge>
                          )}
                          <span className="ml-auto text-xs text-gray-500 truncate max-w-[14rem]">{e.location}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
