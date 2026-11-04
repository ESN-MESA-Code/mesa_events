"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { revealDay } from "./reveal";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * The phone's month at a glance (redesign 2026-11-04): this week (or the
 * month's first) with a dot per kind of thing on each day; it unfolds to the
 * whole month, and a tap jumps the day list below to that day.
 */
export function MiniMonth({
  weeks,
  today,
  dots,
  startWeek,
}: {
  weeks: Array<Array<{ day: string; inMonth: boolean }>>;
  today: string;
  /** Dot classes per day, at most three. */
  dots: Record<string, string[]>;
  startWeek: number;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const shown = open ? weeks : [weeks[startWeek] ?? weeks[0]];

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white px-2 pt-2 shadow-sm md:hidden" data-testid="mini-month">
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-400" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {shown.flat().map(({ day, inMonth }) => {
          const isToday = day === today;
          const has = dots[day] ?? [];
          return inMonth ? (
            <button
              key={day}
              type="button"
              onClick={() => {
                setPicked(day);
                revealDay(day);
              }}
              aria-label={`${Number(day.slice(8))}${isToday ? ", today" : ""}${has.length ? "" : ", nothing planned"}`}
              className="flex h-12 flex-col items-center justify-center gap-1 rounded-lg active:bg-gray-100"
            >
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums",
                  isToday ? "bg-esn font-semibold text-white" : picked === day ? "ring-2 ring-esn/40 text-gray-900" : day < today ? "text-gray-400" : "text-gray-800"
                )}
              >
                {Number(day.slice(8))}
              </span>
              <span className="flex h-1.5 gap-0.5" aria-hidden="true">
                {has.map((c, i) => (
                  <span key={i} className={cn("h-1.5 w-1.5 rounded-full", c)} />
                ))}
              </span>
            </button>
          ) : (
            <span key={day} aria-hidden="true" className="flex h-12 items-start justify-center pt-2.5 text-sm tabular-nums text-gray-300">
              {Number(day.slice(8))}
            </span>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2 text-xs font-medium text-gray-500 hover:text-esn"
      >
        {open ? (
          <>
            Show one week <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </>
        ) : (
          <>
            Show whole month <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  );
}
