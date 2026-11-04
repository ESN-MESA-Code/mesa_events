import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, berlinDate, berlinTime, formatDate, formatDateTime, monthLabel, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { INTERNAL_KIND_LABELS, internalPath, type InternalKind } from "@/lib/internal";
import { calendarWeeks, monthParam, parseMonthParam } from "@/lib/month";
import { fillWeek, groupByDay, splitEarlier, typeLabelFor, withToday, type CalEntry, type Category } from "@/lib/calendarView";
import { CATEGORY_ORDER, CATEGORY_STYLE } from "@/lib/calendarStyle";
import { buttonVariants, Card, CardContent, PageHeader } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { CalendarSubscribe } from "@/components/CalendarSubscribe";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { cycleTimeline, milestones } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { MonthGrid } from "./MonthGrid";
import { DayList } from "./DayList";
import { MiniMonth } from "./MiniMonth";
import { RevealOnHash } from "./RevealOnHash";

export const metadata: Metadata = { title: "Calendar" };

const SHOW = { all: "Everything", events: "ESN events", internal: "Internal", mine: "Mine" } as const;
type Show = keyof typeof SHOW;

// The internal calendar, one month at a time (redesign 2026-11-04): on wide
// screens a month grid or a day list (?view=list); on phones a mini month
// over the day list. Every scheduled event (RLS decides what a member sees)
// with the member's own part and the open slots anyone can claim; the
// office hours (ESN events, under "ESN events"), the internal events and
// meetings (board meetings only for the executive board); next month's cycle deadlines on their days; "Mine" for
// what the member is part of; and the calendar subscription.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; show?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "calendar";
  const show: Show = sp.show === "events" || sp.show === "internal" || sp.show === "mine" ? sp.show : "all";
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  // From the 25th on it opens on the next month (usability review #13).
  const defaultMonth = Number(berlinDate(new Date(now).toISOString()).slice(8)) >= 25 ? addMonths(thisMonth, 1) : thisMonth;
  const month = parseMonthParam(sp.month) ?? defaultMonth;

  const [{ data: events }, { data: internals }, { data: mine }, { data: mineInternal }, { data: slots }, { data: monthsRows }, { data: feed }, days] = await Promise.all([
    show === "internal"
      ? Promise.resolve({ data: [] })
      : supabase
          .from("events")
          .select("id, title, type, starts_at, location, status")
          .gte("starts_at", monthStartIso(month))
          .lt("starts_at", nextMonthStartIso(month))
          .neq("status", "draft")
          .neq("status", "dropped")
          // History imported from the bot is for "Get inspired" on /ideas, not the calendar.
          .eq("source", "platform")
          .order("starts_at"),
    // Office hours are ESN events (the office is open to students), not internal ones (2026-11-04).
    (() => {
      const q = supabase.from("internal_events").select("id, kind, title, starts_at, location, status").gte("starts_at", monthStartIso(month)).lt("starts_at", nextMonthStartIso(month));
      return (show === "events" ? q.eq("kind", "office_hour") : show === "internal" ? q.neq("kind", "office_hour") : q).order("starts_at");
    })(),
    supabase.from("assignments").select("event_id, role").eq("profile_id", viewer.id).eq("status", "active"),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewer.id),
    supabase.rpc("open_slots"),
    supabase.from("planning_cycles").select("month").order("month"),
    supabase.from("calendar_feeds").select("created_at, last_used_at").eq("profile_id", viewer.id).maybeSingle(),
    loadTimelineDays(supabase),
  ]);

  // The months offered: a year back to the planned cycles ahead (and half a year of internal plans).
  const months = new Set<string>();
  for (let m = addMonths(thisMonth, -12); m <= addMonths(thisMonth, 6); m = addMonths(m, 1)) months.add(m);
  // Planned cycles up to a year ahead (test cycles years ahead stay out).
  for (const c of monthsRows ?? []) if (c.month <= addMonths(thisMonth, 12)) months.add(c.month);
  months.add(month);
  const myRole = new Map((mine ?? []).map((a) => [a.event_id, a.role]));
  const myInternal = new Map((mineInternal ?? []).map((p) => [p.internal_event_id, p.role]));
  const openSlots = new Map((slots ?? []).map((s) => [s.event_id, s]));
  const today = berlinDate(new Date(now).toISOString());

  // Everything in the month as entries: ESN events, internal ones, and the
  // deadlines of next month's cycle, which fall in this month (round 2026-11-02).
  const esnEntries: CalEntry[] = (events ?? []).map((e) => {
    const slot = openSlots.get(e.id);
    const role = myRole.get(e.id);
    const upcoming = Date.parse(e.starts_at) > now;
    const needs: CalEntry["needs"] = [];
    if (upcoming && slot?.open_oc) needs.push({ text: "OC needed", tone: "red" });
    if (upcoming && slot && slot.open_helpers > 0) needs.push({ text: `${plural(slot.open_helpers, "helper slot")} open`, tone: "amber" });
    if (upcoming && !needs.length && e.status === "understaffed") needs.push({ text: "Under-staffed", tone: "amber" });
    const day = berlinDate(e.starts_at);
    return {
      key: `e-${e.id}`,
      day,
      time: berlinTime(e.starts_at),
      at: e.starts_at,
      title: e.title,
      href: `/events/${e.id}?from=calendar`,
      category: "esn",
      typeLabel: e.type === "standard" ? null : EVENT_TYPE_LABELS[e.type],
      cancelled: e.status === "cancelled",
      past: day < today,
      you: role ? `You: ${role === "oc" ? "OC" : "helper"}` : null,
      needs,
      place: e.location,
    };
  });
  const internalEntries: CalEntry[] = (internals ?? []).map((i) => {
    const kind = i.kind as InternalKind;
    const role = myInternal.get(i.id);
    const day = berlinDate(i.starts_at);
    return {
      key: `i-${i.id}`,
      day,
      time: berlinTime(i.starts_at),
      at: i.starts_at,
      title: i.title,
      href: internalPath(kind, i.id),
      category: kind,
      typeLabel: typeLabelFor(i.title, INTERNAL_KIND_LABELS[kind]),
      cancelled: i.status === "cancelled",
      past: day < today,
      you: role ? `You: ${role === "oc" ? "OC" : role === "helper" ? "helper" : "signed up"}` : null,
      needs: [],
      place: i.location,
      testId: `cal-internal-${kind}`,
    };
  });
  const short = monthLabel(addMonths(month, 1)).split(" ")[0];
  const deadlineEntries: CalEntry[] =
    show === "internal"
      ? []
      : milestones(cycleTimeline(addMonths(month, 1), days), now).map((m) => ({
          key: `d-${m.id}`,
          day: berlinDate(m.at),
          time: berlinTime(m.at),
          at: m.at,
          title: m.id === "ideas" ? `Ideas for ${short} due` : m.id === "formOpens" ? `Volunteer form for ${short} opens` : m.id === "formCloses" ? `Sign-up for ${short} closes` : `${short} descriptions due`,
          href: null,
          category: "deadline",
          typeLabel: null,
          cancelled: false,
          past: m.state === "passed",
          you: null,
          needs: [],
          place: null,
          testId: `cal-deadline-${m.id}`,
        }));
  const entries = [...esnEntries, ...internalEntries].filter((e) => show !== "mine" || e.you).concat(deadlineEntries);
  const hasEvents = entries.some((e) => e.category !== "deadline");

  const groups = hasEvents ? withToday(groupByDay(entries), today, month) : groupByDay(entries);
  const { earlier, rest } = splitEarlier(groups, today, month === thisMonth);
  const weeks = calendarWeeks(month).map(fillWeek);
  const dots: Record<string, string[]> = {};
  for (const g of groups) {
    const cats = new Set<Category>(g.entries.filter((e) => !e.cancelled).map((e) => e.category));
    dots[g.day] = CATEGORY_ORDER.filter((c) => cats.has(c))
      .sort((a, b) => Number(b === "deadline") - Number(a === "deadline"))
      .slice(0, 3)
      .map((c) => CATEGORY_STYLE[c].dot);
  }
  const startWeek = Math.max(0, weeks.findIndex((w) => w.some((d) => d.inMonth && d.day === today)));

  const query = (o: { view?: string; show?: Show; month?: string }) => {
    const v = o.view ?? view;
    const s = o.show ?? show;
    return `/calendar?month=${monthParam(o.month ?? month)}${v === "list" ? "&view=list" : ""}${s !== "all" ? `&show=${s}` : ""}`;
  };
  const segment = (active: boolean) =>
    cn("flex-1 px-2.5 py-1.5 text-center whitespace-nowrap first:rounded-l-md last:rounded-r-md md:flex-none md:px-3", active ? "bg-esn text-white" : "bg-white text-gray-700 hover:text-esn");
  const empty = show === "mine" ? `You're not part of anything in ${monthLabel(month)}.` : `Nothing in ${monthLabel(month)}.`;
  const subscribe = <CalendarSubscribe feed={feed ? { since: formatDate(feed.created_at), lastUsed: feed.last_used_at ? formatDateTime(feed.last_used_at) : null } : null} />;

  return (
    <>
      <PageHeader title="Calendar" description={<span className="hidden sm:inline">ESN events and office hours, internal events and meetings. Any member can claim an open slot.</span>} />

      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
          <h2 className="sr-only">{monthLabel(month)}</h2>
          <MonthSelector
            title
            options={[...months].sort().map((m) => ({ value: monthParam(m), label: monthLabel(m), href: query({ month: m }) }))}
            current={monthParam(month)}
            path="/calendar"
            storageKey="mesa:month:calendar"
            explicit={!!parseMonthParam(sp.month)}
          />
          <Link href={`${query({ month: thisMonth })}#day-${today}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto md:ml-1")} data-testid="calendar-today">
            Today
          </Link>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
          <nav aria-label="Show" className="flex w-full rounded-md border border-gray-300 text-sm md:w-auto" data-testid="calendar-show">
            {(Object.keys(SHOW) as Show[]).map((s) => (
              <Link key={s} href={query({ show: s })} aria-current={show === s ? "page" : undefined} className={segment(show === s)}>
                {SHOW[s]}
              </Link>
            ))}
          </nav>
          <nav aria-label="View" className="hidden rounded-md border border-gray-300 text-sm md:flex">
            {(["calendar", "list"] as const).map((v) => (
              <Link key={v} href={query({ view: v })} aria-current={view === v ? "page" : undefined} className={segment(view === v)}>
                {v === "calendar" ? "Month" : "List"}
              </Link>
            ))}
          </nav>
          <div className="hidden md:block">{subscribe}</div>
        </div>
      </div>

      <MiniMonth weeks={weeks} today={today} dots={dots} startWeek={startWeek} />

      <Card>
        {view === "calendar" && (
          <CardContent className="hidden pt-4 md:block">
            <MonthGrid month={month} today={today} entries={entries} moreHref={(day) => `${query({ view: "list" })}#day-${day}`} />
          </CardContent>
        )}
        <div className={cn(view === "calendar" && "md:hidden")}>
          <DayList groups={rest} earlier={earlier} today={today} empty={empty} />
        </div>
      </Card>
      <RevealOnHash page={query({})} />

      {/* Phones: subscribing sits under the list, not in the crowded top rows. Left-aligned so its panel fits. */}
      <div className="mt-6 space-y-2 md:hidden">
        <p className="text-sm text-gray-500">Want these in your phone&apos;s calendar app?</p>
        {subscribe}
      </div>
    </>
  );
}
