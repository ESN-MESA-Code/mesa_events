import type { Metadata } from "next";
import Link from "next/link";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, nowMs } from "@/lib/dates";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Comms" };

type Row = { event_id: string; title: string; starts_at: string; deadline: string | null; status: string; submitted_at: string | null; published_at: string | null; late: boolean };

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

// The Comms team's overview: what to review, what is ready to publish, and
// which descriptions are due or late (one deadline per month).
export default async function CommsPage() {
  await requirePageRole(["comms"], { executiveMayRead: true, page: "Comms" });
  const supabase = await createSessionClient();
  const { data } = await supabase.rpc("description_overview");
  const now = nowMs();
  const rows = ((data ?? []) as Row[]).filter((r) => Date.parse(r.starts_at) > now - 7 * 86_400_000).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const awaiting = rows.filter((r) => r.status === "submitted");
  const ready = rows.filter((r) => r.status === "approved");
  const late = rows.filter((r) => r.late);
  const due = rows.filter((r) => !r.late && ["missing", "draft", "changes_requested"].includes(r.status));
  const published = rows.filter((r) => r.status === "published");

  return (
    <>
      <PageHeader title="Comms" description="Review event descriptions and publish them to the events' Chat spaces." />
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
            <List rows={late} empty="Nothing late." testId="late-descriptions" show={(r) => <span className="text-xs text-red-700">was due {r.deadline ? formatDateTime(r.deadline) : ""}</span>} />
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
                  {r.status === "missing" ? "not started" : r.status === "changes_requested" ? "changes requested" : "draft"}
                  {r.deadline ? ` · due ${formatDateTime(r.deadline)}` : " · no deadline set"}
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
