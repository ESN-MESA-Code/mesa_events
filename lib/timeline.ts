// The fixed timeline of a planning cycle (round 2026-11-02): in the month
// before the events' month, ideas are in by the 7th, the volunteer form
// opens on the 10th and closes on the 15th, the descriptions are in by the
// 20th. The days are an admin setting (app_settings.cycle_timeline); the
// database computes the same instants (public.cycle_timeline) for its
// guards and jobs. Pure (tests/unit/timeline.test.ts).
import { addMonths, berlinDate, berlinInputToIso, monthOf } from "@/lib/dates";
import { plural } from "@/lib/plural";

export interface TimelineDays {
  /** Last day to propose ideas for the month (23:59). */
  ideasDue: number;
  /** The volunteer form opens (09:00). */
  formOpens: number;
  /** Last day to sign up as OC or helper (23:59). */
  formCloses: number;
  /** Last day to submit descriptions (23:59). */
  descriptionsDue: number;
}

export const DEFAULT_TIMELINE: TimelineDays = { ideasDue: 7, formOpens: 10, formCloses: 15, descriptionsDue: 20 };

/** When the form opens on its day, Berlin. */
export const FORM_OPENS_AT = "09:00";
/** Days after the form closes by which Events confirms the roster (the OCs then have time to write). */
export const ROSTER_DAYS = 2;

/** The setting as stored ({ ideas_due, form_opens, form_closes, descriptions_due }) → days; the defaults when missing or invalid. */
export function parseTimelineDays(value: unknown): TimelineDays {
  const v = (value ?? {}) as Record<string, unknown>;
  const days: TimelineDays = {
    ideasDue: Number(v.ideas_due),
    formOpens: Number(v.form_opens),
    formCloses: Number(v.form_closes),
    descriptionsDue: Number(v.descriptions_due),
  };
  return timelineDaysError(days) ? DEFAULT_TIMELINE : days;
}

/** Days → the stored setting. */
export function timelineSetting(days: TimelineDays) {
  return { ideas_due: days.ideasDue, form_opens: days.formOpens, form_closes: days.formCloses, descriptions_due: days.descriptionsDue };
}

/** Why these days cannot be the timeline (null when they can): whole days 1–28, in order. */
export function timelineDaysError(d: TimelineDays): string | null {
  const all = [d.ideasDue, d.formOpens, d.formCloses, d.descriptionsDue];
  if (!all.every((n) => Number.isInteger(n) && n >= 1 && n <= 28)) return "Each day must be a whole number from 1 to 28.";
  if (!(d.ideasDue < d.formOpens && d.formOpens < d.formCloses && d.formCloses < d.descriptionsDue)) {
    return "The days must follow each other: ideas, form opens, form closes, descriptions.";
  }
  return null;
}

export interface CycleTimeline {
  /** The events' month, "2026-12-01". */
  month: string;
  /** The month it is planned in, "2026-11-01". */
  plannedIn: string;
  ideasDue: string;
  formOpens: string;
  formCloses: string;
  /** Events confirms the roster by then (ROSTER_DAYS after the form closes). */
  rosterDue: string;
  descriptionsDue: string;
}

const at = (month: string, day: number, time: string) => berlinInputToIso(`${month.slice(0, 8)}${String(day).padStart(2, "0")}T${time}`);

/** The instants (ISO) of the cycle for `month` ("2026-12-01"). */
export function cycleTimeline(month: string, days: TimelineDays = DEFAULT_TIMELINE): CycleTimeline {
  const plannedIn = addMonths(month, -1);
  return {
    month,
    plannedIn,
    ideasDue: at(plannedIn, days.ideasDue, "23:59"),
    formOpens: at(plannedIn, days.formOpens, FORM_OPENS_AT),
    formCloses: at(plannedIn, days.formCloses, "23:59"),
    rosterDue: at(plannedIn, Math.min(days.formCloses + ROSTER_DAYS, days.descriptionsDue), "23:59"),
    descriptionsDue: at(plannedIn, days.descriptionsDue, "23:59"),
  };
}

/**
 * The first month a new idea may be dated in: the earliest month whose
 * ideas deadline is still ahead ("2026-12-01" until 7 Nov, 23:59, then
 * "2027-01-01"). Every later month is open too – ideas for next year welcome.
 */
export function firstOpenIdeaMonth(now: number, days: TimelineDays = DEFAULT_TIMELINE): string {
  const next = addMonths(monthOf(new Date(now).toISOString()), 1);
  return Date.parse(cycleTimeline(next, days).ideasDue) >= now ? next : addMonths(next, 1);
}

/** Whether an idea dated `date` ("2026-12-03") may still be proposed at `now`. */
export function ideaDateOpen(date: string, now: number, days: TimelineDays = DEFAULT_TIMELINE): boolean {
  return `${date.slice(0, 7)}-01` >= firstOpenIdeaMonth(now, days);
}

/**
 * The cycle members are working towards: the month after this one, until
 * its descriptions are due; then the month after that (its ideas are next).
 */
export function upcomingCycleMonth(now: number, days: TimelineDays = DEFAULT_TIMELINE): string {
  const next = addMonths(monthOf(new Date(now).toISOString()), 1);
  return Date.parse(cycleTimeline(next, days).descriptionsDue) >= now ? next : addMonths(next, 1);
}

export type MilestoneId = "ideas" | "formOpens" | "formCloses" | "roster" | "descriptions";

export interface Milestone {
  id: MilestoneId;
  label: string;
  at: string;
  /** passed; next = the first one still ahead; later. */
  state: "passed" | "next" | "later";
}

const MILESTONE_LABELS: Record<MilestoneId, string> = {
  ideas: "Ideas due",
  formOpens: "Volunteer form opens",
  formCloses: "Sign-up closes",
  roster: "Roster confirmed",
  descriptions: "Descriptions due",
};

/**
 * The milestones of a cycle in order, each passed / next / later. The roster
 * one only for the Events team. `done` are steps the cycle has taken whatever
 * their date (a form opened early). Steps happen in order: once a later one
 * is passed, the earlier ones are too – a form opened or closed before the
 * ideas day ends the ideas for that month (round 2026-11-03 (2)).
 */
export function milestones(t: CycleTimeline, now: number, { roster = false, done = [] as MilestoneId[] } = {}): Milestone[] {
  const list: Array<[MilestoneId, string]> = [
    ["ideas", t.ideasDue],
    ["formOpens", t.formOpens],
    ["formCloses", t.formCloses],
    ...(roster ? [["roster", t.rosterDue] as [MilestoneId, string]] : []),
    ["descriptions", t.descriptionsDue],
  ];
  const last = list.map(([id, iso]) => done.includes(id) || Date.parse(iso) < now).lastIndexOf(true);
  return list.map(([id, iso], i) => ({ id, label: MILESTONE_LABELS[id], at: iso, state: i <= last ? "passed" : i === last + 1 ? "next" : "later" }));
}

/** "7 Nov" – the day of a milestone, short. */
export function milestoneDay(iso: string): string {
  const [, m, d] = berlinDate(iso).split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

/** "10–15 Nov", or "28 Nov–2 Dec" across months. */
export function dayRange(fromIso: string, toIso: string): string {
  const [from, to] = [milestoneDay(fromIso), milestoneDay(toIso)];
  return from.split(" ")[1] === to.split(" ")[1] ? `${from.split(" ")[0]}–${to}` : `${from}–${to}`;
}

/** "in 5 days", "tomorrow", "today", "in 3 hours" – how far a date is; "" once passed. */
export function relativeDue(iso: string, now: number): string {
  const left = Date.parse(iso) - now;
  if (left < 0) return "";
  if (left < 12 * 3_600_000) {
    const hours = Math.floor(left / 3_600_000);
    return hours < 1 ? "in less than an hour" : `in ${plural(hours, "hour")}`;
  }
  const days = Math.round((Date.parse(`${berlinDate(iso)}T12:00:00Z`) - Date.parse(`${berlinDate(new Date(now).toISOString())}T12:00:00Z`)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

/** Whether a deadline someone set differs from the standard one (not the same Berlin minute). */
export const offStandard = (iso: string | null, standard: string) => !!iso && Math.abs(Date.parse(iso) - Date.parse(standard)) >= 60_000;
