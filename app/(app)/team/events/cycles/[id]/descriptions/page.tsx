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
import { RemindButton } from "@/components/RemindButton";
import { cn } from "@/lib/utils";
import { cycleTimeline } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";

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

  const [{ data: overview }, { data: limitRows }, { data: cancelled }, { data: ocs }, days] = await Promise.all([
    supabase.rpc("description_overview"),
    supabase.rpc("cycle_deadline_limits", { cycle: id }),
    supabase.from("events").select("id, title, starts_at, cancelled_by, cancel_reason").eq("cycle_id", id).eq("status", "cancelled").order("starts_at"),
    // Each event's OC, named in the list (usability review #21).
    supabase.from("assignments").select("event_id, profiles(full_name), events!inner(cycle_id)").eq("events.cycle_id", id).eq("role", "oc").eq("status", "active"),
    loadTimelineDays(supabase),
  ]);
  const ocOf = new Map((ocs ?? []).map((a) => [a.event_id, (a.profiles as { full_name: string } | null)?.full_name ?? null]));
  const canEdit = hasRole(viewer.roles, "events");
  const rows = ((overview ?? []) as Row[]).filter((r) => r.cycle_id === id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const latest = limitRows?.[0]?.description_latest ?? null;
  // The timeline's day (round 2026-11-02), offered while it is ahead and allowed.
  const standardDue = cycleTimeline(cycle.month, days).descriptionsDue;
  const standard = Date.parse(standardDue) > now && (!latest || Date.parse(standardDue) <= Date.parse(latest)) ? { input: isoToBerlinInput(standardDue), label: formatDateTime(standardDue) } : null;
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
            standard={standard}
            canEdit={canEdit}
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
                // Not in yet (usability review #21): amber, red once late; with the OC and a Remind.
                const open = ["missing", "draft", "changes_requested"].includes(r.status) && Date.parse(r.starts_at) > now;
                const oc = ocOf.get(r.event_id) ?? null;
                return (
                  <li
                    key={r.event_id}
                    className={cn("grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2", open && "-mx-2 border-l-4 px-2", open && (r.late || passed ? "border-red-400" : "border-amber-400"))}
                    data-problem={open || undefined}
                  >
                    <span className="tabular-nums text-gray-600">{formatDateTime(r.starts_at)}</span>
                    <span className="min-w-0">
                      <Link href={`/events/${r.event_id}/description?from=cycle:${id}`} className="block truncate font-medium text-gray-900 hover:text-esn">
                        {r.title}
                      </Link>
                      <span className="text-xs text-gray-500">{oc ? `OC ${oc}` : "no OC"}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1 justify-self-end">
                      {r.late && <Badge tone="red">late</Badge>}
                      <Badge tone={open ? (r.late || passed ? "red" : "amber") : s.tone}>{s.label}</Badge>
                      {canEdit && open && oc && <RemindButton eventId={r.event_id} about="description" title={r.title} />}
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
