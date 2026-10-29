import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, formatDateTime, formatDue, nowMs } from "@/lib/dates";
import { DESCRIPTION_STATUS } from "@/components/status";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { noteCancellation } from "@/app/actions/descriptions";
import { hasRole } from "@/lib/roles";
import { cyclesWithProgress } from "@/lib/cycleFacts";

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
};

function List({ rows, empty, testId, show }: { rows: Row[]; empty: string; testId: string; show: (r: Row) => React.ReactNode }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y divide-gray-100 text-sm" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.event_id} className="flex flex-wrap items-center gap-2 py-2">
          <Link href={`/events/${r.event_id}/description?from=comms`} className="font-medium text-gray-900 hover:text-esn">
            {r.title}
          </Link>
          <span className="text-xs text-gray-500">{formatDateTime(r.starts_at)}</span>
          <span className="ml-auto">{show(r)}</span>
        </li>
      ))}
    </ul>
  );
}

// The Comms team's overview: progress per month, what to review, what is
// ready to publish, and which descriptions are due or late (late: the
// month's deadline passed or the event already started).
export default async function CommsPage() {
  const viewer = await requirePageRole(["comms"], { executiveMayRead: true, page: "Comms" });
  const supabase = await createSessionClient();
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
  const now = nowMs();
  const rows = ((data ?? []) as Row[]).filter((r) => Date.parse(r.starts_at) > now - 7 * 86_400_000).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const awaiting = rows.filter((r) => r.status === "submitted");
  const ready = rows.filter((r) => r.status === "approved");
  const late = rows.filter((r) => r.late);
  const due = rows.filter((r) => !r.late && ["missing", "draft", "changes_requested"].includes(r.status));
  const published = rows.filter((r) => r.status === "published");
  // Progress per cycle, over all its running events (also those already past).
  const all = (data ?? []) as Row[];
  // Done cycles (every event happened and is handed in) drop out (review 2026-10-29 A4).
  const recentIds = [...new Set(all.filter((r) => r.cycle_id && Date.parse(r.starts_at) > now - 7 * 86_400_000).map((r) => r.cycle_id!))];
  const { data: cycleRows } = recentIds.length
    ? await supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").in("id", recentIds)
    : { data: [] };
  const running = (await cyclesWithProgress(supabase, cycleRows ?? [])).filter((c) => !c.progress.done);
  const cycles = running.map((c) => c.month).sort();
  const progress = cycles.map((month) => {
    const list = all.filter((r) => r.cycle_month === month);
    const done = list.filter((r) => ["submitted", "approved", "published"].includes(r.status)).length;
    return { month, total: list.length, done, published: list.filter((r) => r.status === "published").length, late: list.filter((r) => r.late).length, deadline: list[0]?.deadline ?? null };
  });

  return (
    <>
      <PageHeader title="Comms" description="Review event descriptions and publish them to the events' Chat spaces." />
      {progress.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="comms-progress">
          {progress.map((p) => (
            <Card key={p.month} className="p-4 space-y-2">
              <p className="text-sm font-medium text-gray-900">{cycleLabel(p.month)}</p>
              <p className="text-xl font-semibold tabular-nums">
                {p.done} of {p.total} <span className="text-sm font-normal text-gray-500">descriptions in</span>
              </p>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                <div className="h-full bg-esn" style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%` }} />
              </div>
              <p className="text-xs text-gray-500">
                {p.published} published{p.late ? ` · ${p.late} late` : ""} · {p.deadline ? formatDue(p.deadline, now) : "no deadline set"}
              </p>
            </Card>
          ))}
        </div>
      )}
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
                {hasRole(viewer.roles, "comms") && (
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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Awaiting review</CardTitle>
            <Badge tone={awaiting.length ? "blue" : "gray"}>{awaiting.length}</Badge>
          </CardHeader>
          <CardContent>
            <List rows={awaiting} empty="Nothing to review." testId="awaiting-review" show={(r) => <span className="text-xs text-gray-500">submitted {r.submitted_at ? formatDateTime(r.submitted_at) : ""}</span>} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Approved – ready to publish</CardTitle>
            <Badge tone={ready.length ? "green" : "gray"}>{ready.length}</Badge>
          </CardHeader>
          <CardContent>
            <List rows={ready} empty="Nothing waiting to be published." testId="ready-to-publish" show={() => <Badge tone="green">Approved</Badge>} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Late</CardTitle>
            <Badge tone={late.length ? "red" : "gray"}>{late.length}</Badge>
          </CardHeader>
          <CardContent>
            <List
              rows={late}
              empty="Nothing late."
              testId="late-descriptions"
              show={(r) => (
                <span className="text-xs text-red-700">
                  {Date.parse(r.starts_at) <= now ? "event already started" : r.deadline ? formatDue(r.deadline, now) : ""}
                  {` · ${DESCRIPTION_STATUS[r.status]?.label ?? r.status}`}
                </span>
              )}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Due</CardTitle>
            <Badge>{due.length}</Badge>
          </CardHeader>
          <CardContent>
            <List
              rows={due}
              empty="All descriptions are in."
              testId="due-descriptions"
              show={(r) => (
                <span className="text-xs text-gray-500">
                  {DESCRIPTION_STATUS[r.status]?.label ?? r.status}
                  {r.deadline ? ` · ${formatDue(r.deadline, now)}` : " · no deadline set"}
                </span>
              )}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Published</CardTitle>
            <Badge>{published.length}</Badge>
          </CardHeader>
          <CardContent>
            <List rows={published} empty="Nothing published yet." testId="published-descriptions" show={(r) => <span className="text-xs text-gray-500">{r.published_at ? formatDateTime(r.published_at) : ""}</span>} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
