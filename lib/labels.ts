import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];
export type EventType = Enums["event_type"];
export type EventStatus = Enums["event_status"];
export type CycleStatus = Enums["cycle_status"];

export const EVENT_TYPES: EventType[] = ["standard", "special", "day_trip", "weekend_trip"];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  standard: "Standard",
  special: "Special",
  day_trip: "Day trip",
  weekend_trip: "Weekend trip",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  understaffed: "Under-staffed",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  dropped: "Dropped",
  completed: "Completed",
};

export const EVENT_STATUS_TONES: Record<EventStatus, "gray" | "blue" | "green" | "amber" | "red" | "purple"> = {
  draft: "gray",
  scheduled: "blue",
  understaffed: "amber",
  confirmed: "green",
  cancelled: "red",
  dropped: "red",
  completed: "purple",
};

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  planning: "Planning the schedule",
  form_open: "Volunteer form open",
  form_closed: "Form closed",
  allocated: "Allocated – adjusting roster",
  confirmed: "Roster confirmed",
};

/** What cancelling means, said wherever an event is cancelled (review 2026-10-29 A2). */
export const CANCEL_CONSEQUENCES = "The team and the Chat space are told; registered receipts stay valid.";

/**
 * The status a team list shows (review 2026-11-03 #10). The stored one lags:
 * nothing marks an event short of people when a helper drops out after the
 * roster, and a job marks events completed only a day after the start. So a
 * confirmed or under-staffed event shows what its staffing says until it
 * starts, and "completed" once it ended (`endsAt`, else once it started).
 */
export function shownStatus(e: { status: EventStatus; startsAt: string; endsAt?: string | null; short: boolean }, now: number): EventStatus {
  if (e.status !== "confirmed" && e.status !== "understaffed") return e.status;
  if (Date.parse(e.endsAt ?? e.startsAt) <= now) return "completed";
  if (Date.parse(e.startsAt) <= now) return "confirmed";
  return e.short ? "understaffed" : "confirmed";
}
