import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatShortDate, nowMs } from "@/lib/dates";
import { loadMonthEvents } from "@/lib/monthEvents";
import { describeHandinReminders } from "@/lib/reminders";
import { loadReminderDays } from "@/lib/remindersLoad";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { HandInHeader, HandInRow, MonthEventGroup } from "../MonthEvents";

export const metadata: Metadata = { title: "Hand-in" };

// The cycle's hand-in (round 2026-11-03): per event that took place a
// checklist of what the OC hands in – attendance list, photos, event report
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
    <Card>
      <CardHeader>
        <CardTitle>Hand-in</CardTitle>
        <Badge tone={open.length ? "amber" : "green"} data-testid="hand-in-count">
          {done.length} of {happened} handed in
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-gray-600" data-testid="hand-in-reminders">
          {describeHandinReminders(reminders)}
        </p>
        {!happened && <EmptyState>No event has taken place yet – the hand-in opens on each event&apos;s day.</EmptyState>}
        {open.length > 0 && (
          <MonthEventGroup title="Missing something" count={open.length} tone="amber" testId="hand-in-open">
            <HandInHeader />
            {open.map((r) => (
              <HandInRow key={r.id} e={r} cycleId={id} />
            ))}
          </MonthEventGroup>
        )}
        {done.length > 0 && (
          <MonthEventGroup title="Handed in" count={done.length} tone="green" testId="hand-in-done">
            <HandInHeader />
            {done.map((r) => (
              <HandInRow key={r.id} e={r} cycleId={id} />
            ))}
          </MonthEventGroup>
        )}
        {ahead.length > 0 && (
          <section data-testid="hand-in-ahead">
            <h3 className="border-b border-gray-100 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Still ahead</h3>
            <p className="pt-2 text-xs text-gray-600">{ahead.map((r) => `${r.title} (${formatShortDate(r.startsAt)})`).join(" · ")}</p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
