import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, berlinDate, berlinTime, cycleLabel, formatDate, formatDateTime, monthLabel, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { EVENT_STATUS_LABELS, EVENT_STATUS_TONES, EVENT_TYPE_LABELS } from "@/lib/labels";
import { INTERNAL_KIND_CHIPS, INTERNAL_KIND_LABELS, INTERNAL_KIND_TONES, internalPath, type InternalKind } from "@/lib/internal";
import { calendarWeeks, monthParam, parseMonthParam } from "@/lib/month";
import { Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { CalendarSubscribe } from "@/components/CalendarSubscribe";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOW = { all: "Everything", events: "ESN events", internal: "Internal" } as const;
type Show = keyof typeof SHOW;

// The internal calendar, one month at a time: a month grid or an aligned
// list (?view=list) of every scheduled event (RLS decides what a member
// sees), with the member's own role and open slots anyone can claim; and
// the internal events, meetings and office hours (round 2026-10-30; board
// meetings only for the executive board), and the calendar subscription.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; show?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "calendar";
  const show: Show = sp.show === "events" || sp.show === "internal" ? sp.show : "all";
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const month = parseMonthParam(sp.month) ?? thisMonth;

  const [{ data: events }, { data: internals }, { data: mine }, { data: mineInternal }, { data: slots }, { data: monthsRows }, { data: feed }] = await Promise.all([
    show === "internal"
      ? Promise.resolve({ data: [] })
      : supabase
          .from("events")
          .select("id, title, type, starts_at, location, status, helpers_needed")
          .gte("starts_at", monthStartIso(month))
          .lt("starts_at", nextMonthStartIso(month))
          .neq("status", "draft")
          .neq("status", "dropped")
          // History imported from the bot is for "Get inspired" on /ideas, not the calendar.
          .eq("source", "platform")
          .order("starts_at"),
    show === "events"
      ? Promise.resolve({ data: [] })
      : supabase.from("internal_events").select("id, kind, title, starts_at, location, status").gte("starts_at", monthStartIso(month)).lt("starts_at", nextMonthStartIso(month)).order("starts_at"),
    supabase.from("assignments").select("event_id, role").eq("profile_id", viewer.id).eq("status", "active"),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewer.id),
    supabase.rpc("open_slots"),
    supabase.from("planning_cycles").select("month").order("month"),
    supabase.from("calendar_feeds").select("created_at, last_used_at").eq("profile_id", viewer.id).maybeSingle(),
  ]);

  // The months offered: a year back to the planned cycles ahead (and half a year of internal plans).
  const months = new Set<string>();
  for (let m = addMonths(thisMonth, -12); m <= addMonths(thisMonth, 6); m = addMonths(m, 1)) months.add(m);
  for (const c of monthsRows ?? []) months.add(c.month);
  months.add(month);
  const myRole = new Map((mine ?? []).map((a) => [a.event_id, a.role]));
  const myInternal = new Map((mineInternal ?? []).map((p) => [p.internal_event_id, p.role]));
  const openSlots = new Map((slots ?? []).map((s) => [s.event_id, s]));
  const list = events ?? [];
  const inner = (internals ?? []).map((i) => ({ ...i, kind: i.kind as InternalKind }));
  const today = berlinDate(new Date(now).toISOString());
  const query = (o: { view?: string; show?: Show }) => {
    const v = o.view ?? view;
    const s = o.show ?? show;
    return `/calendar?month=${monthParam(month)}${v === "list" ? "&view=list" : ""}${s !== "all" ? `&show=${s}` : ""}`;
  };
  // ESN events and internal ones in one list, by time.
  const rows = [
    ...list.map((e) => ({ at: e.starts_at, key: `e-${e.id}`, event: e, internal: null })),
    ...inner.map((i) => ({ at: i.starts_at, key: `i-${i.id}`, event: null, internal: i })),
  ].sort((a, b) => a.at.localeCompare(b.at));

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
  const internalRole = (id: string) => {
    const r = myInternal.get(id);
    return r ? <Badge tone="blue">{r === "oc" ? "OC" : r === "helper" ? "helper" : "signed up"}</Badge> : null;
  };

  return (
    <>
      <PageHeader title="Calendar" description="All scheduled MESA events, and the internal events, meetings and office hours. Open slots can be claimed by any member.">
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Show" className="flex rounded-md border border-gray-300 text-sm" data-testid="calendar-show">
            {(Object.keys(SHOW) as Show[]).map((s) => (
              <Link key={s} href={query({ show: s })} aria-current={show === s ? "page" : undefined} className={cn("px-3 py-1.5 first:rounded-l-md last:rounded-r-md", show === s ? "bg-esn text-white" : "bg-white text-gray-700 hover:text-esn")}>
                {SHOW[s]}
              </Link>
            ))}
          </nav>
          <nav aria-label="View" className="flex rounded-md border border-gray-300 text-sm">
            {(["calendar", "list"] as const).map((v) => (
              <Link key={v} href={query({ view: v })} aria-current={view === v ? "page" : undefined} className={cn("px-3 py-1.5 first:rounded-l-md last:rounded-r-md", view === v ? "bg-esn text-white" : "bg-white text-gray-700 hover:text-esn")}>
                {v === "calendar" ? "Calendar" : "List"}
              </Link>
            ))}
          </nav>
          <MonthSelector
            options={[...months].sort().map((m) => ({ value: monthParam(m), label: monthLabel(m), href: `/calendar?month=${monthParam(m)}${view === "list" ? "&view=list" : ""}${show !== "all" ? `&show=${show}` : ""}` }))}
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
                        {inner
                          .filter((e) => berlinDate(e.starts_at) === day)
                          .map((e) => (
                            <Link
                              key={e.id}
                              href={internalPath(e.kind, e.id)}
                              data-testid={`cal-internal-${e.kind}`}
                              className={cn("block rounded border px-1.5 py-1 text-[11px] leading-tight", e.status === "cancelled" ? "border-gray-200 bg-gray-100 text-gray-500 line-through" : INTERNAL_KIND_CHIPS[e.kind])}
                            >
                              <span className="font-semibold tabular-nums">{berlinTime(e.starts_at)}</span> {e.title}
                              <span className="mt-0.5 flex flex-wrap gap-0.5">{internalRole(e.id)}</span>
                            </Link>
                          ))}
                      </div>
                    ) : (
                      <div key={`blank-${i}`} aria-hidden="true" />
                    )
                  )}
              </div>
              {show !== "events" && (
                <p className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
                  <span className="rounded border border-esn/30 bg-esn/10 px-1.5 text-esn-dark">ESN event</span>
                  {(Object.keys(INTERNAL_KIND_LABELS) as InternalKind[])
                    .filter((k) => inner.some((e) => e.kind === k))
                    .map((k) => (
                      <span key={k} className={cn("rounded border px-1.5", INTERNAL_KIND_CHIPS[k])}>
                        {INTERNAL_KIND_LABELS[k]}
                      </span>
                    ))}
                </p>
              )}
            </div>
            {/* Phones: the days with events as a list. */}
            <ol className="sm:hidden divide-y divide-gray-100">
              {!rows.length && <EmptyState>Nothing in {monthLabel(month)}.</EmptyState>}
              {rows.map((r) =>
                r.event ? (
                  <li key={r.key}>
                    <Link href={`/events/${r.event.id}?from=calendar`} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="w-24 text-sm tabular-nums text-gray-600">{formatDateTime(r.event.starts_at).slice(0, 10)}</span>
                      <span className="font-medium">{r.event.title}</span>
                      {chipsFor(r.event, true)}
                    </Link>
                  </li>
                ) : (
                  <li key={r.key}>
                    <Link href={internalPath(r.internal!.kind, r.internal!.id)} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="w-24 text-sm tabular-nums text-gray-600">{formatDateTime(r.internal!.starts_at).slice(0, 10)}</span>
                      <span className="font-medium">{r.internal!.title}</span>
                      <Badge tone={INTERNAL_KIND_TONES[r.internal!.kind]}>{INTERNAL_KIND_LABELS[r.internal!.kind]}</Badge>
                      {internalRole(r.internal!.id)}
                    </Link>
                  </li>
                )
              )}
            </ol>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {!rows.length ? (
              <EmptyState>Nothing in {monthLabel(month)}.</EmptyState>
            ) : (
              // One grid for all rows: date, title, type, status/role/slot and place line up in columns.
              <ul className="divide-y divide-gray-100" data-testid="calendar-list">
                {rows.map((r) => {
                  const e = r.event;
                  const i = r.internal;
                  return (
                    <li key={r.key}>
                      <Link
                        href={e ? `/events/${e.id}?from=calendar` : internalPath(i!.kind, i!.id)}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-gray-50 md:grid-cols-[11rem_minmax(0,1fr)_7.5rem_13rem_12rem]"
                      >
                        <span className="col-span-2 text-sm tabular-nums text-gray-600 md:col-span-1">{formatDateTime(r.at)}</span>
                        <span className="min-w-0 truncate font-medium text-gray-900">{e?.title ?? i!.title}</span>
                        <span>{e ? <Badge>{EVENT_TYPE_LABELS[e.type]}</Badge> : <Badge tone={INTERNAL_KIND_TONES[i!.kind]}>{INTERNAL_KIND_LABELS[i!.kind]}</Badge>}</span>
                        <span className="col-span-2 flex flex-wrap gap-1 md:col-span-1">
                          {e ? (
                            <>
                              {e.status !== "confirmed" && e.status !== "scheduled" && <Badge tone={EVENT_STATUS_TONES[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>}
                              {chipsFor(e, false)}
                            </>
                          ) : (
                            <>
                              {i!.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
                              {internalRole(i!.id)}
                            </>
                          )}
                        </span>
                        <span className="col-span-2 truncate text-xs text-gray-500 md:col-span-1">{e?.location ?? i!.location}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <CalendarSubscribe feed={feed ? { since: formatDate(feed.created_at), lastUsed: feed.last_used_at ? formatDateTime(feed.last_used_at) : null } : null} />
      </div>
    </>
  );
}
