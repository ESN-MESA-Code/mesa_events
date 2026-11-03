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

const HOUR = 3_600_000;
/** Without an end time an event counts as running for this long. */
const DEFAULT_LENGTH = 4 * HOUR;

/** Running now: from its start until its end (or four hours later). */
export function happeningNow(e: Timed, now: number): boolean {
  const start = Date.parse(e.starts_at);
  const end = e.ends_at ? Date.parse(e.ends_at) : start + DEFAULT_LENGTH;
  return start <= now && now < end;
}

/**
 * Home's order (usability review #10): happening now, overdue, due within
 * 48 hours, other things to do, waiting on others, done – each by date.
 */
export function urgencyRank(e: Timed, step: Pick<NextStep, "kind" | "due">, now: number): number {
  if (happeningNow(e, now)) return 0;
  if (step.kind === "action") {
    if (step.due && Date.parse(step.due) < now) return 1;
    if (step.due && Date.parse(step.due) - now < 48 * HOUR) return 2;
    return 3;
  }
  return step.kind === "waiting" ? 4 : 5;
}

export function byUrgency<T>(list: T[], timed: (x: T) => Timed, step: (x: T) => Pick<NextStep, "kind" | "due">, now: number): T[] {
  return [...list].sort((a, b) => urgencyRank(timed(a), step(a), now) - urgencyRank(timed(b), step(b), now) || timed(a).starts_at.localeCompare(timed(b).starts_at));
}

/**
 * My events' sections (round 2026-11-03 (2)): Today, To do (coming up, the
 * next step is the member's), Coming up (waiting on others or all set),
 * To finish (past, the hand-in is still the member's), Done.
 */
export type MyEventSection = "today" | "todo" | "upcoming" | "finish" | "done";

export function sectionOf(e: Timed, step: Pick<NextStep, "kind">, now: number): MyEventSection {
  const group = eventGroup(e, now);
  if (group === "today") return "today";
  if (group === "upcoming") return step.kind === "action" ? "todo" : "upcoming";
  return step.kind === "action" ? "finish" : "done";
}

/** To do by urgency, To finish oldest first, Done most recent first, the rest by start. */
export function sectionEvents<T>(list: T[], timed: (x: T) => Timed, step: (x: T) => Pick<NextStep, "kind" | "due">, now: number): Record<MyEventSection, T[]> {
  const out: Record<MyEventSection, T[]> = { today: [], todo: [], upcoming: [], finish: [], done: [] };
  const sorted = [...list].sort((a, b) => timed(a).starts_at.localeCompare(timed(b).starts_at));
  for (const x of sorted) out[sectionOf(timed(x), step(x), now)].push(x);
  out.todo = byUrgency(out.todo, timed, step, now);
  out.done.reverse();
  return out;
}

const DAY = 24 * HOUR;

/**
 * Home's "Waiting for you" takes an event when it is happening now, or its
 * next step is the member's and overdue, due within a week or without a
 * date (a hand-in, a decision). Later deadlines wait on My events.
 */
export function needsYou(e: Timed, step: Pick<NextStep, "kind" | "due">, now: number): boolean {
  if (happeningNow(e, now)) return true;
  if (step.kind !== "action") return false;
  return !step.due || Date.parse(step.due) - now < 7 * DAY;
}
