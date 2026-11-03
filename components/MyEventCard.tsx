// One of the member's events with its next step (round 2026-11-03 (2)):
// the card on My events, a short row on Home. Moved out of Home.
import Link from "next/link";
import { berlinTime, formatCents, formatShortDate } from "@/lib/dates";
import type { NextStep } from "@/lib/checklist";
import type { MyDuty, MyEvent } from "@/lib/myEventsLoad";
import { INTERNAL_KIND_LABELS, internalPath } from "@/lib/internal";
import { eventMeeting, meetingShort } from "@/lib/meeting";
import { plural } from "@/lib/plural";
import { Badge, buttonVariants } from "@/components/ui";
import { DueLabel, EventStatusBadge } from "@/components/status";
import { StepIcon } from "@/components/StepIcon";
import { cn } from "@/lib/utils";

export const STEP_TONE: Record<NextStep["kind"], string> = {
  action: "border-esn/30 bg-esn/5 text-esn-dark",
  waiting: "border-gray-200 bg-gray-50 text-gray-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

/** Statuses worth a badge; the next step says the rest. */
const NOTEWORTHY = ["understaffed", "cancelled", "dropped"];

export function stepHref(eventId: string, step: Pick<NextStep, "tab">, from: string): string {
  return `/events/${eventId}${step.tab ? `/${step.tab}` : ""}?from=${from}`;
}

/** An event's day as a small calendar leaf ("Nov / 3 / Tue"). */
export function DateTile({ iso, live }: { iso: string; live: boolean }) {
  const [weekday, day, month] = formatShortDate(iso).split(" ");
  return (
    <div
      className={cn("flex w-12 shrink-0 flex-col items-center self-start rounded-lg py-1.5 leading-tight", live ? "bg-esn-orange/10 text-esn-orange" : "bg-esn/5 text-esn-dark")}
      aria-hidden="true"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{month}</span>
      <span className="text-lg font-bold tabular-nums">{day}</span>
      <span className="text-[10px] text-gray-500">{weekday}</span>
    </div>
  );
}

/** A helper's way in before the event (usability review #9): when, where, the Chat space. */
function HelperInfo({ event }: { event: MyEvent["event"] }) {
  const meeting = eventMeeting(event);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600" data-testid="helper-info">
      <span>
        Starts {berlinTime(event.starts_at)}
        {event.location && ` · ${event.location}`}
      </span>
      {/* Where to be first, when it is not the location (round 2026-11-02). */}
      {meeting && <span data-testid="helper-meeting">{meetingShort(meeting)}</span>}
      {event.chat_space_url ? (
        <a href={event.chat_space_url} target="_blank" rel="noopener noreferrer" className="font-medium text-esn hover:underline">
          Open the Chat space ↗
        </a>
      ) : (
        <span>{event.chat_space_requested_at ? "The Chat space is being created." : "The Chat space is created when the month's roster is confirmed."}</span>
      )}
    </p>
  );
}

const showsHelperInfo = (item: MyEvent) => item.role === "helper" && item.step.anchor === "chat-space";

export function MyEventCard({ item, now, from }: { item: MyEvent; now: number; from: string }) {
  const { event, role, step, live, openClaims } = item;
  return (
    <li className={cn("flex gap-3 rounded-lg border p-3", live ? "border-esn-orange/60 ring-1 ring-esn-orange/40" : "border-gray-200")}>
      <DateTile iso={event.starts_at} live={live} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/events/${event.id}?from=${from}`} className="font-medium text-gray-900 hover:text-esn break-words">
            {event.title}
          </Link>
          <Badge tone="blue">{role === "oc" ? "OC" : "Helper"}</Badge>
          {NOTEWORTHY.includes(event.status) && <EventStatusBadge status={event.status} />}
          <span className="ml-auto text-xs tabular-nums text-gray-500">{berlinTime(event.starts_at)}</span>
        </div>
        {live && (
          <Link href={`/events/${event.id}/attendance?from=${from}`} className={cn(buttonVariants({ size: "sm" }), "h-auto w-full whitespace-normal py-1.5 sm:w-auto")} data-testid="happening-now">
            Happening now – open attendance (QR code)
          </Link>
        )}
        <Link href={stepHref(event.id, step, from)} className={cn("flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-sm hover:underline", STEP_TONE[step.kind])} data-testid="next-step">
          <StepIcon kind={step.kind} />
          <span className="font-medium">{step.label}</span>
          {step.due && <DueLabel iso={step.due} now={now} note={step.dueNote} className="text-xs" />}
        </Link>
        {showsHelperInfo(item) && <HelperInfo event={event} />}
        {openClaims.count > 0 && (
          <Link href={`/events/${event.id}/hand-in?from=${from}#your-receipts`} className="block text-xs text-gray-600 hover:text-esn hover:underline" data-testid="event-claims">
            🧾 {plural(openClaims.count, "open receipt")} · {formatCents(openClaims.cents)}
          </Link>
        )}
      </div>
    </li>
  );
}

/** Home's short row: day, title, the next step in one line. */
export function MyEventRow({ item, now }: { item: MyEvent; now: number }) {
  const { event, role, step } = item;
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">
        {formatShortDate(event.starts_at)}
        <span className="block">{berlinTime(event.starts_at)}</span>
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={`/events/${event.id}?from=home`} className="min-w-0 truncate font-medium text-gray-900 hover:text-esn">
            {event.title}
          </Link>
          <Badge tone="blue">{role === "oc" ? "OC" : "Helper"}</Badge>
          {NOTEWORTHY.includes(event.status) && <EventStatusBadge status={event.status} />}
        </p>
        <Link href={stepHref(event.id, step, "home")} className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600 hover:text-esn hover:underline" data-testid="next-step">
          <StepIcon kind={step.kind} className="h-3.5 w-3.5" />
          {step.label}
          {step.due && <DueLabel iso={step.due} now={now} note={step.dueNote} />}
        </Link>
        {showsHelperInfo(item) && <HelperInfo event={event} />}
      </div>
    </li>
  );
}

/** The page of a duty, at its cash box when that is the step (the internal pages have a fixed back link). */
export const dutyHref = (d: MyDuty) => `${internalPath(d.duty.kind, d.duty.id)}${d.step.cash ? "#cash-box" : ""}`;

function DutyTime({ duty }: { duty: MyDuty["duty"] }) {
  return (
    <>
      {berlinTime(duty.starts_at)}
      {duty.ends_at && `–${berlinTime(duty.ends_at)}`}
    </>
  );
}

/** A duty at an office hour or Stammtisch (round 2026-11-03 (2)): when, where, the cash box. */
export function MyDutyCard({ item }: { item: MyDuty }) {
  const { duty, role, step, live } = item;
  return (
    <li className={cn("flex gap-3 rounded-lg border p-3", live ? "border-esn-orange/60 ring-1 ring-esn-orange/40" : "border-gray-200")} data-testid="duty-card">
      <DateTile iso={duty.starts_at} live={live} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={internalPath(duty.kind, duty.id)} className="font-medium text-gray-900 hover:text-esn break-words">
            {duty.title}
          </Link>
          <Badge tone="gray">{INTERNAL_KIND_LABELS[duty.kind]}</Badge>
          <Badge tone="blue">{role === "oc" ? "OC" : "Helper"}</Badge>
          {duty.status === "cancelled" && <Badge tone="red">Cancelled</Badge>}
          <span className="ml-auto text-xs tabular-nums text-gray-500">
            <DutyTime duty={duty} />
          </span>
        </div>
        {step.cash ? (
          <Link href={dutyHref(item)} className={cn("flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-sm hover:underline", STEP_TONE[step.kind])} data-testid="next-step">
            <StepIcon kind={step.kind} />
            <span className="font-medium">{step.label}</span>
          </Link>
        ) : (
          <p className={cn("flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-sm", STEP_TONE[step.kind])} data-testid="next-step">
            <StepIcon kind={step.kind} />
            <span className="font-medium">{step.label}</span>
          </p>
        )}
        {duty.location && <p className="text-xs text-gray-600">{duty.location}</p>}
      </div>
    </li>
  );
}

/** Home's short row for a duty. */
export function MyDutyRow({ item }: { item: MyDuty }) {
  const { duty, role, step } = item;
  return (
    <li className="flex gap-3 py-2.5" data-testid="duty-row">
      <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">
        {formatShortDate(duty.starts_at)}
        <span className="block">
          <DutyTime duty={duty} />
        </span>
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={internalPath(duty.kind, duty.id)} className="min-w-0 truncate font-medium text-gray-900 hover:text-esn">
            {duty.title}
          </Link>
          <Badge tone="blue">{role === "oc" ? "OC" : "Helper"}</Badge>
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600">
          <StepIcon kind={step.kind} className="h-3.5 w-3.5" />
          {step.label}
        </p>
      </div>
    </li>
  );
}

