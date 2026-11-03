import Link from "next/link";
import { Badge } from "@/components/ui";
import { DESCRIPTION_STATUS, EventStatusBadge } from "@/components/status";
import { formatDateTime, formatShortDate } from "@/lib/dates";
import { plural } from "@/lib/plural";
import type { MonthEvent } from "@/lib/monthEvents";
import { cn } from "@/lib/utils";

/** "reminded Tue 3 Nov" – the last automatic reminder (round 2026-11-03), or nothing. */
function Reminded({ at }: { at?: string }) {
  return at ? (
    <span className="text-gray-500" data-testid="reminded">
      reminded {formatShortDate(at)}
    </span>
  ) : null;
}

/**
 * One event of the month on the Descriptions tab (review 2026-11-03 #1): title first (on phones the date moves into the
 * line below it, #13), OC and staffing, then what `show` asks for, with when
 * the OC was last reminded. Reminders are automatic – no buttons.
 */
export function MonthEventRow({
  e,
  cycleId,
  show,
  href,
}: {
  e: MonthEvent;
  cycleId: string;
  show: { description?: boolean; handIn?: boolean };
  /** Where the title leads (default: the event page). */
  href?: string;
}) {
  const desc = DESCRIPTION_STATUS[e.description] ?? { label: e.description, tone: "gray" as const };
  const descRed = e.descOpen && (e.deadlinePassed || e.descriptionLate);
  return (
    <li className="grid gap-x-3 gap-y-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center" data-testid={`month-event-${e.id}`} data-problem={e.staffOpen || e.descOpen || e.handInOpen || undefined}>
      <span className="hidden tabular-nums text-gray-600 sm:block">{formatDateTime(e.startsAt)}</span>
      <span className="min-w-0">
        <Link href={href ?? `/events/${e.id}?from=cycle:${cycleId}`} className="font-medium text-gray-900 hover:text-esn">
          {e.title}
        </Link>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          <span className="tabular-nums sm:hidden">{formatDateTime(e.startsAt)}</span>
          <span className={e.staffOpen ? "font-medium text-amber-800" : undefined} data-testid="staffing">
            {e.confirmed ? `${e.oc ? `OC ${e.oc}` : "no OC"} · ${e.helpers}/${e.helpersNeeded} helpers` : `${plural(e.helpersNeeded, "helper")} needed`}
          </span>
          {show.description && e.confirmed && (
            <span data-testid="description">
              Description:{" "}
              <Badge tone={e.descOpen ? (descRed ? "red" : "amber") : desc.tone} className="align-middle">
                {desc.label}
              </Badge>
              {e.descriptionLate && e.descOpen && (
                <Badge tone="red" className="ml-1 align-middle">
                  late
                </Badge>
              )}
            </span>
          )}
          {show.description && e.descOpen && <Reminded at={e.reminded.description} />}
          {show.handIn && e.confirmed && (
            <span data-testid="handin" className={e.handInOpen ? "font-medium text-amber-800" : undefined}>
              Hand-in: {!e.running ? "–" : !e.started ? "after the event" : e.missing.length ? `missing ${e.missing.join(", ")}` : "✓ handed in"}
            </span>
          )}
          {show.handIn && e.handInOpen && <Reminded at={e.reminded.handin} />}
        </span>
      </span>
      <span className="justify-self-start sm:justify-self-end">
        <EventStatusBadge status={e.status} />
      </span>
    </li>
  );
}

const PARTS = [
  ["list", "Attendance list"],
  ["photos", "Photos"],
  ["report", "Event report"],
] as const;

/** The hand-in's column names, the first item of the list (desktop). */
export function HandInHeader() {
  return (
    <li aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_repeat(3,7rem)] gap-3 pt-2 pb-1 text-[11px] text-gray-500 sm:grid">
      <span>Event</span>
      {PARTS.map(([, label]) => (
        <span key={label} className="text-center">
          {label}
        </span>
      ))}
    </li>
  );
}

/**
 * One event on the Hand-in tab (round 2026-11-03): a checklist of the three
 * parts the OC hands in – columns on desktop, chips on phones – with the OC
 * and the last automatic reminder.
 */
export function HandInRow({ e, cycleId }: { e: MonthEvent; cycleId: string }) {
  const parts = e.handIn;
  return (
    <li className="grid gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] sm:items-center" data-testid={`month-event-${e.id}`}>
      <span className="min-w-0">
        <Link href={`/events/${e.id}/hand-in?from=cycle:${cycleId}`} className="font-medium text-gray-900 hover:text-esn">
          {e.title}
        </Link>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-600">
          <span className="tabular-nums">{formatDateTime(e.startsAt)}</span>
          <span>{e.oc ? `OC ${e.oc}` : "no OC"}</span>
          {e.handInOpen && <Reminded at={e.reminded.handin} />}
        </span>
        {/* Screen readers and the tests read the whole state in one line. */}
        <span className="sr-only" data-testid="handin">
          Hand-in: {!parts ? "after the event" : e.missing.length ? `missing ${e.missing.join(", ")}` : "✓ handed in"}
        </span>
      </span>
      {PARTS.map(([k, label]) => {
        const state = !parts ? "ahead" : parts[k] ? "in" : "missing";
        return (
          <span key={k} className="flex items-center gap-1.5 text-xs sm:justify-center" aria-hidden="true">
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                state === "in" && "bg-emerald-100 text-emerald-700",
                state === "missing" && "bg-amber-100 text-amber-800",
                state === "ahead" && "bg-gray-100 text-gray-400"
              )}
            >
              {state === "in" ? "✓" : state === "missing" ? "!" : "–"}
            </span>
            <span className={cn("sm:hidden", state === "missing" ? "text-amber-800" : "text-gray-600")}>{label}</span>
          </span>
        );
      })}
    </li>
  );
}

/** A titled group of rows ("Waiting for the OC", "Handed in" …). */
export function MonthEventGroup({ title, count, tone, testId, hint, children }: { title: string; count: number; tone?: "amber" | "green" | "blue"; testId?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId}>
      <h3 className="flex items-center gap-2 border-b border-gray-100 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
        <Badge tone={tone}>{count}</Badge>
        {hint && <span className="ml-auto font-normal normal-case tracking-normal text-gray-500">{hint}</span>}
      </h3>
      <ul className="divide-y divide-gray-100 text-sm">{children}</ul>
    </section>
  );
}
