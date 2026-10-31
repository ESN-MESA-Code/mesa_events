import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, cyclePlannedIn, formatDateTime, monthOf, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { stepHref } from "@/lib/cycle";
import { monthParam, parseMonthParam, pickMonth } from "@/lib/month";
import { plural } from "@/lib/plural";
import { photosIn } from "@/lib/photos";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { DESCRIPTION_STATUS, EventStatusBadge, Stepper } from "@/components/status";
import { RemindButton } from "@/components/RemindButton";
import { cn } from "@/lib/utils";
import { MonthSelector } from "@/components/MonthSelector";
import type { EventStatus } from "@/lib/labels";
import { NewCycleForm } from "./NewCycleForm";

export const metadata: Metadata = { title: "Events team" };

// The Events team's page, one month at a time (brief 2026-10-29, C): the
// month's cycle as a stepper with its main action, then that month's events
// with status, staffing, description and hand-in. The cycle page stays the
// detail view (schedule, form, roster) – one click from here. The page opens
// on the first month with work for Events (usually next month).
export default async function EventsTeamPage({ searchParams }: { searchParams: Promise<{ month?: string; new?: string }> }) {
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, page: "Events team" });
  const canEdit = hasRole(viewer.roles, "events");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const { data: cycleRows } = await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month");
  const cycles = await cyclesWithProgress(supabase, cycleRows ?? []);
  // Work for Events: a cycle not done, unless it only waits for events to happen.
  const hasWork = (c: (typeof cycles)[number]) => !c.progress.done && !(c.progress.current === "handin" && c.handInOpen.length === 0);
  const month = pickMonth(
    cycles.map((c) => ({ month: c.month, hasWork: hasWork(c) })),
    parseMonthParam(sp.month),
    monthOf(new Date(now).toISOString())
  );
  const cycle = cycles.find((c) => c.month === month) ?? null;
  const planning = canEdit && (sp.new === "1" || !cycles.length);

  const [{ data: events }, { data: handIn }] = cycle
    ? await Promise.all([
        supabase
          .from("events")
          .select("id, title, starts_at, status, helpers_needed, assignments(role, status, profiles(full_name)), descriptions(status), event_photo_folders(photo_count, marked_uploaded_at)")
          .eq("cycle_id", cycle.id)
          .neq("status", "dropped")
          .order("starts_at"),
        supabase.rpc("cycle_hand_in", { cycles: [cycle.id] }),
      ])
    : [{ data: [] }, { data: [] }];
  const handInOf = new Map((handIn ?? []).map((h) => [h.event_id, h]));

  return (
    <>
      <PageHeader title="Events team" description="One month at a time: the cycle step by step, then the month's events with staffing, description and hand-in.">
        <MonthSelector
          options={cycles.map((c) => ({
            value: monthParam(c.month),
            label: cycleLabel(c.month),
            note: c.progress.done ? "done" : (c.progress.steps.find((s) => s.state === "current")?.label ?? undefined),
          }))}
          current={month && !planning ? monthParam(month) : null}
          path="/team/events"
          storageKey="mesa:month:events"
          explicit={!!parseMonthParam(sp.month) || planning}
          extra={canEdit ? { label: "+ Plan a new month", href: "/team/events?new=1" } : undefined}
        />
      </PageHeader>
      <div className="space-y-6">
        {planning && (
          <Card data-testid="new-cycle">
            <CardHeader>
              <CardTitle>Plan a new month</CardTitle>
            </CardHeader>
            <CardContent>
              <NewCycleForm />
            </CardContent>
          </Card>
        )}

        {!planning && !cycle && (
          <Card>
            <EmptyState>No cycle yet{canEdit ? " – plan the next month (“+ Plan a new month” in the month list)." : "."}</EmptyState>
          </Card>
        )}

        {!planning && cycle && (
          <>
            <Card data-testid="month-cycle">
              <CardContent className="space-y-3 pt-5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/team/events/cycles/${cycle.id}`} className="text-base font-semibold text-gray-900 hover:text-esn">
                    {cycleLabel(cycle.month)}
                  </Link>
                  <span className="text-xs text-gray-500">{cyclePlannedIn(cycle.month)}</span>
                  <Link href={`/team/events/cycles/${cycle.id}`} className="ml-auto text-sm text-esn hover:underline">
                    Schedule →
                  </Link>
                </div>
                <Stepper steps={cycle.progress.steps.map((s) => ({ ...s, href: stepHref(cycle.id, s.id) }))} label={`Steps of ${cycleLabel(cycle.month)} – each opens its page`} testId="month-stepper" />
                <p className="text-sm text-gray-600" data-testid="month-summary">
                  {cycle.progress.summary}
                  {cycle.status === "form_open" && cycle.form_closes_at && ` · closes ${formatDateTime(cycle.form_closes_at)}`}
                </p>
                <Link
                  href={stepHref(cycle.id, cycle.progress.current ?? "done")}
                  className={
                    cycle.progress.current
                      ? "block rounded-md bg-esn/5 border border-esn/30 px-3 py-2 text-sm font-medium text-esn-dark hover:underline"
                      : "block text-sm text-emerald-700"
                  }
                  data-testid="month-next"
                >
                  {cycle.progress.current ? `→ ${cycle.progress.action}` : `✓ ${cycle.progress.action}`}
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>The month&apos;s events</CardTitle>
                <Badge>{(events ?? []).length}</Badge>
              </CardHeader>
              <CardContent>
                {!events?.length ? (
                  <EmptyState>No events in this month yet – add them on the schedule.</EmptyState>
                ) : (
                  <ul className="divide-y divide-gray-100 text-sm" data-testid="month-events">
                    {events.map((e) => {
                      const active = (e.assignments ?? []).filter((a) => a.status === "active");
                      const ocName = (active.find((a) => a.role === "oc")?.profiles as { full_name: string } | null)?.full_name ?? null;
                      const oc = active.some((a) => a.role === "oc");
                      const helpers = active.filter((a) => a.role === "helper").length;
                      const description = (e.descriptions as { status: string } | null)?.status ?? "missing";
                      const h = handInOf.get(e.id);
                      const started = Date.parse(e.starts_at) <= now;
                      const missing = h
                        ? [!h.signed_off && "attendance list", !h.photos_in && "photos", !h.report_in && "event report", h.belege_missing > 0 && plural(h.belege_missing, "paper receipt")].filter(Boolean)
                        : [!photosIn(e.event_photo_folders as never) && "photos"].filter(Boolean);
                      const confirmed = cycle.status === "confirmed";
                      const running = !["cancelled", "dropped"].includes(e.status);
                      // What needs someone (usability review #21): staffing, a description not in, a hand-in open.
                      const descOpen = confirmed && running && !started && ["missing", "draft", "changes_requested"].includes(description);
                      const deadlinePassed = !!cycle.description_deadline && Date.parse(cycle.description_deadline) < now;
                      const staffOpen = confirmed && running && !started && (!oc || helpers < e.helpers_needed);
                      const handInOpen = confirmed && running && started && missing.length > 0;
                      const problem = descOpen || staffOpen || handInOpen;
                      const desc = DESCRIPTION_STATUS[description] ?? { label: description, tone: "gray" as const };
                      return (
                        <li
                          key={e.id}
                          className={cn("grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3", problem && "-mx-2 border-l-4 px-2", problem && (descOpen && deadlinePassed ? "border-red-400" : "border-amber-400"))}
                          data-testid={`month-event-${e.id}`}
                          data-problem={problem || undefined}
                        >
                          <span className="tabular-nums text-gray-600">{formatDateTime(e.starts_at)}</span>
                          <span className="min-w-0">
                            <Link href={`/events/${e.id}?from=events`} className="font-medium text-gray-900 hover:text-esn">
                              {e.title}
                            </Link>
                            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                              <span className={staffOpen ? "font-medium text-amber-800" : undefined} data-testid="staffing">
                                {confirmed ? `${ocName ? `OC ${ocName}` : "no OC"} · ${helpers}/${e.helpers_needed} helpers` : `${plural(e.helpers_needed, "helper")} needed`}
                              </span>
                              {confirmed && (
                                <span data-testid="description">
                                  Description:{" "}
                                  <Badge tone={descOpen ? (deadlinePassed ? "red" : "amber") : desc.tone} className="align-middle">
                                    {desc.label}
                                  </Badge>
                                </span>
                              )}
                              {confirmed && (
                                <span data-testid="handin" className={handInOpen ? "font-medium text-amber-800" : undefined}>
                                  Hand-in:{" "}
                                  {e.status === "cancelled"
                                    ? "–"
                                    : !started
                                      ? "after the event"
                                      : missing.length
                                        ? `missing ${missing.join(", ")}`
                                        : "✓ handed in"}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-2 justify-self-start sm:justify-self-end">
                            {canEdit && ocName && descOpen && <RemindButton eventId={e.id} about="description" title={e.title} />}
                            {canEdit && ocName && handInOpen && missing.includes("event report") && <RemindButton eventId={e.id} about="report" title={e.title} />}
                            <EventStatusBadge status={e.status as EventStatus} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
