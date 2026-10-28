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
