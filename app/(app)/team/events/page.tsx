import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, formatShortDate, monthLabel, monthOf, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { cyclesWithProgress, type CycleWithProgress } from "@/lib/cycleFacts";
import { stepHref, type StepId } from "@/lib/cycle";
import { plural } from "@/lib/plural";
import { monthParam, parseMonthParam } from "@/lib/month";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
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

// The Events team's page (round 2026-11-03): one card per month in
// progress, side by side in date order – what is open in each, in a few
// words, linking to the tab where it is done; cancellation requests of the
// OCs first. The month the timeline plans next and has no cycle yet is a
// dashed card, ideas for later months without a cycle a line below; the done
// months one line at the end. ?month=YYYY-MM (older links) opens that month.
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

  const active = cycles.filter((c) => !c.progress.done);
  const done = cycles.filter((c) => c.progress.done).reverse();
  const ideasIn = new Map<string, number>();
  for (const i of ideaRows ?? []) {
    const m = `${i.proposed_date.slice(0, 7)}-01`;
    ideasIn.set(m, (ideasIn.get(m) ?? 0) + 1);
  }
  const later = [...ideasIn].filter(([m]) => m !== upcoming && !cycles.some((c) => c.month === m)).sort(([x], [y]) => x.localeCompare(y));
  const requestsOf = (cycleId: string) =>
    (requests ?? []).filter((r) => (r.events as { cycle_id: string | null } | null)?.cycle_id === cycleId).map((r) => ({ id: r.id, eventId: r.event_id, title: (r.events as { title: string }).title }));

  return (
    <>
      <PageHeader title="Events team">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !planning && (
            <Link href="/team/events?new=1" className={buttonVariants({ size: "sm" })}>
              + Plan a new month
            </Link>
          )}
          <Link href="/team/events/formats" className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="formats-link">
            Categories and formats
          </Link>
        </div>
      </PageHeader>
      <div className="space-y-6">
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

        {!cycles.length && !missingCycle && <EmptyState>No month planned yet.</EmptyState>}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="months">
          {active.map((c) => {
            const asks = requestsOf(c.id);
            const ideas = ideasIn.get(c.month) ?? 0;
            const todos = c.progress.todos.filter((t) => !(t.step === "handin" && c.handInOpen.length === 0));
            return (
              <li key={c.id} data-testid={`month-${monthParam(c.month)}`}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 pt-5">
                    <Link href={`/team/events/cycles/${c.id}`} className="text-base font-semibold text-gray-900 hover:text-esn">
                      {monthLabel(c.month)}
                    </Link>
                    <ul className="space-y-2 text-sm">
                      {asks.map((a) => (
                        <li key={a.id} data-testid={`cancel-request-${a.eventId}`}>
                          <Link href={`/events/${a.eventId}`} className="flex items-baseline justify-between gap-3 rounded-md bg-red-50 px-2 py-1.5 text-red-800 hover:underline">
                            <span className="font-medium">Cancel request</span>
                            <span className="truncate text-right">{a.title}</span>
                          </Link>
                        </li>
                      ))}
                      {todos.map((t) => {
                        const step = c.progress.steps.find((s) => s.id === t.step)!;
                        return (
                          <li key={t.step} data-testid={`todo-${monthParam(c.month)}-${t.step}`}>
                            <Link
                              href={`${stepHref(c.id, t.step)}${t.step === "form" ? "#not-answered" : ""}`}
                              className={cn("flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 hover:underline", step.late ? "bg-red-50 text-red-800" : "bg-esn/5 text-esn-dark")}
                            >
                              <span className="font-medium">{step.label}</span>
                              <span className="text-right">{shortTodo(c, t.step)}</span>
                            </Link>
                            {step.note && <p className={cn("px-2 pt-0.5 text-xs", step.late ? "text-red-700" : "text-gray-500")}>{step.note}</p>}
                          </li>
                        );
                      })}
                      {!todos.length && !asks.length && <li className="px-2 text-gray-500">Waiting for the events</li>}
                    </ul>
                    {ideas > 0 && (
                      <Link href={`/team/events/cycles/${c.id}/ideas`} className="mt-auto px-2 text-xs text-esn hover:underline">
                        {plural(ideas, "open idea")}
                      </Link>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
          {missingCycle && (
            <li data-testid="missing-cycle">
              <div className={cn("flex h-full flex-col gap-2 rounded-lg border-2 border-dashed p-5 text-sm", Date.parse(upcomingTimeline.formOpens) < now ? "border-red-300" : "border-gray-300")}>
                <span className="text-base font-semibold text-gray-900">{monthLabel(upcoming)}</span>
                <span className="text-gray-600">Not planned yet</span>
                <span className="text-xs text-gray-500">
                  ideas by {formatShortDate(upcomingTimeline.ideasDue)} · form opens {formatShortDate(upcomingTimeline.formOpens)}
                  {ideasIn.get(upcoming) ? ` · ${plural(ideasIn.get(upcoming)!, "idea")} waiting` : ""}
                </span>
                {canEdit && !planning && (
                  <Link href="/team/events?new=1" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-auto self-start")}>
                    Plan {cycleLabel(upcoming).replace(/ events$/, "")}
                  </Link>
                )}
              </div>
            </li>
          )}
        </ul>

        {later.length > 0 && (
          <p className="text-xs text-gray-500" data-testid="ideas-without-cycle">
            Ideas for later months: {later.map(([m, n]) => `${monthLabel(m)} (${n})`).join(", ")}
          </p>
        )}
        {done.length > 0 && (
          <p className="text-sm text-gray-500" data-testid="months-done">
            Done:{" "}
            {done.map((c, i) => (
              <span key={c.id}>
                {i > 0 && " · "}
                <Link href={`/team/events/cycles/${c.id}`} className="hover:text-esn hover:underline">
                  {monthLabel(c.month)}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    </>
  );
}
