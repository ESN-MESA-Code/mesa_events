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
import { EsnUpload } from "@/components/EsnUpload";
import { noteCancellation, publishDescription } from "@/app/actions/descriptions";
import { hasRole } from "@/lib/roles";
import { loadEsn } from "@/lib/esn/load";
import { FILTERS, eventStage, parseFilter, stageCounts, type FilterId } from "@/lib/commsStages";
import { monthParam, parseMonthParam, pickMonth } from "@/lib/month";
import { cn } from "@/lib/utils";
import { RemindButton } from "./RemindButton";
import { STATE_LABEL, STATE_MARK, type ChannelState } from "@/lib/publishing";

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
// approved, published, the event, the report, ESN Activities – and the
// action of that stage right there. Filters by stage ("Needs Comms" first);
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
  const [esn, { data: requested }] = await Promise.all([
    loadEsn(supabase, rows.map((r) => r.event_id)),
    // Published by a job: until it ran, the row says so instead of offering "Publish" again.
    supabase.from("descriptions").select("event_id").eq("status", "approved").not("publish_requested_at", "is", null).in("event_id", rows.map((r) => r.event_id)),
  ]);
  const publishing = new Set((requested ?? []).map((d) => d.event_id));
  const views = new Map(
    rows.map((r) => {
      const e = esn.get(r.event_id);
      return [r.event_id, eventStage({ description: r.status, startsAt: r.starts_at, now, late: r.late, missed: r.missed, reportIn: !!e?.report, esn: e?.status.state ?? "not_ready" })];
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
  // Per channel: published, planned, skipped or not planned (brief 2026-10-29, E1).
  const [{ data: statusRows }, { data: channelRows }] = await Promise.all([
    supabase.rpc("publication_status", { events: inMonth.map((r) => r.event_id) }),
    supabase.from("publication_channels").select("key, name, required").eq("enabled", true).order("position"),
  ]);
  const channels = channelRows ?? [];
  const statusOf = new Map((statusRows ?? []).map((x) => [`${x.event_id}|${x.channel}`, x]));
  const missing = channels.find((c) => c.key === sp.missing)?.key ?? null;
  const shown = inMonth.filter((r) => {
    if (missing) return statusOf.get(`${r.event_id}|${missing}`)?.state !== "published";
    const v = views.get(r.event_id)!;
    return filter === "all" || (filter === "needs" ? v.needsComms : v.filter === filter);
  });
  const descriptionsIn = inMonth.filter((r) => ["submitted", "approved", "published"].includes(r.status)).length;
  const happened = inMonth.filter((r) => Date.parse(r.starts_at) <= now);
  const uploaded = happened.filter((r) => esn.get(r.event_id)?.status.state === "uploaded").length;
  const deadline = inMonth.find((r) => r.deadline)?.deadline ?? null;
  const showHref = (show: FilterId) => `/team/comms?month=${monthParam(month!)}${show === "needs" ? "" : `&show=${show}`}`;
  const missingHref = (channel: string) => `/team/comms?month=${monthParam(month!)}&show=all&missing=${channel}`;

  return (
    <>
      <PageHeader title="Comms" description="Each event of the month from its description to ESN Activities – what is next, and the action right there.">
        <div className="flex flex-wrap items-center gap-3">
          <MonthSelector
            options={months.map((m) => ({ value: monthParam(m), label: cycleLabel(m), note: work(m) ? `${work(m)} for Comms` : undefined }))}
            current={month ? monthParam(month) : null}
            path="/team/comms"
            storageKey="mesa:month:comms"
            explicit={!!parseMonthParam(sp.month)}
          />
        </div>
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
                {descriptionsIn} of {inMonth.length} descriptions in · {uploaded} of {happened.length} on ESN Activities
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
                  const e = esn.get(r.event_id);
                  return (
                    <li key={r.event_id} className="space-y-2 py-3" data-testid={`comms-row-${r.event_id}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/events/${r.event_id}/description?from=comms`} className="font-medium text-gray-900 hover:text-esn">
                          {r.title}
                        </Link>
                        <span className="text-xs text-gray-500">{formatShortDate(r.starts_at)}</span>
                        {v.marks.includes("late") && <Badge tone="red">late</Badge>}
                        {v.marks.includes("missed") && <Badge tone="gray">missed</Badge>}
                        <span className="ml-auto flex flex-wrap items-center gap-2" data-testid="row-action">
                          {v.current === "write" && (isComms ? <RemindButton eventId={r.event_id} about="description" /> : <span className="text-xs text-gray-500">The OC writes it</span>)}
                          {v.current === "review" && (
                            <Link href={`/events/${r.event_id}/description?from=comms`} className={buttonVariants({ size: "sm" })}>
                              Review
                            </Link>
                          )}
                          {v.current === "approved" &&
                            (publishing.has(r.event_id) ? (
                              <span className="text-xs text-gray-500">Publishing to the Chat space…</span>
                            ) : isComms ? (
                              <ActionButton action={publishDescription} input={{ event_id: r.event_id }} confirm={`Publish “${r.title}” to the event's Chat space?`}>
                                Publish
                              </ActionButton>
                            ) : (
                              <span className="text-xs text-gray-500">Ready to publish</span>
                            ))}
                          {v.current === "published" && <span className="text-xs text-gray-500">Published – the event is on {formatShortDate(r.starts_at)}</span>}
                          {v.current === "report" && (isComms ? <RemindButton eventId={r.event_id} about="report" /> : <span className="text-xs text-gray-500">The OC writes the report</span>)}
                          {v.current === null && e?.status.state === "uploaded" && (
                            <a href={e.status.url} target="_blank" rel="noopener noreferrer" className="text-xs text-esn hover:underline">
                              View on ESN Activities
                            </a>
                          )}
                        </span>
                      </div>
                      <StageTrack steps={v.steps} label={`Stages of ${r.title}`} position={v.position} testId="stage-track" />
                      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600" data-testid="channel-chips">
                        {(() => {
                          const req = channels.filter((c) => c.required);
                          const on = req.filter((c) => ["published", "planned"].includes(statusOf.get(`${r.event_id}|${c.key}`)?.state ?? "")).length;
                          return req.length > 0 ? (
                            <Link href={`/team/comms/schedule?month=${monthParam(month!)}`} className={cn("font-semibold hover:underline", on === req.length ? "text-emerald-700" : "text-amber-800")} data-testid="channel-coverage">
                              {on}/{req.length} channels planned
                            </Link>
                          ) : null;
                        })()}
                        {channels.map((c) => {
                          const st = statusOf.get(`${r.event_id}|${c.key}`);
                          const state = (st?.state ?? "not_planned") as ChannelState;
                          return (
                            <span key={c.key} title={`${c.name}: ${STATE_LABEL[state]}${st?.at ? ` ${formatShortDate(st.at)}` : ""}${st?.reason ? ` – ${st.reason}` : ""}`} className={cn(state === "published" && "text-emerald-700", state === "planned" && "text-esn")}>
                              {c.name} {STATE_MARK[state]}
                              {state === "planned" && st?.at ? ` ${formatShortDate(st.at)}` : ""}
                            </span>
                          );
                        })}
                      </p>
                      {v.current === "esn" && e && <EsnUpload eventId={r.event_id} status={e.status} canSet={isExecutive} compact />}
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
