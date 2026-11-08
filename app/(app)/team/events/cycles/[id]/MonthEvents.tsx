import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { DateTile } from "@/components/DateTile";
import { PanelGroup } from "@/components/Panel";
import { DESCRIPTION_STATUS } from "@/components/status";
import { berlinTime, formatShortDate } from "@/lib/dates";
import type { MonthEvent } from "@/lib/monthEvents";
import { cn } from "@/lib/utils";

/** "reminded Tue 3 Nov" – the last automatic reminder (round 2026-11-03), or nothing. */
export function Reminded({ at }: { at?: string }) {
  return at ? (
    <span className="text-gray-500" data-testid="reminded">
      reminded {formatShortDate(at)}
    </span>
  ) : null;
}

/** "OC Anna · 1/2 helpers" (amber while people are missing). */
export function Staffing({ e }: { e: MonthEvent }) {
  return (
    <span className={e.staffOpen ? "font-medium text-amber-800" : undefined} data-testid="staffing">
      {e.oc ? `OC ${e.oc}` : "no OC"} · {e.helpers}/{e.helpersNeeded} helpers
    </span>
  );
}

/**
 * One event of the month on the Descriptions and Hand-in tabs (redesign
 * 2026-11-08): a date tile, the time and staffing above the title, a line of
 * details below it, and what is open on the right.
 */
export function EventLine({
  e,
  href,
  meta,
  aside,
  muted,
  className,
}: {
  e: MonthEvent;
  href: string;
  meta?: React.ReactNode;
  aside?: React.ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <li className={cn("flex gap-3 py-3", className)} data-testid={`month-event-${e.id}`}>
      <DateTile iso={e.startsAt} tone={muted ? "muted" : "default"} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="truncate text-xs font-medium tabular-nums text-gray-600">
            {berlinTime(e.startsAt)} · <Staffing e={e} />
          </p>
          <Link href={href} className="font-semibold leading-snug text-gray-900 hover:text-esn">
            {e.title}
          </Link>
          {meta && <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">{meta}</p>}
        </div>
        {aside}
      </div>
    </li>
  );
}

/** "Description: Waiting for Comms review" for screen readers and the tests. */
export function DescriptionState({ e }: { e: MonthEvent }) {
  const desc = DESCRIPTION_STATUS[e.description] ?? { label: e.description };
  return (
    <span className="sr-only" data-testid="description">
      Description: {desc.label}
    </span>
  );
}

const PARTS = [
  ["list", "Attendance list"],
  ["photos", "Photos"],
  ["report", "Event report"],
] as const;

/**
 * One event on the Hand-in tab (round 2026-11-03): the three parts the OC
 * hands in – attendance list, photos, event report – as chips, with the OC
 * and the last automatic reminder.
 */
export function HandInRow({ e, cycleId }: { e: MonthEvent; cycleId: string }) {
  const parts = e.handIn;
  return (
    <EventLine
      e={e}
      href={`/events/${e.id}/hand-in?from=cycle:${cycleId}`}
      muted={!e.handInOpen}
      meta={
        <>
          {e.handInOpen && <Reminded at={e.reminded.handin} />}
          {/* Screen readers and the tests read the whole state in one line. */}
          <span className="sr-only" data-testid="handin">
            Hand-in: {!parts ? "after the event" : e.missing.length ? `missing ${e.missing.join(", ")}` : "✓ handed in"}
          </span>
        </>
      }
      aside={
        <ul className="flex flex-wrap gap-1.5" aria-hidden="true">
          {PARTS.map(([k, label]) => {
            const state = !parts ? "ahead" : parts[k] ? "in" : "missing";
            return (
              <li
                key={k}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                  state === "in" && "bg-emerald-50 text-emerald-800",
                  state === "missing" && "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
                  state === "ahead" && "bg-gray-100 text-gray-500"
                )}
              >
                {state === "in" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : state === "missing" ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : <Minus className="h-3.5 w-3.5" />}
                {label}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}

/** A titled group of rows ("Missing something", "Handed in" …). */
export function MonthEventGroup({ title, count, tone, testId, hint, children }: { title: string; count: number; tone?: "amber" | "green" | "blue"; testId?: string; hint?: string; children: React.ReactNode }) {
  return (
    <PanelGroup title={title} count={count} tone={tone === "blue" ? "gray" : tone} hint={hint} testId={testId}>
      <ul className="divide-y divide-gray-100 text-sm">{children}</ul>
    </PanelGroup>
  );
}
