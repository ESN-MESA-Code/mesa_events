import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BellRing, PackageCheck } from "lucide-react";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatShortDate, nowMs } from "@/lib/dates";
import { loadMonthEvents } from "@/lib/monthEvents";
import { describeHandinReminders } from "@/lib/reminders";
import { loadReminderDays } from "@/lib/remindersLoad";
import { Panel, PanelGroup } from "@/components/Panel";
import { HandInRow, MonthEventGroup } from "../MonthEvents";

export const metadata: Metadata = { title: "Hand-in" };

// The cycle's hand-in (round 2026-11-03; redesign 2026-11-08): per event that
// took place what the OC hands in – attendance list, photos, event report
// (receipts are Finance's) – the open ones first; the OCs are reminded
// automatically, as the admin set it.
export default async function HandInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("id, status, description_deadline").eq("id", id).maybeSingle();
  if (!cycle) notFound();
  const [events, reminders] = await Promise.all([loadMonthEvents(supabase, cycle, nowMs()), loadReminderDays(supabase)]);
  const rows = events.filter((e) => e.running && e.status !== "draft");
  const open = rows.filter((r) => r.handInOpen);
  const done = rows.filter((r) => r.started && !r.handInOpen);
  const ahead = rows.filter((r) => !r.started);
  const happened = open.length + done.length;

  return (
    <Panel
      title="Hand-in"
      icon={PackageCheck}
      aside={
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${open.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`} data-testid="hand-in-count">
          {done.length} of {happened} handed in
        </span>
      }
    >
      <div className="space-y-6">
        {happened > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((done.length / happened) * 100)}%` }} />
          </div>
        )}
        <p className="flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600" data-testid="hand-in-reminders">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          {describeHandinReminders(reminders)}
        </p>
        {!happened && <p className="py-6 text-center text-sm text-gray-500">No event has taken place yet – the hand-in opens on each event&apos;s day.</p>}
        {open.length > 0 && (
          <MonthEventGroup title="Missing something" count={open.length} tone="amber" testId="hand-in-open">
            {open.map((r) => (
              <HandInRow key={r.id} e={r} cycleId={id} />
            ))}
          </MonthEventGroup>
        )}
        {done.length > 0 && (
          <MonthEventGroup title="Handed in" count={done.length} tone="green" testId="hand-in-done">
            {done.map((r) => (
              <HandInRow key={r.id} e={r} cycleId={id} />
            ))}
          </MonthEventGroup>
        )}
        {ahead.length > 0 && (
          <PanelGroup title="Still ahead" count={ahead.length} testId="hand-in-ahead">
            <ul className="flex flex-wrap gap-1.5 pt-1">
              {ahead.map((r) => (
                <li key={r.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                  {r.title} <span className="text-gray-500">· {formatShortDate(r.startsAt)}</span>
                </li>
              ))}
            </ul>
          </PanelGroup>
        )}
      </div>
    </Panel>
  );
}
