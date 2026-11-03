import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, formatShortDate, isoToBerlinInput, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { Card, CardContent, EmptyState } from "@/components/ui";
import { DeadlineControl } from "../CycleControls";
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
    <li key={r.id} className="grid gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:items-baseline" data-testid={`month-event-${r.id}`}>
      <span className="text-xs tabular-nums text-gray-500 sm:text-sm">{formatShortDate(r.startsAt)}</span>
      <span className="min-w-0">
        <Link href={`/events/${r.id}/description?from=cycle:${id}`} className="font-medium text-gray-900 hover:text-esn">
          {r.title}
        </Link>
        <span className="text-xs text-gray-500"> · {r.oc ?? "no OC"}</span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-500 sm:justify-end">{extra}</span>
    </li>
  );
  const group = (title: string, count: number, tone: string, testId: string, children: React.ReactNode) => (
    <section data-testid={testId}>
      <h3 className={cn("pt-4 text-xs font-medium", tone)}>
        {title} · {count}
      </h3>
      <ul className="divide-y divide-gray-100 text-sm">{children}</ul>
    </section>
  );
  const notNeeded = [
    ...(cancelled ?? []).map((e) => ({ id: e.id, title: e.title, why: e.cancelled_by === "description deadline" ? "cancelled at the deadline" : `cancelled${e.cancel_reason ? ` – ${e.cancel_reason}` : ""}` })),
    ...without.map((r) => ({ id: r.id, title: r.title, why: "took place without one" })),
  ];

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-gray-100 pb-3 text-sm" data-testid="description-deadline">
          {!confirmed ? (
            <span className="text-gray-600" data-testid="deadline-not-yet">
              The deadline is set once the roster is confirmed.
            </span>
          ) : passed ? (
            <>
              <span className="font-medium text-gray-900" data-testid="deadline-locked">
                🔒 Deadline {formatDateTime(cycle.description_deadline!)}
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
          {confirmed && rows.length > 0 && (
            <span className="ml-auto text-gray-500">
              {inCount} of {rows.length} in
            </span>
          )}
        </div>

        {confirmed && !rows.length && <EmptyState>No running events.</EmptyState>}
        <div data-testid="cycle-descriptions">
          {waiting.length > 0 &&
            group(
              "Waiting for the OC",
              waiting.length,
              "text-amber-800",
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
              "text-blue-800",
              "descriptions-comms",
              withComms.map((r) => row(r, r.submittedAt && <span>sent {formatShortDate(r.submittedAt)}</span>))
            )}
          {done.length > 0 && (
            <details className="pt-4" data-testid="descriptions-done">
              <summary className="cursor-pointer text-xs font-medium text-emerald-800">
                {done.some((r) => r.description === "approved") ? "Approved or published" : "Published"} · {done.length}
              </summary>
              <ul className="divide-y divide-gray-100 text-sm">{done.map((r) => row(r, r.description === "approved" && <span>going to the Chat space</span>))}</ul>
            </details>
          )}
          {notNeeded.length > 0 && (
            <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500" data-testid="descriptions-not-needed">
              Not needed:{" "}
              {notNeeded.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && " · "}
                  <Link href={`/events/${n.id}?from=cycle:${id}`} className="hover:text-esn hover:underline">
                    {n.title}
                  </Link>{" "}
                  ({n.why})
                </span>
              ))}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
