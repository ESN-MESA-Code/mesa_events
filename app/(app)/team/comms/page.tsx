import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, cycleLabel, formatDateTime, formatDue, formatShortDate, monthOf, nowMs } from "@/lib/dates";
import { Alert, Badge, Card, CardContent, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
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

  return (
    <>
      <PageHeader title="Comms" description="Each event of the month from its description to its report – approved descriptions go to the Chat space by themselves; then the pretix page and the advertising. What is next, and the action right there.">
        <MonthSelector
          options={months.map((m) => ({ value: monthParam(m), label: cycleLabel(m), note: work(m) ? `${work(m)} for Comms` : undefined }))}
          current={month ? monthParam(month) : null}
          path="/team/comms"
          storageKey="mesa:month:comms"
          explicit={!!parseMonthParam(sp.month)}
        />
      </PageHeader>
      <CommsTabs current="stages" month={month ? monthParam(month) : null} executive={isExecutive} />

      {(cancelled ?? []).length > 0 && (
        <Alert tone="warning" className="mb-6 space-y-2" data-testid="cancelled-published">
          <p className="font-medium">Cancelled after the description was published</p>
          <p>The Chat space was told. Decide whether to post a correction where the description went out.</p>
          <ul className="divide-y divide-amber-200">
            {(cancelled ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/events/${e.id}?from=comms`} className="font-medium underline">
                  {e.title}
                </Link>
                <span className="text-xs">
                  {formatDateTime(e.starts_at)} · cancelled {e.cancelled_at ? formatDateTime(e.cancelled_at) : ""}
                  {e.cancel_reason ? ` – ${e.cancel_reason}` : ""}
                </span>
                {isComms && (
                  <span className="ml-auto">
                    <ActionButton action={noteCancellation} input={{ event_id: e.id }} variant="outline">
                      Handled
                    </ActionButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {!month ? (
        <Card>
          <EmptyState>No events in the last six months or ahead.</EmptyState>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="comms-month">
              <h2 className="text-base font-semibold text-gray-900">{cycleLabel(month)}</h2>
              <p className="text-sm text-gray-600" data-testid="comms-progress">
                {descriptionsIn} of {inMonth.length} descriptions in · {advertisedCount} of {ahead.length} upcoming advertised
              </p>
              <p className="text-xs text-gray-500">{deadline ? `Description ${formatDue(deadline, now)}` : "No description deadline set"}</p>
            </div>

            <nav aria-label="Filter by stage" className="flex flex-wrap gap-2" data-testid="stage-filters">
              {(["needs", ...FILTERS.map((f) => f.id), "all"] as FilterId[]).map((id) => {
                const label = id === "needs" ? "Needs Comms" : id === "all" ? "All" : FILTERS.find((f) => f.id === id)!.label;
                if (id !== "needs" && id !== "all" && counts[id] === 0 && filter !== id) return null;
                return (
                  <Link
                    key={id}
                    href={showHref(id)}
                    aria-current={filter === id ? "page" : undefined}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      filter === id ? "border-esn bg-esn text-white" : "border-gray-300 bg-white text-gray-700 hover:border-esn hover:text-esn"
                    )}
                    data-testid={`filter-${id}`}
                  >
                    {label} <span className="tabular-nums opacity-80">{counts[id]}</span>
                  </Link>
                );
              })}
            </nav>

            <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600" data-testid="channel-filters">
              Not yet on:
              {channels.map((c) => (
                <Link
                  key={c.key}
                  href={missing === c.key ? showHref("needs") : missingHref(c.key)}
                  aria-current={missing === c.key ? "page" : undefined}
                  className={cn("rounded-full border px-2 py-0.5", missing === c.key ? "border-esn bg-esn text-white" : "border-gray-300 hover:border-esn hover:text-esn")}
                >
                  {c.name}
                </Link>
              ))}
            </p>

            {!shown.length ? (
              <EmptyState>
                {filter === "needs" ? (
                  <>
                    Nothing needs Comms in this month.{" "}
                    <Link href={showHref("all")} className="text-esn hover:underline">
                      Show all {inMonth.length}
                    </Link>
                  </>
                ) : (
                  "No events at this stage."
                )}
              </EmptyState>
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
                  return (
                    <li key={r.event_id} className="space-y-2 py-3" data-testid={`comms-row-${r.event_id}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/events/${r.event_id}/description?from=comms`} className="font-medium text-gray-900 hover:text-esn">
                          {r.title}
                        </Link>
                        <span className="text-xs text-gray-500">{formatShortDate(r.starts_at)}</span>
                        {v.marks.includes("late") && <Badge tone="red">late</Badge>}
                        {v.marks.includes("missed") && <Badge tone="gray">missed</Badge>}
                        {/* Approved = published by itself (round 2026-11-03); until the job ran, the row says so. */}
                        {r.status === "approved" && (
                          <span className="text-xs text-gray-500" data-testid="chat-publishing">
                            {publishing.has(r.event_id) ? "Going to the Chat space…" : "Goes to the Chat space once it exists"}
                          </span>
                        )}
                        <span className="ml-auto flex flex-wrap items-center gap-2" data-testid="row-action">
                          {v.current === "write" && <span className="text-xs text-gray-500">The OC writes it – reminded automatically</span>}
                          {v.current === "review" && (
                            <Link href={`/events/${r.event_id}/description?from=comms`} className={buttonVariants({ size: "sm" })}>
                              Review
                            </Link>
                          )}
                          {v.current === "pretix" && (
                            <Link href={boardHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
                              Tick pretix
                            </Link>
                          )}
                          {v.current === "advertise" && (
                            <Link href={boardHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
                              Advertise
                            </Link>
                          )}
                          {v.current === "happened" && <span className="text-xs text-gray-500">Advertised – the event is on {formatShortDate(r.starts_at)}</span>}
                          {v.current === "report" && <span className="text-xs text-gray-500">The OC writes the report – reminded automatically</span>}
                        </span>
                      </div>
                      <StageTrack steps={v.steps} label={`Stages of ${r.title}`} position={v.position} testId="stage-track" />
                      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600" data-testid="channel-chips">
                        {(() => {
                          const req = channels.filter((c) => c.required);
                          const on = req.filter((c) => ["published", "planned"].includes(statusOf.get(`${r.event_id}|${c.key}`)?.state ?? "")).length;
                          return req.length > 0 ? (
                            <Link href={boardHref} className={cn("font-semibold hover:underline", on === req.length ? "text-emerald-700" : "text-amber-800")} data-testid="channel-coverage">
                              {on}/{req.length} channels planned
                            </Link>
                          ) : null;
                        })()}
                        {channels.map((c) => {
                          const st = statusOf.get(`${r.event_id}|${c.key}`);
                          const state = (st?.state ?? "not_planned") as ChannelState;
                          return (
                            <span key={c.key} title={`${c.name}: ${stateLabel(c.key, state)}${st?.at ? ` ${formatShortDate(st.at)}` : ""}${st?.reason ? ` – ${st.reason}` : ""}`} className={cn(state === "published" && "text-emerald-700", state === "planned" && "text-esn")}>
                              {c.name} {STATE_MARK[state]}
                              {state === "planned" && st?.at ? ` ${formatShortDate(st.at)}` : ""}
                            </span>
                          );
                        })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
