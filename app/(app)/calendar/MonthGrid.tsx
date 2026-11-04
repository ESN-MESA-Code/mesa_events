import Link from "next/link";
import { Clock, UserCheck, UserPlus } from "lucide-react";
import { calendarWeeks } from "@/lib/month";
import { fillWeek, type CalEntry, type Category } from "@/lib/calendarView";
import { CATEGORY_ORDER, CATEGORY_STYLE } from "@/lib/calendarStyle";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Events shown in a day before "+N more" (deadlines always show). */
const MAX_PER_DAY = 3;

/**
 * The month grid on wide screens (redesign 2026-11-04): one line per event –
 * time, title, and small marks for the viewer's part and open slots – with
 * the category as a coloured bar; today stands out, past days turn grey
 * without fading their text, and a busy day links to its place in the list.
 */
export function MonthGrid({ month, today, entries, moreHref }: { month: string; today: string; entries: CalEntry[]; moreHref: (day: string) => string }) {
  const byDay = new Map<string, CalEntry[]>();
  for (const e of entries) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const shown = new Set<Category>(entries.map((e) => e.category));
  const anyYou = entries.some((e) => e.you);
  const anyNeeds = entries.some((e) => e.needs.length && !e.cancelled);

  return (
    <div data-testid="calendar-grid">
      <div className="grid grid-cols-7 gap-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {WEEKDAYS.map((d, i) => (
          <span key={d} className={cn("px-1.5", i >= 5 && "text-gray-400")}>
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {calendarWeeks(month).flatMap((week) =>
          fillWeek(week).map(({ day, inMonth }, i) => {
            if (!inMonth)
              return (
                <div key={day} aria-hidden="true" className="min-h-28 rounded-md border border-gray-100 bg-gray-50/50 p-1.5">
                  <span className="text-xs tabular-nums text-gray-300">{Number(day.slice(8))}</span>
                </div>
              );
            const all = byDay.get(day) ?? [];
            const deadlines = all.filter((e) => e.category === "deadline");
            const events = all.filter((e) => e.category !== "deadline");
            const more = events.length > MAX_PER_DAY ? events.length - (MAX_PER_DAY - 1) : 0;
            const visible = more ? events.slice(0, MAX_PER_DAY - 1) : events;
            const isToday = day === today;
            const past = day < today;
            return (
              <div
                key={day}
                data-testid={`cal-day-${day}`}
                className={cn(
                  "min-h-28 min-w-0 rounded-md border p-1.5",
                  isToday ? "border-esn bg-white ring-1 ring-esn" : past ? "border-gray-100 bg-gray-50" : i >= 5 ? "border-gray-200 bg-slate-50/70" : "border-gray-200 bg-white"
                )}
              >
                <p className="mb-1 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                      isToday ? "bg-esn font-semibold text-white" : past ? "text-gray-400" : "font-medium text-gray-700"
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {isToday && <span className="text-[11px] font-semibold text-esn">Today</span>}
                </p>
                <div className="space-y-1">
                  {deadlines.map((d) => (
                    <p
                      key={d.key}
                      title={`${d.title} (${d.time})`}
                      data-testid={d.testId}
                      className={cn("flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight", CATEGORY_STYLE.deadline.chip, d.past && "border-gray-200 bg-transparent text-gray-400 line-through")}
                    >
                      <Clock className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0">{d.title}</span>
                    </p>
                  ))}
                  {visible.map((e) => (
                    <Chip key={e.key} e={e} />
                  ))}
                  {more > 0 && (
                    <Link href={moreHref(day)} className="block px-1.5 text-[11px] font-medium text-esn hover:underline">
                      +{more} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600" data-testid="calendar-legend">
        {CATEGORY_ORDER.filter((c) => shown.has(c)).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            {c === "deadline" ? <Clock className="h-3.5 w-3.5 text-red-600" aria-hidden="true" /> : <span className={cn("h-2.5 w-2.5 rounded-full", CATEGORY_STYLE[c].dot)} aria-hidden="true" />}
            {CATEGORY_STYLE[c].label}
          </span>
        ))}
        {anyYou && (
          <span className="inline-flex items-center gap-1.5">
            <UserCheck className="h-3.5 w-3.5 text-esn" aria-hidden="true" /> You&apos;re on it
          </span>
        )}
        {anyNeeds && (
          <span className="inline-flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5 text-orange-600" aria-hidden="true" /> Slot open
          </span>
        )}
      </div>
    </div>
  );
}

function Chip({ e }: { e: CalEntry }) {
  const style = CATEGORY_STYLE[e.category];
  const needs = e.cancelled || e.past ? [] : e.needs;
  const label = [`${e.time} ${e.title}`, e.typeLabel, e.you, ...needs.map((n) => n.text), e.cancelled ? "Cancelled" : null].filter(Boolean).join(" · ");
  return (
    <Link
      href={e.href!}
      title={label}
      data-testid={e.testId}
      className={cn(
        "flex min-w-0 items-start gap-1 rounded-r border-l-[3px] px-1.5 py-1 text-[11px] leading-tight",
        e.cancelled ? "border-gray-300 text-gray-400 line-through hover:bg-gray-100" : e.past ? cn(style.bar, "bg-gray-100 text-gray-600 hover:bg-gray-200") : cn(style.bar, style.chip)
      )}
    >
      <span className="line-clamp-2 min-w-0 flex-1 break-words">
        <span className="font-semibold tabular-nums">{e.time}</span> {e.title}
      </span>
      {e.you && (
        <span className="shrink-0 text-esn" title={e.you}>
          <UserCheck className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{e.you}</span>
        </span>
      )}
      {needs.length > 0 && (
        <span className={cn("shrink-0", needs.some((n) => n.tone === "red") ? "text-red-600" : "text-orange-600")} title={needs.map((n) => n.text).join(", ")}>
          <UserPlus className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{needs.map((n) => n.text).join(", ")}</span>
        </span>
      )}
      {e.cancelled && <span className="sr-only">Cancelled</span>}
    </Link>
  );
}
