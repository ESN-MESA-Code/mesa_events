import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Check, Clock, FileText, Megaphone } from "lucide-react";
import { addMonths, berlinTime, cycleLabel, dueUrgency, formatDateTime, formatDue, formatShortDate, monthOf, nowMs } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { DateTile } from "@/components/DateTile";
import { ActionButton } from "@/components/ActionButton";
import { StageTrack } from "@/components/status";
import { MonthSelector } from "@/components/MonthSelector";
import { CommsTabs } from "@/components/CommsTabs";
import { noteCancellation } from "@/app/actions/descriptions";
import { hasRole } from "@/lib/roles";
import { loadEsn } from "@/lib/esn/load";
import { FILTERS, STAGES, eventStage, parseFilter, stageCounts, type FilterId } from "@/lib/commsStages";
import { monthParam, parseMonthParam, pickMonth } from "@/lib/month";
import { cn } from "@/lib/utils";
import { STATE_MARK, boardMonthFor, stateLabel, type ChannelState } from "@/lib/publishing";

export const metadata: Metadata = { title: "Comms" };

type Row = {
  event_id: string;
  title: string;
  starts_at: string;
  deadline: string | null;
  status: string;
  submitted_at: string | null;
  published_at: string | null;
  late: boolean;
  cycle_id: string | null;
  cycle_month: string | null;
  missed: boolean;
};

// The Comms team's page, one month at a time (brief 2026-10-29, C): each
// event of the month with its stage – description to write, in review,
// approved (published to the Chat space by itself), pretix page, advertised
// on Telegram and Instagram, the event, the report (round 2026-11-03) – and
// the action of that stage right there. Filters by stage ("Needs Comms" first);
// late and missed are marks on the row. Months: those with events from half
// a year back on; the page opens on the first one with work for Comms.
export default async function CommsPage({ searchParams }: { searchParams: Promise<{ month?: string; show?: string; missing?: string }> }) {
  const viewer = await requirePageRole(["comms"], { executiveMayRead: true, page: "Comms" });
  const isComms = hasRole(viewer.roles, "comms");
  const isExecutive = hasRole(viewer.roles, "executive");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const [{ data }, { data: cancelled }] = await Promise.all([
    supabase.rpc("description_overview"),
    // Cancelled after the description went out: Comms decides about a correction (review 2026-10-29 A2).
    supabase
      .from("events")
      .select("id, title, starts_at, cancelled_at, cancel_reason, descriptions!inner(published_at)")
      .eq("status", "cancelled")
      .is("cancellation_noted_at", null)
      .not("descriptions.published_at", "is", null)
      .order("starts_at"),
  ]);
  const from = addMonths(thisMonth, -6);
  const rows = ((data ?? []) as Row[]).filter((r) => monthOf(r.starts_at) >= from).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const ids = rows.map((r) => r.event_id);
  // Per channel: published, planned, skipped or not planned (brief 2026-10-29, E1) – for the
  // stages too: the pretix tick and the posts on the advertising channels (round 2026-11-03).
  const [esn, { data: requested }, { data: statusRows }, { data: channelRows }] = await Promise.all([
    loadEsn(supabase, ids),
    // Approved descriptions go to the Chat space by a job: until it ran, the row says so.
    supabase.from("descriptions").select("event_id").eq("status", "approved").not("publish_requested_at", "is", null).in("event_id", ids),
    supabase.rpc("publication_status", { events: ids }),
    supabase.from("publication_channels").select("key, name, required, schedulable").eq("enabled", true).order("position"),
  ]);
  const publishing = new Set((requested ?? []).map((d) => d.event_id));
  // ESN Activities is the executive board's and has its own page (round 2026-11-03).
  const channels = (channelRows ?? []).filter((c) => c.key !== "esn");
  const statusOf = new Map((statusRows ?? []).map((x) => [`${x.event_id}|${x.channel}`, x]));
  const advertising = channels.filter((c) => c.required && c.schedulable);
  const pretixOn = channels.some((c) => c.key === "pretix");
  const views = new Map(
    rows.map((r) => {
      const e = esn.get(r.event_id);
      const state = (channel: string) => statusOf.get(`${r.event_id}|${channel}`)?.state;
      return [
        r.event_id,
        eventStage({
          description: r.status,
          startsAt: r.starts_at,
          now,
          late: r.late,
          missed: r.missed,
          reportIn: !!e?.report,
          pretix: !pretixOn || state("pretix") === "published",
          // Posted, or skipped on purpose, on every advertising channel.
          advertised: advertising.every((c) => ["published", "skipped"].includes(state(c.key) ?? "")),
        }),
      ];
    })
  );
  const months = [...new Set(rows.map((r) => monthOf(r.starts_at)))].sort();
  const work = (m: string) => rows.filter((r) => monthOf(r.starts_at) === m && views.get(r.event_id)!.needsComms).length;
  const month = pickMonth(
    months.map((m) => ({ month: m, hasWork: work(m) > 0 })),
    parseMonthParam(sp.month),
    thisMonth
  );

  const inMonth = month ? rows.filter((r) => monthOf(r.starts_at) === month) : [];
  const monthViews = inMonth.map((r) => views.get(r.event_id)!);
  const counts = stageCounts(monthViews);
  const filter = parseFilter(sp.show);
  const missing = channels.find((c) => c.key === sp.missing)?.key ?? null;
  const shown = inMonth.filter((r) => {
    if (missing) return statusOf.get(`${r.event_id}|${missing}`)?.state !== "published";
    const v = views.get(r.event_id)!;
    return filter === "all" || (filter === "needs" ? v.needsComms : v.filter === filter);
  });
  const descriptionsIn = inMonth.filter((r) => ["submitted", "approved", "published"].includes(r.status)).length;
  const ahead = inMonth.filter((r) => Date.parse(r.starts_at) > now);
  const advertisedCount = ahead.filter((r) => views.get(r.event_id)!.steps[STAGES.findIndex((st) => st.id === "advertise")].state === "done").length;
  const deadline = inMonth.find((r) => r.deadline)?.deadline ?? null;
  const showHref = (show: FilterId) => `/team/comms?month=${monthParam(month!)}${show === "needs" ? "" : `&show=${show}`}`;
  const missingHref = (channel: string) => `/team/comms?month=${monthParam(month!)}&show=all&missing=${channel}`;
  // A passed deadline is history, not an alarm: only one still ahead is tinted.
  const deadlineUrgency = deadline && Date.parse(deadline) > now ? dueUrgency(deadline, now) : null;

  return (
    <>
      <PageHeader title="Comms" description="Every event of the month from its description to its report – and what Comms does next.">
        <MonthSelector
          options={months.map((m) => ({ value: monthParam(m), label: cycleLabel(m), note: work(m) ? `${work(m)} for Comms` : undefined }))}
          current={month ? monthParam(month) : null}
          path="/team/comms"
          storageKey="mesa:month:comms"
          explicit={!!parseMonthParam(sp.month)}
        />
      </PageHeader>
      <CommsTabs current="stages" month={month ? monthParam(month) : null} executive={isExecutive} />

      <div className="space-y-6">
        {(cancelled ?? []).length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5" data-testid="cancelled-published">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800" aria-hidden="true">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="font-bold text-gray-900">Cancelled after the description was published</h2>
                <p className="text-sm text-amber-900">The Chat space was told. Decide whether to post a correction where the description went out.</p>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {(cancelled ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link href={`/events/${e.id}?from=comms`} className="block font-semibold text-gray-900 hover:text-esn">
                      {e.title}
                    </Link>
                    <span className="block text-xs text-gray-600">
                      {formatDateTime(e.starts_at)} · cancelled {e.cancelled_at ? formatDateTime(e.cancelled_at) : ""}
                      {e.cancel_reason ? ` – ${e.cancel_reason}` : ""}
                    </span>
                  </span>
                  {isComms && (
                    <ActionButton action={noteCancellation} input={{ event_id: e.id }} variant="outline">
                      Handled
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {!month ? (
          <Card>
            <EmptyState>No events in the last six months or ahead.</EmptyState>
          </Card>
        ) : (
          <>
            <section aria-label={cycleLabel(month)} data-testid="comms-month">
              <p className="sr-only" data-testid="comms-progress">
                {descriptionsIn} of {inMonth.length} descriptions in · {advertisedCount} of {ahead.length} upcoming advertised
              </p>
              <ul className="grid gap-3 sm:grid-cols-3">
                <Stat icon={FileText} label="Descriptions in" value={descriptionsIn} total={inMonth.length} />
                <Stat icon={Megaphone} label="Upcoming advertised" value={advertisedCount} total={ahead.length} />
                <li className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      deadlineUrgency === "urgent" ? "bg-red-50 text-red-700" : deadlineUrgency === "soon" ? "bg-amber-50 text-amber-800" : "bg-esn/5 text-esn"
                    )}
                    aria-hidden="true"
                  >
                    <Clock className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-500">Description deadline</span>
                    <span className="block truncate font-semibold text-gray-900">{deadline ? formatDue(deadline, now).replace(/^\w/, (ch) => ch.toUpperCase()) : "Not set"}</span>
                  </span>
                </li>
              </ul>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="space-y-3 border-b border-gray-100 p-4 sm:px-5">
                <nav aria-label="Filter by stage" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap" data-testid="stage-filters">
                  {(["needs", ...FILTERS.map((f) => f.id), "all"] as FilterId[]).map((id) => {
                    const label = id === "needs" ? "Needs Comms" : id === "all" ? "All" : FILTERS.find((f) => f.id === id)!.label;
                    if (id !== "needs" && id !== "all" && counts[id] === 0 && filter !== id) return null;
                    const on = filter === id && !missing;
                    return (
                      <Link
                        key={id}
                        href={showHref(id)}
                        aria-current={filter === id ? "page" : undefined}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                          on ? "border-esn bg-esn text-white" : "border-gray-200 bg-white text-gray-700 hover:border-esn hover:text-esn"
                        )}
                        data-testid={`filter-${id}`}
                      >
                        {label}{" "}
                        <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", on ? "bg-white/20" : id === "needs" && counts.needs ? "bg-esn text-white" : "bg-gray-100 text-gray-600")}>{counts[id]}</span>
                      </Link>
                    );
                  })}
                </nav>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500" data-testid="channel-filters">
                  <span className="mr-1 font-medium">Not yet on</span>
                  {channels.map((c) => (
                    <Link
                      key={c.key}
                      href={missing === c.key ? showHref("needs") : missingHref(c.key)}
                      aria-current={missing === c.key ? "page" : undefined}
                      className={cn("rounded-md border px-2 py-0.5 font-medium transition-colors", missing === c.key ? "border-esn bg-esn text-white" : "border-gray-200 text-gray-600 hover:border-esn hover:text-esn")}
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>

              {!shown.length ? (
                <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600" aria-hidden="true">
                    <Check className="h-6 w-6" />
                  </span>
                  <p className="text-sm text-gray-600">
                    {filter === "needs" && !missing ? (
                      <>
                        Nothing needs Comms in {cycleLabel(month).replace(/ events$/, "")}.{" "}
                        <Link href={showHref("all")} className="font-semibold text-esn hover:underline">
                          Show all {inMonth.length}
                        </Link>
                      </>
                    ) : (
                      "No events at this stage."
                    )}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100" data-testid="comms-rows">
                  {shown.map((r) => {
                    const v = views.get(r.event_id)!;
                    // The board of the month its first post goes out in – for an event ahead with none yet, the first board that lists it (round 2026-11-02).
                    const firstPost = channels
                      .filter((c) => c.schedulable)
                      .map((c) => statusOf.get(`${r.event_id}|${c.key}`))
                      .flatMap((x) => (x?.at && ["published", "planned"].includes(x.state) ? [x.at] : []))
                      .sort()[0];
                    const boardHref = `/team/comms/schedule?month=${monthParam(firstPost ? monthOf(firstPost) : boardMonthFor(month!, thisMonth))}&event=${r.event_id}`;
                    const req = channels.filter((c) => c.required);
                    const on = req.filter((c) => ["published", "planned"].includes(statusOf.get(`${r.event_id}|${c.key}`)?.state ?? "")).length;
                    const past = Date.parse(r.starts_at) <= now;
                    return (
                      <li key={r.event_id} className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5" data-testid={`comms-row-${r.event_id}`}>
                        <DateTile iso={r.starts_at} tone={past ? "muted" : "default"} />
                        <div className="min-w-0 flex-1 space-y-2.5">
                          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium tabular-nums text-gray-600">
                                {berlinTime(r.starts_at)}
                                {/* Approved = published by itself (round 2026-11-03); until the job ran, the row says so. */}
                                {r.status === "approved" && (
                                  <span data-testid="chat-publishing"> · {publishing.has(r.event_id) ? "Going to the Chat space…" : "Goes to the Chat space once it exists"}</span>
                                )}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={`/events/${r.event_id}/description?from=comms`} className="font-semibold leading-snug text-gray-900 hover:text-esn">
                                  {r.title}
                                </Link>
                                {v.marks.includes("late") && <Badge tone="red">late</Badge>}
                                {v.marks.includes("missed") && <Badge tone="gray">missed</Badge>}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2" data-testid="row-action">
                              {v.current === "write" && <span className="text-xs text-gray-500">The OC writes it – reminded automatically</span>}
                              {v.current === "review" && (
                                <Link href={`/events/${r.event_id}/description?from=comms`} className={buttonVariants({ size: "sm" })}>
                                  Review
                                </Link>
                              )}
                              {v.current === "pretix" && (
                                <Link href={`/team/comms/pretix?event=${r.event_id}#pretix-${r.event_id}`} className={buttonVariants({ size: "sm" })}>
                                  Set up pretix
                                </Link>
                              )}
                              {v.current === "advertise" && (
                                <Link href={boardHref} className={buttonVariants({ size: "sm" })}>
                                  Advertise
                                </Link>
                              )}
                              {v.current === "happened" && <span className="text-xs text-gray-500">Advertised – the event is on {formatShortDate(r.starts_at)}</span>}
                              {v.current === "report" && <span className="text-xs text-gray-500">The OC writes the report – reminded automatically</span>}
                            </div>
                          </div>
                          <StageTrack steps={v.steps} label={`Stages of ${r.title}`} position={v.position} testId="stage-track" />
                          {/* Fixed columns (round 2026-11-09): each channel sits under the same spot in every row. */}
                          <div
                            className="flex flex-wrap items-center gap-1.5 text-xs sm:grid sm:gap-1"
                            style={{ gridTemplateColumns: `${req.length > 0 ? "11rem " : ""}repeat(${channels.length}, minmax(0, 1fr))` }}
                            data-testid="channel-chips"
                          >
                            {req.length > 0 && (
                              <Link
                                href={boardHref}
                                className={cn("mr-1 inline-flex items-center gap-1 font-semibold hover:underline", on === req.length ? "text-emerald-700" : "text-amber-800")}
                                data-testid="channel-coverage"
                              >
                                <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
                                {on}/{req.length} channels planned
                              </Link>
                            )}
                            {channels.map((c) => {
                              const st = statusOf.get(`${r.event_id}|${c.key}`);
                              const state = (st?.state ?? "not_planned") as ChannelState;
                              return (
                                <span
                                  key={c.key}
                                  title={`${c.name}: ${stateLabel(c.key, state)}${st?.at ? ` ${formatShortDate(st.at)}` : ""}${st?.reason ? ` – ${st.reason}` : ""}`}
                                  className={cn(
                                    "inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 sm:justify-self-start",
                                    state === "published" && "bg-emerald-50 text-emerald-800",
                                    state === "planned" && "bg-esn/5 text-esn",
                                    state === "skipped" && "bg-gray-100 text-gray-500 line-through",
                                    state === "not_planned" && "bg-gray-50 text-gray-500"
                                  )}
                                >
                                  {c.name} {STATE_MARK[state]}
                                  {state === "planned" && st?.at ? ` ${formatShortDate(st.at)}` : ""}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

/** A count on top of the month: icon, label, "3 / 6" and a thin bar. */
function Stat({ icon: Icon, label, value, total }: { icon: LucideIcon; label: string; value: number; total: number }) {
  const full = total > 0 && value >= total;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", full ? "bg-emerald-50 text-emerald-700" : "bg-esn/5 text-esn")} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-gray-500">{label}</span>
        <span className="block font-semibold tabular-nums text-gray-900">
          {value} <span className="font-normal text-gray-400">/ {total}</span>
        </span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
          <span className={cn("block h-full rounded-full", full ? "bg-emerald-500" : "bg-esn")} style={{ width: `${total ? Math.round((value / total) * 100) : 0}%` }} />
        </span>
      </span>
    </li>
  );
}
