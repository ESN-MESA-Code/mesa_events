// The Calendar page's colours (redesign 2026-11-04): one per category, the
// same in the month grid (chip with a coloured left bar), the day list (the
// bar) and the phone's mini month (a dot). Deadlines are red so they never
// look like a Stammtisch (amber).
import type { Category } from "@/lib/calendarView";

export const CATEGORY_STYLE: Record<Category, { label: string; bar: string; chip: string; dot: string }> = {
  esn: { label: "ESN event", bar: "border-esn", chip: "bg-esn/10 text-esn-dark hover:bg-esn/15", dot: "bg-esn" },
  internal: { label: "Internal event", bar: "border-emerald-500", chip: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100", dot: "bg-emerald-500" },
  stammtisch: { label: "Stammtisch", bar: "border-amber-500", chip: "bg-amber-50 text-amber-900 hover:bg-amber-100", dot: "bg-amber-500" },
  tuesday_talk: { label: "Tuesday Talk", bar: "border-sky-500", chip: "bg-sky-50 text-sky-900 hover:bg-sky-100", dot: "bg-sky-500" },
  board_meeting: { label: "Board meeting", bar: "border-purple-500", chip: "bg-purple-50 text-purple-900 hover:bg-purple-100", dot: "bg-purple-500" },
  office_hour: { label: "Office hour", bar: "border-gray-400", chip: "bg-gray-100 text-gray-800 hover:bg-gray-200", dot: "bg-gray-400" },
  deadline: { label: "Deadline", bar: "border-red-400", chip: "border border-dashed border-red-300 bg-red-50/60 text-red-800", dot: "bg-red-500" },
};

/** Legend and dot order: the ESN side (events, office hours) first. */
export const CATEGORY_ORDER: Category[] = ["esn", "office_hour", "internal", "stammtisch", "tuesday_talk", "board_meeting", "deadline"];
