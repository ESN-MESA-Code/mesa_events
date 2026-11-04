import Link from "next/link";
import { Clock } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { dayLabel, dayRange, isoWeek, venue, weekLabel, type CalEntry, type DayGroup } from "@/lib/calendarView";
import { CATEGORY_STYLE } from "@/lib/calendarStyle";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";

/** The columns right of the day on wide screens: time, event, you, needs, where. */
const COLS = "md:grid-cols-[3.5rem_minmax(0,1fr)_8rem_10.5rem_11rem]";

/**
 * The day list (redesign 2026-11-04): the "List" view on wide screens and
 * the whole calendar on phones. Days are headings (sticky while scrolling),
 * weeks are labelled, each event is one row – time, a bar in its category's
 * colour, title, the viewer's part, what it still needs, and the venue. In
 * the current month the days before today fold away.
 */
export function DayList({ groups, earlier, today, empty }: { groups: DayGroup[]; earlier: DayGroup[]; today: string; empty: string }) {
  if (!groups.length && !earlier.length) return <EmptyState>{empty}</EmptyState>;
  const earlierEvents = earlier.flatMap((g) => g.entries).filter((e) => e.category !== "deadline").length;
  return (
    <div data-testid="calendar-list">
      <div className="hidden border-b border-gray-200 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 md:grid md:grid-cols-[6.5rem_minmax(0,1fr)]">
        <span className="px-4">Day</span>
        <span className={cn("grid gap-x-3 pr-4", COLS)}>
          <span>Time</span>
          <span className="pl-[13px]">Event</span>
          <span>You</span>
          <span>Needs</span>
          <span>Where</span>
        </span>
      </div>
      {earlier.length > 0 && (
        <details className="group/earlier border-b border-gray-100" data-testid="calendar-earlier">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-esn hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
            <span className="group-open/earlier:hidden">
              Show {dayRange(earlier[0].day, earlier[earlier.length - 1].day)}
              {earlierEvents > 0 && <span className="font-normal text-gray-500"> · {plural(earlierEvents, "earlier event")}</span>}
            </span>
            <span className="hidden group-open/earlier:inline">Hide earlier days</span>
          </summary>
          <Days groups={earlier} today={today} />
        </details>
      )}
      <Days groups={groups} today={today} />
    </div>
  );
}

function Days({ groups, today }: { groups: DayGroup[]; today: string }) {
  return groups.map((g, i) => {
    const before = i ? groups[i - 1].day : null;
    const newWeek = !before || isoWeek(before) !== isoWeek(g.day) || g.day.slice(0, 4) !== before.slice(0, 4);
    const isToday = g.day === today;
    const past = g.day < today;
    return (
      <div key={g.day}>
        {newWeek && <p className="border-t border-gray-100 bg-gray-50/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 first:border-t-0">{weekLabel(g.day)}</p>}
        <section id={`day-${g.day}`} data-day={g.day} aria-label={isToday ? `Today, ${dayLabel(g.day)}` : dayLabel(g.day)} className={cn("scroll-mt-2 border-t border-gray-100 md:grid md:grid-cols-[6.5rem_minmax(0,1fr)]", isToday && "bg-esn/[0.04]")}>
          <h3
            className={cn(
              "sticky top-0 z-10 whitespace-nowrap px-4 py-2 text-xs font-semibold md:self-start md:py-3 md:pr-2 md:text-sm",
              isToday ? "bg-[#f5f5fa] text-esn md:bg-transparent" : cn("bg-white/95 backdrop-blur md:bg-transparent", past ? "text-gray-400" : "text-gray-700")
            )}
          >
            {isToday && (
              <span className="md:block md:text-[11px] md:uppercase md:tracking-wide">
                Today<span className="md:hidden"> · </span>
              </span>
            )}
            {dayLabel(g.day)}
          </h3>
          <ul className="divide-y divide-gray-100">
            {g.entries.length ? g.entries.map((e) => <Row key={e.key} e={e} />) : <li className="px-4 py-3 text-sm text-gray-500 md:pl-0">Nothing planned today.</li>}
          </ul>
        </section>
      </div>
    );
  });
}

function Row({ e }: { e: CalEntry }) {
  const style = CATEGORY_STYLE[e.category];
  const needs = e.past ? [] : e.needs;
  const muted = e.cancelled || (e.past && e.category !== "deadline");
  const where = venue(e.place);
  const cls = cn("grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-2.5 md:items-center md:pl-0", COLS);
  const bar = e.cancelled ? "border-gray-300" : style.bar;

  if (e.category === "deadline")
    return (
      <li className={cls} data-testid={e.testId}>
        <span className="pt-px text-sm tabular-nums text-gray-400">{e.time}</span>
        <span className={cn("flex min-w-0 items-center gap-1.5 border-l-[3px] border-dashed pl-3 text-sm md:col-span-4 md:pl-2.5", bar, e.past ? "text-gray-400 line-through" : "font-medium text-red-700")}>
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {e.title}
        </span>
      </li>
    );

  return (
    <li>
      <Link href={e.href!} className={cn(cls, "hover:bg-gray-50")}>
        <span className={cn("pt-px text-sm tabular-nums", muted ? "text-gray-400" : "text-gray-700")}>{e.time}</span>
        <div className={cn("min-w-0 space-y-1 border-l-[3px] pl-3 md:contents", bar)}>
          <span className={cn("block min-w-0 md:truncate md:border-l-[3px] md:pl-2.5", bar)}>
            <span className={cn("font-medium", e.cancelled ? "text-gray-400 line-through" : e.past ? "text-gray-500" : "text-gray-900")}>{e.title}</span>
            {e.typeLabel && <span className="ml-1.5 text-xs text-gray-500">· {e.typeLabel}</span>}
          </span>
          <span className={cn("flex flex-wrap gap-1 md:contents", !e.you && !needs.length && !e.cancelled && "hidden")}>
            <span className="md:block">{e.you && <Badge tone="blue">{e.you}</Badge>}</span>
            <span className="flex flex-wrap gap-1">
              {e.cancelled ? (
                <Badge tone="red">Cancelled</Badge>
              ) : (
                needs.map((n) => (
                  <Badge key={n.text} tone={n.tone}>
                    {n.text}
                  </Badge>
                ))
              )}
            </span>
          </span>
          <span className={cn("block truncate text-xs", muted ? "text-gray-400" : "text-gray-500", !where && "hidden md:block")} title={e.place ?? undefined}>
            {where}
          </span>
        </div>
      </Link>
    </li>
  );
}
