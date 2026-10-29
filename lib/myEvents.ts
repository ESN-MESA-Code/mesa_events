// My events in three groups by start and end time (review 2026-10-29 A3):
// Today (starts today in Berlin, or is still running, like a trip), Coming
// up, Past – and a past event's hand-in state. Pure (tests/unit/myEvents.test.ts).
import { berlinDate } from "@/lib/dates";
import type { NextStep } from "@/lib/checklist";

export type EventGroup = "today" | "upcoming" | "past";

export interface Timed {
  starts_at: string;
  ends_at: string | null;
}

export function eventGroup(e: Timed, now: number): EventGroup {
  if (berlinDate(e.starts_at) === berlinDate(new Date(now).toISOString())) return "today";
  if (Date.parse(e.starts_at) > now) return "upcoming";
  if (e.ends_at && Date.parse(e.ends_at) > now) return "today";
  return "past";
}

/** Today and Coming up soonest first, Past most recent first. */
export function groupEvents<T>(list: T[], timed: (x: T) => Timed, now: number): Record<EventGroup, T[]> {
  const sorted = [...list].sort((a, b) => timed(a).starts_at.localeCompare(timed(b).starts_at));
  const out: Record<EventGroup, T[]> = { today: [], upcoming: [], past: [] };
  for (const x of sorted) out[eventGroup(timed(x), now)].push(x);
  out.past.reverse();
  return out;
}

export interface HandInState {
  label: "Hand-in open" | "Done" | "Cancelled" | "Dropped";
  tone: "amber" | "green" | "red" | "gray";
}

/** A past event's label: is something of the hand-in still the person's to do? */
export function handInState(status: string, step: Pick<NextStep, "kind">): HandInState {
  if (status === "cancelled" || status === "dropped") {
    if (step.kind === "action") return { label: "Hand-in open", tone: "amber" };
    return status === "cancelled" ? { label: "Cancelled", tone: "red" } : { label: "Dropped", tone: "gray" };
  }
  return step.kind === "action" ? { label: "Hand-in open", tone: "amber" } : { label: "Done", tone: "green" };
}
