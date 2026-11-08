import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CalendarDays, CalendarPlus, Check, ChevronRight, ClipboardList, FileText, Lightbulb, PackageCheck, Shuffle, Tags, Users } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, formatShortDate, monthLabel, monthOf, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { cyclesWithProgress, type CycleWithProgress } from "@/lib/cycleFacts";
import { stepHref, type StepId } from "@/lib/cycle";
import { plural } from "@/lib/plural";
import { monthParam, parseMonthParam } from "@/lib/month";
import { Card, CardContent, CardHeader, CardTitle, PageHeader, buttonVariants } from "@/components/ui";
import { SectionHeader } from "@/components/home";
import { cn } from "@/lib/utils";
import { NewCycleForm } from "./NewCycleForm";
import { cycleTimeline, upcomingCycleMonth } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";

export const metadata: Metadata = { title: "Events team" };

/** What is open in a step, in a few words (round 2026-11-03: no sentences on this page). */
function shortTodo(c: CycleWithProgress, step: StepId): string {
  const f = c.facts;
  switch (step) {
    case "ideas":
      return f.openIdeas ? `${plural(f.openIdeas, "idea")} to decide` : "Add events";
    case "schedule":
      return `${plural(f.events, "event")} planned`;
    case "form":
      return `${plural(f.responses, "answer")} so far`;
    case "allocation":
      return "Run the allocation";
    case "roster":
      return "Confirm the roster";
    case "descriptions":
      return f.descriptionDeadline ? `${f.descriptions.upcomingMissing} not in` : "Set the deadline";
    case "handin":
      return `${f.handIn.happened - f.handIn.done} not handed in`;
    case "done":
      return "Done";
  }
}

const STEP_ICON: Record<StepId, LucideIcon> = {
  ideas: Lightbulb,
  schedule: CalendarDays,
  form: ClipboardList,
  allocation: Shuffle,
  roster: Users,
  descriptions: FileText,
  handin: PackageCheck,
  done: Check,
};

/** The month's steps as a segmented bar: done green, the current one ESN blue (red when late). */
function StepBar({ c }: { c: CycleWithProgress }) {
  const steps = c.progress.steps.filter((s) => s.id !== "done");
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <div>
      <div className="flex gap-1" aria-hidden="true">
        {steps.map((s) => (
          <span
            key={s.id}
            title={s.label}
            className={cn("h-1.5 flex-1 rounded-full", s.state === "done" ? "bg-emerald-500" : s.state === "current" ? (s.late ? "bg-red-500" : "bg-esn") : "bg-gray-200")}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-gray-500">
        {done} of {steps.length} steps done
      </p>
    </div>
  );
}

/** One open step: the whole row is the link, an icon, what to do and the step's date. */
function TodoLink({ href, icon: Icon, label, todo, note, tone, testId }: { href: string; icon: LucideIcon; label: string; todo: string; note?: string; tone: "late" | "open" | "alert"; testId: string }) {
  return (
    <li data-testid={testId}>
      <Link href={href} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50">
        <span
          className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone === "open" ? "bg-esn/5 text-esn" : tone === "late" ? "bg-red-50 text-red-700" : "bg-red-600 text-white")}
          aria-hidden="true"
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-gray-900">{label}</span>
            <span className={cn("truncate text-right text-sm", tone === "open" ? "text-gray-600" : "font-medium text-red-700")}>{todo}</span>
          </span>
          {note && <span className={cn("block text-xs", tone === "open" ? "text-gray-500" : "text-red-700")}>{note}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" aria-hidden="true" />
      </Link>
    </li>
  );
}

// The Events team's page (round 2026-11-03; redesign 2026-11-08): the
// months in progress as cards in date order – a step bar, then what is open
// in each as rows linking to the tab where it is done, the OCs' cancellation
// requests first. The month the timeline plans next and has no cycle yet is
// a dashed card; ideas for later months and the done months (by year) below.
// ?month=YYYY-MM (older links) opens that month.
export default async function EventsTeamPage({ searchParams }: { searchParams: Promise<{ month?: string; new?: string }> }) {
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, page: "Events team" });
  const canEdit = hasRole(viewer.roles, "events");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const { data: cycleRows } = await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month");
  const asked = parseMonthParam(sp.month);
  if (asked) {
    const target = (cycleRows ?? []).find((c) => c.month === asked);
    if (target) redirect(`/team/events/cycles/${target.id}`);
  }
  const [cycles, days, { data: ideaRows }, { data: requests }] = await Promise.all([
    cyclesWithProgress(supabase, cycleRows ?? []),
    loadTimelineDays(supabase),
    supabase.from("event_ideas").select("proposed_date").eq("status", "proposed").gte("proposed_date", monthOf(new Date(now).toISOString())),
    // The OCs' cancellation requests waiting for the Events team.
    supabase.from("cancellation_requests").select("id, event_id, events!inner(title, cycle_id)").is("decision", null),
  ]);
  const planning = canEdit && (sp.new === "1" || !cycles.length);
  const upcoming = upcomingCycleMonth(now, days);
  const upcomingTimeline = cycleTimeline(upcoming, days);
  const missingCycle = !cycles.some((c) => c.month === upcoming);
  const upcomingLate = Date.parse(upcomingTimeline.formOpens) < now;

  const active = cycles.filter((c) => !c.progress.done);
  const done = cycles.filter((c) => c.progress.done).reverse();
  const doneByYear = new Map<string, CycleWithProgress[]>();
  for (const c of done) doneByYear.set(c.month.slice(0, 4), [...(doneByYear.get(c.month.slice(0, 4)) ?? []), c]);
  const ideasIn = new Map<string, number>();
  for (const i of ideaRows ?? []) {
    const m = `${i.proposed_date.slice(0, 7)}-01`;
    ideasIn.set(m, (ideasIn.get(m) ?? 0) + 1);
  }
  const later = [...ideasIn].filter(([m]) => m !== upcoming && !cycles.some((c) => c.month === m)).sort(([x], [y]) => x.localeCompare(y));
  const requestsOf = (cycleId: string) =>
    (requests ?? []).filter((r) => (r.events as { cycle_id: string | null } | null)?.cycle_id === cycleId).map((r) => ({ id: r.id, eventId: r.event_id, title: (r.events as { title: string }).title }));
  const openRequests = active.reduce((n, c) => n + requestsOf(c.id).length, 0);

  return (
    <>
      <PageHeader title="Events team" description="Every month from the first idea to the last hand-in – what is open, and where it is done.">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/team/events/formats" className={buttonVariants({ variant: "outline" })} data-testid="formats-link">
            <Tags className="h-4 w-4" aria-hidden="true" />
            Categories and formats
          </Link>
          {canEdit && !planning && (
            <Link href="/team/events?new=1" className={buttonVariants()}>
              + Plan a new month
            </Link>
          )}
        </div>
      </PageHeader>
      <div className="space-y-8">
        {planning && (
          <Card data-testid="new-cycle">
            <CardHeader>
              <CardTitle>Plan a new month</CardTitle>
            </CardHeader>
            <CardContent>
              <NewCycleForm suggested={missingCycle ? monthParam(upcoming) : ""} />
            </CardContent>
          </Card>
        )}

        <section className="space-y-4" aria-labelledby="months-heading">
          <SectionHeader
            id="months-heading"
            title="In progress"
            count={active.length}
            note={openRequests ? `${plural(openRequests, "cancellation request")} waiting` : undefined}
          />
          {!active.length && !missingCycle ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white/60 px-5 py-8 text-center text-sm text-gray-500">No month in progress.{canEdit ? " Plan the next one above." : ""}</p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="months">
              {active.map((c) => {
                const asks = requestsOf(c.id);
                const ideas = ideasIn.get(c.month) ?? 0;
                const todos = c.progress.todos.filter((t) => !(t.step === "handin" && c.handInOpen.length === 0));
                const late = c.progress.late || asks.length > 0;
                return (
                  <li key={c.id} data-testid={`month-${monthParam(c.month)}`}>
                    <article className={cn("flex h-full flex-col rounded-2xl border bg-white p-4 shadow-sm sm:p-5", late ? "border-red-200" : "border-gray-200")}>
                      <header className="mb-3 flex items-start gap-2">
                        <h3 className="mr-auto text-lg font-bold text-gray-900">
                          <Link href={`/team/events/cycles/${c.id}`} className="hover:text-esn">
                            {monthLabel(c.month)}
                          </Link>
                        </h3>
                        {c.progress.late && <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Behind</span>}
                      </header>
                      <StepBar c={c} />
                      <ul className="-mx-2 mt-3 space-y-1">
                        {asks.map((a) => (
                          <TodoLink key={a.id} href={`/events/${a.eventId}`} icon={AlertTriangle} label="Cancel request" todo={a.title} tone="alert" testId={`cancel-request-${a.eventId}`} />
                        ))}
                        {todos.map((t) => {
                          const step = c.progress.steps.find((s) => s.id === t.step)!;
                          return (
                            <TodoLink
                              key={t.step}
                              href={`${stepHref(c.id, t.step)}${t.step === "form" ? "#not-answered" : ""}`}
                              icon={STEP_ICON[t.step]}
                              label={step.label}
                              todo={shortTodo(c, t.step)}
                              note={step.note}
                              tone={step.late ? "late" : "open"}
                              testId={`todo-${monthParam(c.month)}-${t.step}`}
                            />
                          );
                        })}
                        {!todos.length && !asks.length && <li className="px-2 py-2 text-sm text-gray-500">Waiting for the events</li>}
                      </ul>
                      <footer className="mt-auto flex items-center gap-3 border-t border-gray-100 pt-3 text-sm">
                        {ideas > 0 && (
                          <Link href={`/team/events/cycles/${c.id}/ideas`} className="inline-flex items-center gap-1.5 text-gray-600 hover:text-esn">
                            <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" />
                            {plural(ideas, "open idea")}
                          </Link>
                        )}
                        <Link href={`/team/events/cycles/${c.id}`} className="ml-auto inline-flex items-center gap-0.5 font-semibold text-esn hover:underline">
                          Open month
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </footer>
                    </article>
                  </li>
                );
              })}
              {missingCycle && (
                <li data-testid="missing-cycle">
                  <div className={cn("flex h-full flex-col gap-3 rounded-2xl border-2 border-dashed bg-white/60 p-4 sm:p-5", upcomingLate ? "border-red-300" : "border-gray-300")}>
                    <div className="flex items-start gap-3">
                      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", upcomingLate ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500")} aria-hidden="true">
                        <CalendarPlus className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-gray-900">{monthLabel(upcoming)}</p>
                        <p className={cn("text-sm", upcomingLate ? "font-medium text-red-700" : "text-gray-600")}>Not planned yet</p>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <dt className="text-xs text-gray-500">Ideas due</dt>
                        <dd className="font-semibold text-gray-900">{formatShortDate(upcomingTimeline.ideasDue)}</dd>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <dt className="text-xs text-gray-500">Form opens</dt>
                        <dd className={cn("font-semibold", upcomingLate ? "text-red-700" : "text-gray-900")}>{formatShortDate(upcomingTimeline.formOpens)}</dd>
                      </div>
                    </dl>
                    {!!ideasIn.get(upcoming) && <p className="text-sm text-gray-600">{plural(ideasIn.get(upcoming)!, "idea")} waiting</p>}
                    {canEdit && !planning && (
                      <Link href="/team/events?new=1" className={cn(buttonVariants({ variant: "outline" }), "mt-auto self-start")}>
                        Plan {cycleLabel(upcoming).replace(/ events$/, "")}
                      </Link>
                    )}
                  </div>
                </li>
              )}
            </ul>
          )}
        </section>

        {later.length > 0 && (
          <section className="space-y-3" aria-labelledby="later-heading">
            <SectionHeader id="later-heading" title="Ideas for later months" note="No month planned for them yet" />
            <ul className="flex flex-wrap gap-2" data-testid="ideas-without-cycle">
              {later.map(([m, n]) => (
                <li key={m} className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm">
                  <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  <span className="font-medium text-gray-900">{monthLabel(m)}</span>
                  <span className="rounded-full bg-gray-100 px-1.5 text-xs font-semibold tabular-nums text-gray-700">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {done.length > 0 && (
          <section className="space-y-3" aria-labelledby="done-heading">
            <SectionHeader id="done-heading" title="Done" count={done.length} note="Every step behind them" />
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" data-testid="months-done">
              {[...doneByYear].map(([year, list]) => (
                <div key={year} className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                  <h3 className="w-12 shrink-0 text-sm font-bold tabular-nums text-gray-500">{year}</h3>
                  <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {list.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/team/events/cycles/${c.id}`}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-sm text-gray-700 transition-colors hover:border-esn hover:text-esn"
                          title={`${monthLabel(c.month)} · ${plural(c.facts.handIn.total, "event")}`}
                        >
                          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                          {monthLabel(c.month).replace(/ \d{4}$/, "")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
