import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, berlinDate, berlinTime, cycleLabel, formatDateTime, monthLabel, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { calendarWeeks, monthParam, parseMonthParam } from "@/lib/month";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The internal calendar, one month at a time: a month grid or an aligned
// list (?view=list) of every scheduled event (RLS decides what a member
// sees), with the member's own role and open slots anyone can claim.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "calendar";
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const month = parseMonthParam(sp.month) ?? thisMonth;

  const [{ data: events }, { data: mine }, { data: slots }, { data: monthsRows }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, type, starts_at, location, status, helpers_needed")
      .gte("starts_at", monthStartIso(month))
      .lt("starts_at", nextMonthStartIso(month))
      .neq("status", "draft")
      .neq("status", "dropped")
      // History imported from the bot is for "Get inspired" on /ideas, not the calendar.
      .eq("source", "platform")
      .order("starts_at"),
    supabase.from("assignments").select("event_id, role").eq("profile_id", viewer.id).eq("status", "active"),
    supabase.rpc("open_slots"),
    supabase.from("planning_cycles").select("month").order("month"),
  ]);

  // The months offered: a year back to the planned cycles ahead.
  const months = new Set<string>();
  for (let m = addMonths(thisMonth, -12); m <= thisMonth; m = addMonths(m, 1)) months.add(m);
  for (const c of monthsRows ?? []) months.add(c.month);
  months.add(month);
  const myRole = new Map((mine ?? []).map((a) => [a.event_id, a.role]));
  const openSlots = new Map((slots ?? []).map((s) => [s.event_id, s]));
  const list = events ?? [];
  const today = berlinDate(new Date(now).toISOString());
  const href = (v: string) => `/calendar?month=${monthParam(month)}${v === "list" ? "&view=list" : ""}`;

  const chipsFor = (e: (typeof list)[number], small = false) => {
    const slot = openSlots.get(e.id);
    const role = myRole.get(e.id);
    return (
      <>
        {role && <Badge tone="blue">{small ? (role === "oc" ? "OC" : "helper") : `You: ${role === "oc" ? "OC" : "helper"}`}</Badge>}
        {slot && (slot.open_oc || slot.open_helpers > 0) && <Badge tone="amber">{slot.open_oc ? "OC needed" : small ? "slot open" : `${plural(slot.open_helpers, "helper slot")} open`}</Badge>}
      </>
    );
  };

  return (
    <>
      <PageHeader title="Calendar" description="All scheduled MESA events. Open slots can be claimed by any member.">
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="View" className="flex rounded-md border border-gray-300 text-sm">
            {(["calendar", "list"] as const).map((v) => (
              <Link key={v} href={href(v)} aria-current={view === v ? "page" : undefined} className={cn("px-3 py-1.5 first:rounded-l-md last:rounded-r-md", view === v ? "bg-esn text-white" : "bg-white text-gray-700 hover:text-esn")}>
                {v === "calendar" ? "Calendar" : "List"}
              </Link>
            ))}
          </nav>
          <MonthSelector
            options={[...months].sort().map((m) => ({ value: monthParam(m), label: monthLabel(m), href: `/calendar?month=${monthParam(m)}${view === "list" ? "&view=list" : ""}` }))}
            current={monthParam(month)}
            path="/calendar"
            storageKey="mesa:month:calendar"
            explicit={!!parseMonthParam(sp.month)}
          />
        </div>
      </PageHeader>

      {view === "calendar" ? (
        <Card>
          <CardContent className="pt-4">
            <h2 className="sr-only">{cycleLabel(month)}</h2>
            <div className="hidden sm:block" data-testid="calendar-grid">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-gray-500">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {calendarWeeks(month)
                  .flat()
                  .map((day, i) =>
                    day ? (
                      <div key={day} className={cn("min-h-24 rounded-md border border-gray-200 p-1 space-y-1", day < today ? "bg-gray-50" : "bg-white")}>
                        <p className={cn("text-[11px] font-semibold tabular-nums", day === today ? "text-esn" : "text-gray-500")}>{Number(day.slice(8))}</p>
                        {list
                          .filter((e) => berlinDate(e.starts_at) === day)
                          .map((e) => (
                            <Link
                              key={e.id}
                              href={`/events/${e.id}?from=calendar`}
                              className={cn(
                                "block rounded border px-1.5 py-1 text-[11px] leading-tight",
                                e.status === "cancelled" ? "border-gray-200 bg-gray-100 text-gray-500 line-through" : "border-esn/30 bg-esn/10 text-esn-dark hover:bg-esn/20"
                              )}
                            >
                              <span className="font-semibold tabular-nums">{berlinTime(e.starts_at)}</span> {e.title}
                              <span className="mt-0.5 flex flex-wrap gap-0.5">{chipsFor(e, true)}</span>
                            </Link>
                          ))}
                      </div>
                    ) : (
                      <div key={`blank-${i}`} aria-hidden="true" />
                    )
                  )}
              </div>
            </div>
            {/* Phones: the days with events as a list. */}
            <ol className="sm:hidden divide-y divide-gray-100">
              {!list.length && <EmptyState>No events in {monthLabel(month)}.</EmptyState>}
              {list.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}?from=calendar`} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-24 text-sm tabular-nums text-gray-600">{formatDateTime(e.starts_at).slice(0, 10)}</span>
                    <span className="font-medium">{e.title}</span>
                    {chipsFor(e, true)}
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {!list.length ? (
              <EmptyState>No events in {monthLabel(month)}.</EmptyState>
            ) : (
              // One grid for all rows: date, title, type, status/role/slot and place line up in columns.
              <ul className="divide-y divide-gray-100" data-testid="calendar-list">
                {list.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/events/${e.id}?from=calendar`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-gray-50 md:grid-cols-[11rem_minmax(0,1fr)_7.5rem_13rem_12rem]"
                    >
                      <span className="col-span-2 text-sm tabular-nums text-gray-600 md:col-span-1">{formatDateTime(e.starts_at)}</span>
                      <span className="min-w-0 truncate font-medium text-gray-900">{e.title}</span>
                      <span>
                        <Badge>{EVENT_TYPE_LABELS[e.type]}</Badge>
                      </span>
                      <span className="col-span-2 flex flex-wrap gap-1 md:col-span-1">
                        {e.status !== "confirmed" && e.status !== "scheduled" && <Badge tone={EVENT_STATUS_TONES[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>}
                        {chipsFor(e, false)}
                      </span>
                      <span className="col-span-2 truncate text-xs text-gray-500 md:col-span-1">{e.location}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
