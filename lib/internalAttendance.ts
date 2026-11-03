// Attendance of Tuesday Talks and internal events (round 2026-11-03 (2)):
// members check in with the code on HR's screen (it changes every 20
// seconds); HR adds and removes anyone. The same rules as the database
// (migration 20261103000300) for the pages. Pure (tests/unit/internalAttendance.test.ts).
import type { InternalKind } from "@/lib/internal";

export const takesAttendance = (kind: InternalKind) => kind === "tuesday_talk" || kind === "internal";

const MIN = 60_000;
/** Checking in opens this long before the start and closes this long after the end. */
const MARGIN = 30 * MIN;
/** Without an end a meeting counts as two hours long. */
const LENGTH = 120 * MIN;

export type CheckinState = "before" | "open" | "after" | "closed" | "cancelled";

export function checkinWindow(e: { starts_at: string; ends_at: string | null; status: string; attendance_closed_at: string | null }, now: number): { state: CheckinState; opens: string; closes: string } {
  const start = Date.parse(e.starts_at);
  const end = e.ends_at ? Date.parse(e.ends_at) : start + LENGTH;
  const opens = new Date(start - MARGIN).toISOString();
  const closes = new Date(end + MARGIN).toISOString();
  if (e.status === "cancelled") return { state: "cancelled", opens, closes };
  if (e.attendance_closed_at) return { state: "closed", opens, closes };
  if (now < start - MARGIN) return { state: "before", opens, closes };
  if (now > end + MARGIN) return { state: "after", opens, closes };
  return { state: "open", opens, closes };
}

/** What the QR code on HR's screen opens. */
export const checkinUrl = (base: string, eventId: string, token: string) => `${base}/checkin/${eventId}?t=${encodeURIComponent(token)}`;

export interface ActivityRow {
  profile_id: string;
  full_name: string;
  email: string;
  oc_count: number;
  helper_count: number;
  office_hour_count: number;
  talk_count: number;
  meeting_count: number;
  newbie: boolean;
}

export type ActivityColumn = "full_name" | "oc_count" | "helper_count" | "office_hour_count" | "talk_count" | "meeting_count";

export const ACTIVITY_COLUMNS: Array<{ key: Exclude<ActivityColumn, "full_name">; label: string }> = [
  { key: "oc_count", label: "OC of an event" },
  { key: "helper_count", label: "Helped at an event" },
  { key: "office_hour_count", label: "Office hours" },
  { key: "talk_count", label: "Tuesday Talks" },
  { key: "meeting_count", label: "Other meetings" },
];

/** Numbers highest first, names A–Z; ties by name. */
export function sortActivity(rows: ActivityRow[], by: ActivityColumn): ActivityRow[] {
  const name = (a: ActivityRow, b: ActivityRow) => a.full_name.localeCompare(b.full_name);
  return [...rows].sort((a, b) => (by === "full_name" ? name(a, b) : b[by] - a[by] || name(a, b)));
}

/** A spreadsheet of the semester (comma-separated, quoted where needed). */
export function activityCsv(rows: ActivityRow[]): string {
  const cell = (v: string | number | boolean) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Name", "Email", ...ACTIVITY_COLUMNS.map((c) => c.label), "Newbie"];
  return [head, ...rows.map((r) => [r.full_name, r.email, ...ACTIVITY_COLUMNS.map((c) => r[c.key]), r.newbie ? "yes" : "no"])].map((line) => line.map(cell).join(",")).join("\n");
}
