import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinDate, isoToBerlinInput, monthLabel, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { addDays, monthParam, parseMonthParam } from "@/lib/month";
import { peopleOf } from "@/lib/internalEvents";
import { INTERNAL_KINDS, parseSemesterKey, semesterFor, shiftSemester, type InternalKind } from "@/lib/internal";
import { isInternalPlanner } from "@/lib/roles";
import { Badge, PageHeader, buttonVariants } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { cn } from "@/lib/utils";
import { PlannerBoard, type PlannerEvent, type KindSetting } from "./PlannerBoard";

export const metadata: Metadata = { title: "Internal planning" };

// HR and the Vice President plan internal events, meetings and office hours
// (round 2026-10-30) for a whole semester at a time (or one month): drag a
// kind onto a day, move dates by drag and drop, repeat them over the
// semester (every Thursday, the 2nd and 4th Tuesday …), and drag members onto
// the OC and helper slots of Stammtisch and office hours. Executives look.
export default async function InternalPlanningPage({ searchParams }: { searchParams: Promise<{ month?: string; semester?: string; view?: string }> }) {
  const viewer = await requirePageRole(["hr", "vice_president"], { executiveMayRead: true, page: "Internal planning" });
  const canEdit = isInternalPlanner(viewer.roles);
  const supabase = await createSessionClient();
  const sp = await searchParams;
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());
  const thisMonth = monthOf(new Date(now).toISOString());
  const askedMonth = parseMonthParam(sp.month);
  // The semester is the default view; ?view=month (or a ?month=) shows one month.
  const view = sp.view === "month" || (askedMonth && sp.view !== "semester") ? "month" : "semester";
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
  const prev = shiftSemester(semester, -1);
  const next = shiftSemester(semester, 1);
  const viewLink = (v: "semester" | "month") => (v === "semester" ? `/team/internal?view=semester&semester=${semester.key}` : `/team/internal?view=month&month=${monthParam(month)}`);
  // "Repeat" covers what is shown, from today on (past dates are history).
  const repeatFrom = from > today ? from : today;
  const repeatTo = view === "semester" ? semester.to : addDays(addMonths(month, 1), -1);

  return (
    <>
      <PageHeader title="Internal planning" description="Internal events, Stammtisch, Tuesday Talks, executive board meetings and office hours – plan the semester. Not ESN activities: no description or volunteer form.">
        <div className="flex flex-wrap items-center gap-3">
          {!canEdit && <Badge data-testid="read-only">Read-only (executive)</Badge>}
          <nav aria-label="View" className="flex rounded-md border border-gray-300 text-sm">
            {(["semester", "month"] as const).map((v) => (
              <Link key={v} href={viewLink(v)} aria-current={view === v ? "page" : undefined} className={cn("px-3 py-1.5 first:rounded-l-md last:rounded-r-md", view === v ? "bg-esn text-white" : "bg-white text-gray-700 hover:text-esn")}>
                {v === "semester" ? "Semester" : "Month"}
              </Link>
            ))}
          </nav>
          {view === "semester" ? (
            <nav aria-label="Semester" className="flex items-center gap-1" data-testid="semester-nav">
              <Link href={`/team/internal?view=semester&semester=${prev.key}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Previous semester (${prev.name})`}>
                ←
              </Link>
              <span className="min-w-28 text-center font-semibold">{semester.name}</span>
              <Link href={`/team/internal?view=semester&semester=${next.key}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Next semester (${next.name})`}>
                →
              </Link>
            </nav>
          ) : (
            <MonthSelector
              options={monthOptions.sort().map((m) => ({ value: monthParam(m), label: monthLabel(m), href: `/team/internal?view=month&month=${monthParam(m)}` }))}
              current={monthParam(month)}
              path="/team/internal"
              storageKey="mesa:month:internal"
              explicit={!!askedMonth}
            />
          )}
        </div>
      </PageHeader>
      <PlannerBoard
        months={months}
        compact={view === "semester"}
        today={today}
        period={{ label: view === "semester" ? semester.name : monthLabel(month), from: repeatFrom, to: repeatTo }}
        events={events}
        kinds={kinds}
        members={(profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email }))}
        canEdit={canEdit}
      />
    </>
  );
}
