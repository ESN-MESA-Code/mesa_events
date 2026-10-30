import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, formatDue, isoToBerlinInput, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { DESCRIPTION_STATUS } from "@/components/status";
import { DeadlineControl } from "../CycleControls";

export const metadata: Metadata = { title: "Descriptions" };

type Row = { event_id: string; title: string; starts_at: string; status: string; submitted_at: string | null; cycle_id: string | null; late: boolean };

// The cycle's descriptions: the one deadline for all events (set after the
// roster is confirmed, locked once passed) and where each event stands.
export default async function DescriptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();
  const now = nowMs();

  const [{ data: overview }, { data: limitRows }, { data: cancelled }] = await Promise.all([
    supabase.rpc("description_overview"),
    supabase.rpc("cycle_deadline_limits", { cycle: id }),
    supabase.from("events").select("id, title, starts_at, cancelled_by, cancel_reason").eq("cycle_id", id).eq("status", "cancelled").order("starts_at"),
  ]);
  const rows = ((overview ?? []) as Row[]).filter((r) => r.cycle_id === id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const latest = limitRows?.[0]?.description_latest ?? null;
  const passed = !!cycle.description_deadline && Date.parse(cycle.description_deadline) <= now;
  const inCount = rows.filter((r) => ["submitted", "approved", "published"].includes(r.status)).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Description deadline</CardTitle>
          {cycle.description_deadline && <Badge tone={passed ? "gray" : "blue"}>{passed ? "passed" : formatDue(cycle.description_deadline, now)}</Badge>}
        </CardHeader>
        <CardContent>
          <DeadlineControl
            cycleId={cycle.id}
            status={cycle.status}
            deadline={cycle.description_deadline ? isoToBerlinInput(cycle.description_deadline) : ""}
            deadlineLabel={cycle.description_deadline ? formatDateTime(cycle.description_deadline) : null}
            passed={passed}
            latest={latest ? { input: isoToBerlinInput(latest), label: formatDateTime(latest) } : null}
            canEdit={hasRole(viewer.roles, "events")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Descriptions</CardTitle>
          <span className="text-sm text-gray-500">
            {inCount} of {rows.length} in
          </span>
        </CardHeader>
        <CardContent>
          {!rows.length ? (
            <EmptyState>{cycle.status === "confirmed" ? "No running events." : "Descriptions are written once the roster is confirmed."}</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm" data-testid="cycle-descriptions">
              {rows.map((r) => {
                const s = DESCRIPTION_STATUS[r.status] ?? { label: r.status, tone: "gray" as const };
                return (
                  <li key={r.event_id} className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2">
                    <span className="tabular-nums text-gray-600">{formatDateTime(r.starts_at)}</span>
                    <Link href={`/events/${r.event_id}/description?from=cycle:${id}`} className="truncate font-medium text-gray-900 hover:text-esn">
                      {r.title}
                    </Link>
                    <span className="flex items-center gap-1 justify-self-end">
                      {r.late && <Badge tone="red">late</Badge>}
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {(cancelled ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-gray-100 text-sm" data-testid="cycle-cancelled">
              {(cancelled ?? []).map((e) => (
                <li key={e.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3 py-2">
                  <span className="tabular-nums text-gray-600">{formatDateTime(e.starts_at)}</span>
                  <span>
                    <Link href={`/events/${e.id}?from=cycle:${id}`} className="font-medium text-gray-900 hover:text-esn">
                      {e.title}
                    </Link>
                    <span className="text-xs text-gray-500"> · {e.cancel_reason ?? "cancelled"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
