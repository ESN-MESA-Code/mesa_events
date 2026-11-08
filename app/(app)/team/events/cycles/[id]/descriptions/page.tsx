import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, formatShortDate, isoToBerlinInput, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { ChevronRight, Clock, FileText, Lock } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { Panel, PanelGroup } from "@/components/Panel";
import { DeadlineControl } from "../CycleControls";
import { DescriptionState, EventLine } from "../MonthEvents";
import { loadMonthEvents, type MonthEvent } from "@/lib/monthEvents";
import { cycleTimeline } from "@/lib/timeline";
import { loadReminderDays } from "@/lib/remindersLoad";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Descriptions" };

const IN = ["submitted", "approved", "published"];
const STATE: Record<string, string> = { draft: "Draft", changes_requested: "Changes requested" };

// The cycle's descriptions in one card (round 2026-11-03): the deadline and
// the reminders in one line, then the events by who has the description now
// – each group shows only what is new in it: waiting for the OC (the state
// when it is not just "not started", the due date, the last reminder),
// with Comms (when it was sent), published (folded into one line). The
// events that do not need one any more – cancelled, also automatically at
// the deadline – close it in a muted line.
export default async function DescriptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();
  const now = nowMs();

  const [events, { data: limitRows }, { data: cancelled }, days, reminders, { data: fixSetting }] = await Promise.all([
    loadMonthEvents(supabase, cycle, now),
    supabase.rpc("cycle_deadline_limits", { cycle: id }),
    supabase.from("events").select("id, title, cancelled_by, cancel_reason").eq("cycle_id", id).eq("status", "cancelled").order("starts_at"),
    loadTimelineDays(supabase),
    loadReminderDays(supabase),
    supabase.from("app_settings").select("value").eq("key", "description_fix_days").maybeSingle(),
  ]);
  const fixDays = typeof fixSetting?.value === "number" ? fixSetting.value : 4;
  const confirmed = cycle.status === "confirmed";
  const rows = confirmed ? events.filter((e) => e.running && e.status !== "draft") : [];
  const waiting = rows.filter((r) => r.descOpen);
  const { data: dueRows } = waiting.length ? await supabase.rpc("description_due", { events: waiting.map((r) => r.id) }) : { data: [] };
  const dueOf = new Map((dueRows ?? []).map((d) => [d.event_id, d.due_at]));
  const withComms = rows.filter((r) => r.description === "submitted");
  const done = rows.filter((r) => ["approved", "published"].includes(r.description));
  // Should not happen any more (cancelled at the deadline); older months may have them.
  const without = rows.filter((r) => r.started && !IN.includes(r.description));
  const canEdit = hasRole(viewer.roles, "events");
  const latest = limitRows?.[0]?.description_latest ?? null;
  // The timeline's day (round 2026-11-02), offered while it is ahead and allowed.
  const standardDue = cycleTimeline(cycle.month, days).descriptionsDue;
  const standard = Date.parse(standardDue) > now && (!latest || Date.parse(standardDue) <= Date.parse(latest)) ? { input: isoToBerlinInput(standardDue), label: formatDateTime(standardDue) } : null;
  const passed = !!cycle.description_deadline && Date.parse(cycle.description_deadline) <= now;
  const autoCancelled = (cancelled ?? []).filter((e) => e.cancelled_by === "description deadline").length;
  const inCount = rows.filter((r) => IN.includes(r.description)).length;
  const every = reminders.descriptionEveryDays === 1 ? "daily" : `every ${reminders.descriptionEveryDays} days`;
  const reminderLine = reminders.descriptionDaysBefore ? `reminders ${every} from ${reminders.descriptionDaysBefore} days before` : "no automatic reminders";

  const row = (r: MonthEvent, extra: React.ReactNode) => (
    <EventLine
      key={r.id}
      e={r}
      href={`/events/${r.id}/description?from=cycle:${id}`}
      muted={r.started}
      meta={<DescriptionState e={r} />}
      aside={extra ? <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 sm:justify-end">{extra}</span> : undefined}
    />
  );
  const group = (title: string, count: number, tone: "amber" | "blue" | "green", testId: string, children: React.ReactNode) => (
    <PanelGroup title={title} count={count} tone={tone === "blue" ? "gray" : tone} testId={testId}>
      <ul className="divide-y divide-gray-100 text-sm">{children}</ul>
    </PanelGroup>
  );
  const notNeeded = [
    ...(cancelled ?? []).map((e) => ({ id: e.id, title: e.title, why: e.cancelled_by === "description deadline" ? "cancelled at the deadline" : `cancelled${e.cancel_reason ? ` – ${e.cancel_reason}` : ""}` })),
    ...without.map((r) => ({ id: r.id, title: r.title, why: "took place without one" })),
  ];

  return (
    <Panel
      title="Descriptions"
      icon={FileText}
      aside={
        confirmed && rows.length > 0 ? (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", inCount === rows.length ? "bg-emerald-50 text-emerald-800" : "bg-esn/10 text-esn")}>
            {inCount} of {rows.length} in
          </span>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {confirmed && rows.length > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((inCount / rows.length) * 100)}%` }} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm" data-testid="description-deadline">
          {!confirmed ? (
            <span className="flex items-center gap-2 text-gray-600" data-testid="deadline-not-yet">
              <Clock className="h-4 w-4 text-gray-400" aria-hidden="true" />
              The deadline is set once the roster is confirmed.
            </span>
          ) : passed ? (
            <>
              <span className="flex items-center gap-2 font-semibold text-gray-900" data-testid="deadline-locked">
                <Lock className="h-4 w-4 text-gray-500" aria-hidden="true" />
                Deadline {formatDateTime(cycle.description_deadline!)}
              </span>
              <span className="text-gray-500">
                passed · {autoCancelled ? `${autoCancelled} cancelled` : "nothing cancelled"} · {reminderLine}
              </span>
            </>
          ) : (
            <div className="w-full space-y-1">
              <DeadlineControl
                cycleId={cycle.id}
                status={cycle.status}
                deadline={cycle.description_deadline ? isoToBerlinInput(cycle.description_deadline) : ""}
                deadlineLabel={cycle.description_deadline ? formatDateTime(cycle.description_deadline) : null}
                latest={latest ? { input: isoToBerlinInput(latest), label: formatDateTime(latest) } : null}
                standard={standard}
                canEdit={canEdit}
              />
              <p className="text-xs text-gray-500" data-testid="description-reminders">
                {reminderLine} · not sent by then, or not sent again within {fixDays} days after Comms asked for changes: the event is cancelled
              </p>
            </div>
          )}
        </div>

        {confirmed && !rows.length && <EmptyState>No running events.</EmptyState>}
        <div className="space-y-6" data-testid="cycle-descriptions">
          {waiting.length > 0 &&
            group(
              "Waiting for the OC",
              waiting.length,
              "amber",
              "descriptions-oc",
              waiting.map((r) => {
                const due = dueOf.get(r.id);
                const late = r.descriptionLate || (!!due && Date.parse(due) <= now);
                return row(
                  r,
                  <>
                    {(STATE[r.description] || late) && (
                      <span className={cn("rounded px-1.5 py-0.5", late || r.description === "changes_requested" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700")}>
                        {[STATE[r.description], late && "late"].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {due && <span data-testid="due">due {formatShortDate(due)}</span>}
                    {r.reminded.description && <span>reminded {formatShortDate(r.reminded.description)}</span>}
                  </>
                );
              })
            )}
          {withComms.length > 0 &&
            group(
              "With Comms",
              withComms.length,
              "blue",
              "descriptions-comms",
              withComms.map((r) => row(r, r.submittedAt && <span>sent {formatShortDate(r.submittedAt)}</span>))
            )}
          {done.length > 0 && (
            <details className="group" data-testid="descriptions-done">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
                {done.some((r) => r.description === "approved") ? "Approved or published" : "Published"}
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-100 px-1.5 text-[11px] font-bold tracking-normal text-emerald-800">{done.length}</span>
              </summary>
              <ul className="divide-y divide-gray-100 text-sm">{done.map((r) => row(r, r.description === "approved" && <span>going to the Chat space</span>))}</ul>
            </details>
          )}
          {notNeeded.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-4 text-xs text-gray-500" data-testid="descriptions-not-needed">
              <span className="mr-1 font-medium">Not needed:</span>
              {notNeeded.map((n) => (
                <Link key={n.id} href={`/events/${n.id}?from=cycle:${id}`} className="rounded-full bg-gray-100 px-2.5 py-1 hover:text-esn" title={n.why}>
                  {n.title} <span className="text-gray-400">({n.why})</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
