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
import { EVENT_STATUS_LABELS } from "@/lib/labels";
import { Ban } from "lucide-react";

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

const TILE_TONE = {
  default: "bg-esn/5 text-esn-dark",
  live: "bg-esn-orange/10 text-esn-orange",
  /** An open slot to claim (Home). */
  open: "bg-sky-50 text-sky-800",
  /** Cancelled or dropped. */
  muted: "bg-gray-100 text-gray-500",
};

/** An event's day as a small calendar leaf ("Nov / 3 / Tue"). */
export function DateTile({ iso, live, tone = "default" }: { iso: string; live?: boolean; tone?: keyof typeof TILE_TONE }) {
  const [weekday, day, month] = formatShortDate(iso).split(" ");
  return (
    <div className={cn("flex w-12 shrink-0 flex-col items-center self-start rounded-lg py-1.5 leading-tight", TILE_TONE[live ? "live" : tone])} aria-hidden="true">
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{month}</span>
      <span className="text-lg font-bold tabular-nums">{day}</span>
      <span className="text-[10px] text-gray-500">{weekday}</span>
    </div>
  );
}

/** A helper's way in before the event (usability review #9): when, where, the Chat space. */
export function HelperInfo({ event }: { event: MyEvent["event"] }) {
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

/** Statuses Home names next to the time, in their colour. */
const STATUS_TEXT: Partial<Record<MyEvent["event"]["status"], string>> = { understaffed: "text-amber-700", cancelled: "text-red-700", dropped: "text-red-700" };

/** The status box at the foot of a Home card: always two lines high, so the boxes line up across a row. */
const HOME_STATUS = "mt-auto flex h-[3.25rem] items-center gap-2 rounded-lg border px-3 text-[13px] leading-snug";

/** One of the member's next events as a Home card (redesign 2026-11-04): time and role above the title, the next step at the foot. */
export function HomeEventCard({ item, now }: { item: MyEvent; now: number }) {
  const { event, role, step } = item;
  const off = event.status === "cancelled" || event.status === "dropped";
  const statusText = STATUS_TEXT[event.status];
  return (
    <li className="flex" data-testid="home-event">
      <div className={cn("flex w-full flex-col gap-3 rounded-xl border p-4", off ? "border-dashed border-gray-300 bg-gray-50" : "border-gray-200 bg-white")}>
        <div className="flex gap-3">
          <DateTile iso={event.starts_at} tone={off ? "muted" : "default"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium tabular-nums text-gray-600">
              {berlinTime(event.starts_at)} · <span className="font-semibold text-esn">{role === "oc" ? "OC" : "Helper"}</span>
              {statusText && <span className={cn("font-semibold", statusText)}> · {EVENT_STATUS_LABELS[event.status]}</span>}
            </p>
            <Link
              href={`/events/${event.id}?from=home`}
              className={cn("mt-0.5 line-clamp-2 min-h-[2lh] break-words font-semibold leading-snug hover:text-esn", off ? "text-gray-500 line-through" : "text-gray-900")}
              title={event.title}
            >
              {event.title}
            </Link>
          </div>
        </div>
        {showsHelperInfo(item) && <HelperInfo event={event} />}
        <Link
          href={stepHref(event.id, step, "home")}
          className={cn(HOME_STATUS, "hover:underline", off ? "border-red-200 bg-red-50 text-red-800" : STEP_TONE[step.kind])}
          title={step.label}
          data-testid="next-step"
        >
          {off ? <Ban className="h-4 w-4 shrink-0" aria-hidden="true" /> : <StepIcon kind={step.kind} />}
          <span className="line-clamp-2 min-w-0">
            <span className="font-medium">{step.label}</span>
            {step.due && (
              <>
                {" · "}
                <DueLabel iso={step.due} now={now} note={step.dueNote} />
              </>
            )}
          </span>
        </Link>
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

/** A duty as a Home card, laid out like HomeEventCard. */
export function HomeDutyCard({ item }: { item: MyDuty }) {
  const { duty, role, step } = item;
  const off = duty.status === "cancelled";
  const status = (
    <>
      {off ? <Ban className="h-4 w-4 shrink-0" aria-hidden="true" /> : <StepIcon kind={step.kind} />}
      <span className="line-clamp-2 min-w-0 font-medium">{off ? "Cancelled" : step.label}</span>
    </>
  );
  const statusClass = cn(HOME_STATUS, off ? "border-red-200 bg-red-50 text-red-800" : STEP_TONE[step.kind]);
  return (
    <li className="flex" data-testid="duty-row">
      <div className={cn("flex w-full flex-col gap-3 rounded-xl border p-4", off ? "border-dashed border-gray-300 bg-gray-50" : "border-gray-200 bg-white")}>
        <div className="flex gap-3">
          <DateTile iso={duty.starts_at} tone={off ? "muted" : "default"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium tabular-nums text-gray-600">
              <DutyTime duty={duty} /> · <span className="font-semibold text-esn">{role === "oc" ? "OC" : "Helper"}</span> · {INTERNAL_KIND_LABELS[duty.kind]}
            </p>
            <Link
              href={internalPath(duty.kind, duty.id)}
              className={cn("mt-0.5 line-clamp-2 min-h-[2lh] break-words font-semibold leading-snug hover:text-esn", off ? "text-gray-500 line-through" : "text-gray-900")}
              title={duty.title}
            >
              {duty.title}
            </Link>
          </div>
        </div>
        {step.cash && !off ? (
          <Link href={dutyHref(item)} className={cn(statusClass, "hover:underline")} title={step.label} data-testid="next-step">
            {status}
          </Link>
        ) : (
          <p className={statusClass} title={off ? "Cancelled" : step.label} data-testid="next-step">
            {status}
          </p>
        )}
      </div>
    </li>
  );
}

