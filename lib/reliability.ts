// Reliability of volunteers (2026-11-07): what the OC reports after an event
// (public.attendance_reports), late drop-outs and the blacklist, summed up per
// member for HR and the Events team (public.member_reliability()). Pure
// (tests/unit/reliability.test.ts).

export const ATTENDANCE_OUTCOMES = ["no_show", "short_notice", "late", "excused"] as const;
export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];

/** What the OC picks for someone who was missing. */
export const OUTCOME_LABELS: Record<AttendanceOutcome, string> = {
  no_show: "Didn't show up, no notice",
  short_notice: "Cancelled at short notice",
  late: "Very late or left early",
  excused: "Missed for a good reason",
};

/** Short labels for tables. */
export const OUTCOME_SHORT: Record<AttendanceOutcome | "late_dropout", string> = {
  no_show: "No-show",
  short_notice: "Short-notice cancel",
  late: "Late / left early",
  excused: "Excused",
  late_dropout: "Dropped out < 48 h before",
};

/** A drop-out in the app this close to the start counts against reliability. */
export const LATE_DROPOUT_HOURS = 48;

export interface ReliabilityRow {
  profile_id: string;
  full_name: string;
  email: string;
  events_done: number;
  no_show: number;
  short_notice: number;
  late: number;
  excused: number;
  late_dropouts: number;
  last_incident_at: string | null;
  blacklisted: boolean;
  blacklist_reason: string | null;
  blacklisted_by: string | null;
  blacklisted_at: string | null;
}

export type ReliabilityLevel = "none" | "reliable" | "some_issues" | "unreliable";

export const LEVEL_LABELS: Record<ReliabilityLevel, { label: string; tone: "gray" | "green" | "amber" | "red" }> = {
  none: { label: "No events yet", tone: "gray" },
  reliable: { label: "Reliable", tone: "green" },
  some_issues: { label: "Some issues", tone: "amber" },
  unreliable: { label: "Unreliable", tone: "red" },
};

/** From this many misses (no-shows, short-notice cancellations, late drop-outs) someone is unreliable. */
export const MISSES_UNRELIABLE = 2;
/** …or below this score with at least MIN_COMMITMENTS events. */
export const SCORE_UNRELIABLE = 75;
export const MIN_COMMITMENTS = 3;

export interface Reliability {
  /** Events they were on (done or missed) plus late drop-outs. */
  commitments: number;
  /** No-shows, short-notice cancellations and late drop-outs; excused absences do not count. */
  misses: number;
  /** 0–100: each miss costs a full event, being very late or leaving early half; null without events. */
  score: number | null;
  level: ReliabilityLevel;
}

export function reliability(r: Pick<ReliabilityRow, "events_done" | "no_show" | "short_notice" | "late" | "late_dropouts">): Reliability {
  const commitments = r.events_done + r.late_dropouts;
  const misses = r.no_show + r.short_notice + r.late_dropouts;
  if (commitments === 0) return { commitments, misses, score: null, level: "none" };
  const score = Math.max(0, Math.round((100 * (commitments - misses - 0.5 * r.late)) / commitments));
  const level: ReliabilityLevel =
    misses >= MISSES_UNRELIABLE || (commitments >= MIN_COMMITMENTS && score < SCORE_UNRELIABLE) ? "unreliable" : misses > 0 || r.late > 0 ? "some_issues" : "reliable";
  return { commitments, misses, score, level };
}

/** Least reliable first (blacklisted at the top), then by name. */
export function sortByConcern(rows: ReliabilityRow[]): ReliabilityRow[] {
  const rank = (r: ReliabilityRow) => {
    const x = reliability(r);
    return [r.blacklisted ? 0 : 1, x.score ?? 101, -x.misses] as const;
  };
  return [...rows].sort((a, b) => {
    const [a1, a2, a3] = rank(a);
    const [b1, b2, b3] = rank(b);
    return a1 - b1 || a2 - b2 || a3 - b3 || a.full_name.localeCompare(b.full_name);
  });
}

/**
 * Whether someone on the blacklist may take this place: only as a helper on
 * an event the Events team marked non-crucial (as the database trigger
 * assignments_guard_blacklist).
 */
export function blacklistAllows(role: "oc" | "helper", nonCrucial: boolean): boolean {
  return role === "helper" && nonCrucial;
}
