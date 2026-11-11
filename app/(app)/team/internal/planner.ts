import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinDate, isoToBerlinInput, monthLabel, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { addDays, monthParam, parseMonthParam } from "@/lib/month";
import { peopleOf, type InternalPerson } from "@/lib/internalEvents";
import { INTERNAL_KINDS, internalStaffing, isStaffed, parseSemesterKey, semesterFor, shiftSemester, type InternalKind } from "@/lib/internal";
import { isInternalPlanner } from "@/lib/roles";

// What the Calendar and the Duty roster tabs of the internal planning share
// (split 2026-11-11): the period (a semester, or one month – the same on both
// tabs), its dates with their people, the members and the defaults per kind.

export interface PlannerEvent {
  id: string;
  kind: InternalKind;
  title: string;
  /** Berlin datetime-local values. */
  start: string;
  end: string | null;
  location: string;
  note: string;
  presentationUrl: string | null;
  capacity: number | null;
  helpersNeeded: number;
  cancelled: boolean;
  past: boolean;
  seriesId: string | null;
  people: InternalPerson[];
}

export interface KindSetting {
  kind: InternalKind;
  title: string;
  /** "19:00" */
  start: string;
  minutes: number;
  helpers: number;
  description: string;
}

export type PlannerView = "semester" | "month";

export interface PlannerParams {
  month?: string;
  semester?: string;
  view?: string;
}

/** A tab of the planner for the same period, with extra query parameters. */
export function plannerHref(path: string, view: PlannerView, semesterKey: string, month: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams(view === "semester" ? { view, semester: semesterKey } : { view, month: monthParam(month) });
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `${path}?${q.toString()}`;
}

export type PlannerData = Awaited<ReturnType<typeof loadPlanner>>;

export async function loadPlanner(sp: PlannerParams, page: string) {
  const viewer = await requirePageRole(["hr", "vice_president"], { executiveMayRead: true, page });
  const canEdit = isInternalPlanner(viewer.roles);
  const supabase = await createSessionClient();
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());
  const thisMonth = monthOf(new Date(now).toISOString());
  const askedMonth = parseMonthParam(sp.month);
  // The semester is the default view; ?view=month (or a ?month=) shows one month.
  const view: PlannerView = sp.view === "month" || (askedMonth && sp.view !== "semester") ? "month" : "semester";
  const semester = parseSemesterKey(sp.semester) ?? semesterFor(askedMonth ?? today);
  const month = askedMonth ?? (semester.months.includes(thisMonth) ? thisMonth : semester.months[0]);
  const months = view === "semester" ? semester.months : [month];
  const from = view === "semester" ? semester.from : month;

  const [{ data: rows }, { data: settings }, { data: profiles }] = await Promise.all([
    supabase
      .from("internal_events")
      .select("id, kind, title, starts_at, ends_at, location, note, presentation_url, capacity, helpers_needed, status, series_id")
      .gte("starts_at", monthStartIso(months[0]))
      .lt("starts_at", nextMonthStartIso(months.at(-1)!))
      .order("starts_at"),
    supabase.from("internal_kind_settings").select("kind, default_title, default_start, default_minutes, helpers_needed, description"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);
  const people = await peopleOf(supabase, (rows ?? []).map((r) => r.id));
  const events: PlannerEvent[] = (rows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as InternalKind,
    title: r.title,
    start: isoToBerlinInput(r.starts_at),
    end: r.ends_at ? isoToBerlinInput(r.ends_at) : null,
    location: r.location,
    note: r.note,
    presentationUrl: r.presentation_url,
    capacity: r.capacity,
    helpersNeeded: r.helpers_needed,
    cancelled: r.status === "cancelled",
    past: Date.parse(r.starts_at) < now,
    seriesId: r.series_id,
    people: people.get(r.id) ?? [],
  }));
  const kinds: KindSetting[] = INTERNAL_KINDS.map((k) => {
    const s = (settings ?? []).find((x) => x.kind === k)!;
    return { kind: k, title: s.default_title, start: s.default_start.slice(0, 5), minutes: s.default_minutes, helpers: s.helpers_needed, description: s.description };
  });
  const monthOptions: string[] = [];
  for (let m = addMonths(thisMonth, -12); m <= addMonths(thisMonth, 12); m = addMonths(m, 1)) monthOptions.push(m);
  if (!monthOptions.includes(month)) monthOptions.push(month);
  monthOptions.sort();

  // What is still to come, and who is missing on it.
  const coming = events.filter((e) => !e.past && !e.cancelled);
  const duties = coming.filter((e) => isStaffed(e.kind));
  const staffing = duties.map((e) =>
    internalStaffing(
      e.people.some((p) => p.role === "oc"),
      e.people.filter((p) => p.role === "helper").length,
      e.helpersNeeded
    )
  );

  return {
    canEdit,
    today,
    view,
    semester,
    prevSemester: shiftSemester(semester, -1),
    nextSemester: shiftSemester(semester, 1),
    month,
    askedMonth,
    months,
    monthOptions,
    // "Repeat" covers what is shown, from today on (past dates are history).
    period: {
      label: view === "semester" ? semester.name : monthLabel(month),
      from: from > today ? from : today,
      to: view === "semester" ? semester.to : addDays(addMonths(month, 1), -1),
    },
    events,
    kinds,
    members: (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email })),
    summary: {
      coming: coming.length,
      total: events.filter((e) => !e.cancelled).length,
      next: coming[0] ?? null,
      noOc: staffing.filter((s) => s === "no_oc").length,
      short: staffing.filter((s) => s === "short").length,
    },
    href: (path: string, extra?: Record<string, string>) => plannerHref(path, view, semester.key, month, extra),
  };
}

