// The planner's labels and colours (redesign 2026-11-11) – pure, for the
// server parts (the figures on top) and the client boards alike.
import { internalStaffing, type InternalKind } from "@/lib/internal";
import type { PlannerEvent } from "./planner";

export type Staffing = ReturnType<typeof internalStaffing>;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short names for the palette, the filters and the roster ("Executive board meeting" is long). */
export const SHORT: Record<InternalKind, string> = {
  internal: "Internal event",
  stammtisch: "Stammtisch",
  tuesday_talk: "Tuesday Talk",
  board_meeting: "Board meeting",
  office_hour: "Office hour",
};

/** Calendar chips: a soft fill and a strong left edge per kind. */
export const CHIP: Record<InternalKind, string> = {
  internal: "border-emerald-500 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
  stammtisch: "border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100",
  tuesday_talk: "border-sky-500 bg-sky-50 text-sky-950 hover:bg-sky-100",
  board_meeting: "border-purple-500 bg-purple-50 text-purple-950 hover:bg-purple-100",
  office_hour: "border-slate-400 bg-slate-100 text-slate-800 hover:bg-slate-200",
};

/** The dates "Repeat" would add, before they exist: dashed, in the kind's colour. */
export const GHOST: Record<InternalKind, string> = {
  internal: "border-emerald-400 text-emerald-800",
  stammtisch: "border-amber-400 text-amber-800",
  tuesday_talk: "border-sky-400 text-sky-800",
  board_meeting: "border-purple-400 text-purple-800",
  office_hour: "border-slate-400 text-slate-700",
};

export const STAFFING_DOT: Record<Staffing, string> = { no_oc: "bg-red-500", short: "bg-amber-500", staffed: "bg-emerald-500" };
export const STAFFING_TEXT: Record<Staffing, string> = { no_oc: "No OC yet", short: "Short of helpers", staffed: "Fully staffed" };

export const staffingOf = (ev: PlannerEvent): Staffing =>
  internalStaffing(
    ev.people.some((p) => p.role === "oc"),
    ev.people.filter((p) => p.role === "helper").length,
    ev.helpersNeeded
  );

/** "Wed 11 Nov" from "2026-11-11" – no Intl, so server and browser agree. */
export function dayLabel(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
