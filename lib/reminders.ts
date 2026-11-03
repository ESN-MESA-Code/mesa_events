// The automatic reminders to the OC (round 2026-11-03): the admin setting
// app_settings.oc_reminders, as send_oc_reminders() reads it, and how the
// Events team's pages describe it. 0 days switches a reminder off.

export interface ReminderDays {
  /** First description reminder this many days before the deadline (0 = off). */
  descriptionDaysBefore: number;
  descriptionEveryDays: number;
  /** First hand-in reminder this many days after the event (0 = off). */
  handinDaysAfter: number;
  handinEveryDays: number;
  /** At most this many hand-in reminders. */
  handinMax: number;
}

export const REMINDER_DEFAULTS: ReminderDays = { descriptionDaysBefore: 3, descriptionEveryDays: 1, handinDaysAfter: 1, handinEveryDays: 3, handinMax: 3 };

const whole = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) ? v : fallback);

export function parseReminderDays(value: unknown): ReminderDays {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = REMINDER_DEFAULTS;
  return {
    descriptionDaysBefore: whole(v.description_days_before, d.descriptionDaysBefore),
    descriptionEveryDays: whole(v.description_every_days, d.descriptionEveryDays),
    handinDaysAfter: whole(v.handin_days_after, d.handinDaysAfter),
    handinEveryDays: whole(v.handin_every_days, d.handinEveryDays),
    handinMax: whole(v.handin_max, d.handinMax),
  };
}

/** The setting as stored. */
export function reminderSetting(d: ReminderDays) {
  return {
    description_days_before: d.descriptionDaysBefore,
    description_every_days: d.descriptionEveryDays,
    handin_days_after: d.handinDaysAfter,
    handin_every_days: d.handinEveryDays,
    handin_max: d.handinMax,
  };
}

/** What is wrong with the days, or null (the database checks the same). */
export function reminderDaysError(d: ReminderDays): string | null {
  const ok = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!ok(d.descriptionDaysBefore, 0, 14) || !ok(d.handinDaysAfter, 0, 14)) return "Start: whole days from 0 to 14 (0 = off).";
  if (!ok(d.descriptionEveryDays, 1, 14) || !ok(d.handinEveryDays, 1, 14)) return "Repeat: every 1 to 14 days.";
  if (!ok(d.handinMax, 1, 10)) return "Hand-in: at most 1 to 10 reminders.";
  return null;
}

const every = (n: number) => (n === 1 ? "every day" : `every ${n} days`);
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** "From 3 days before the deadline, every day, until the description is in." */
export function describeDescriptionReminders(d: ReminderDays): string {
  if (!d.descriptionDaysBefore) return "Automatic description reminders are off.";
  return `OCs whose description is not in get a Chat reminder from ${days(d.descriptionDaysBefore)} before the deadline, ${every(d.descriptionEveryDays)}, until it is in.`;
}

/** "From 1 day after the event, every 3 days, at most 3 times." */
export function describeHandinReminders(d: ReminderDays): string {
  if (!d.handinDaysAfter) return "Automatic hand-in reminders are off.";
  return `OCs get a Chat reminder from ${days(d.handinDaysAfter)} after the event, ${every(d.handinEveryDays)}, at most ${d.handinMax === 1 ? "once" : `${d.handinMax} times`}, while the attendance list, photos or event report is missing.`;
}

/**
 * When a description is due, as private.description_due_at() computes it
 * (round 2026-11-03): the cycle's deadline; once Comms sent it back, `fixDays`
 * after that (never before the deadline); at the latest 24 hours before the
 * start. Null without a deadline or once it is in.
 */
export function descriptionDueAt(d: { deadline: string | null; status: string; submittedAt: string | null; sentBackAt: string | null; startsAt: string; fixDays: number }): string | null {
  if (!d.deadline || ["submitted", "approved", "published"].includes(d.status)) return null;
  if (!d.submittedAt) return d.deadline;
  const fixBy = Date.parse(d.sentBackAt ?? d.submittedAt) + d.fixDays * 86_400_000;
  return new Date(Math.min(Math.max(Date.parse(d.deadline), fixBy), Date.parse(d.startsAt) - 86_400_000)).toISOString();
}
