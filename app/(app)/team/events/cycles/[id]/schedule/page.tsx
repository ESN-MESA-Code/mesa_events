import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, formatDateTime, isoToBerlinInput, nowMs } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { hasRole } from "@/lib/roles";
import { CalendarDays, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { Panel } from "@/components/Panel";
import { AddEventForm, ScheduleRow } from "../ScheduleClient";
import { ScheduleCalendar } from "../ScheduleCalendar";
import { z } from "zod";
import { loadSorting } from "@/lib/sortingLoad";
import { shownStatus } from "@/lib/labels";
import { isBigEvent } from "@/lib/publishing";

export const metadata: Metadata = { title: "Month schedule" };

// The cycle's schedule: the month as a drag-and-drop calendar (its tray
// holds the month's open ideas) and the events as an aligned list (edit,
// remove, add). The ideas themselves have their own tab (round 2026-11-03),
// as do the overview, volunteer form, roster, descriptions and hand-in.

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const canEdit = hasRole(viewer.roles, "events");
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();

  const monthEnd = new Date(Date.UTC(Number(cycle.month.slice(0, 4)), Number(cycle.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [{ data: events }, { data: ideaRows }, { data: signups }, { categories, formats }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, type, big, starts_at, ends_at, location, meeting_point, helpers_needed, ocs_needed, price_cents, status, proposed_by, category_id, format_id, profiles:proposed_by(full_name), assignments(role, status)")
      .eq("cycle_id", id)
      .order("starts_at"),
    supabase
      .from("event_ideas")
      .select("id, title, proposed_date, pitch, helpers_needed, wants_to_oc, type_suggestion, category_id, format_id, profiles:proposer_id(full_name)")
      .eq("status", "proposed")
      .gte("proposed_date", cycle.month)
      .lte("proposed_date", monthEnd)
      .order("proposed_date"),
    supabase.rpc("cycle_signups", { cycle: id }),
    loadSorting(supabase),
  ]);
  // Ideas of one format next to each other (in the order of their first date).
  const firstOfFormat = new Map<string, string>();
  for (const i of ideaRows ?? []) if (i.format_id && !firstOfFormat.has(i.format_id)) firstOfFormat.set(i.format_id, i.proposed_date);
  const ideas = (ideaRows ?? []).slice().sort((a, b) => {
    const ka = a.format_id ? `${firstOfFormat.get(a.format_id)}|${a.format_id}` : a.proposed_date;
    const kb = b.format_id ? `${firstOfFormat.get(b.format_id)}|${b.format_id}` : b.proposed_date;
    return ka < kb ? -1 : ka > kb ? 1 : a.proposed_date < b.proposed_date ? -1 : 1;
  });

  const signupCount = new Map<string, number>();
  for (const s of signups ?? []) signupCount.set(s.event_id, (signupCount.get(s.event_id) ?? 0) + 1);
  const planned = (events ?? []).filter((e) => e.status !== "dropped");
  const editableSchedule = canEdit && ["planning", "form_open"].includes(cycle.status);
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());
  // The live status once the roster is confirmed (review 2026-11-03 #10).
  const statusOf = new Map(
    planned.map((ev) => {
      if (cycle.status !== "confirmed") return [ev.id, ev.status];
      const active = (ev.assignments ?? []).filter((a) => a.status === "active");
      const short = active.filter((a) => a.role === "oc").length < ev.ocs_needed || active.filter((a) => a.role === "helper").length < ev.helpers_needed;
      return [ev.id, shownStatus({ status: ev.status, startsAt: ev.starts_at, endsAt: ev.ends_at, short }, now)];
    })
  );

  return (
    <div className="space-y-6">
      <Panel title="Calendar" icon={CalendarDays} aside={<span className="text-sm text-gray-500">{plural(planned.length, "event")}</span>}>
          <ScheduleCalendar
            month={cycle.month}
            today={today}
            canEdit={canEdit}
            canAddIdeas={editableSchedule}
            events={planned.map((e) => ({
              id: e.id,
              title: e.title,
              type: e.type,
              start: isoToBerlinInput(e.starts_at),
              end: e.ends_at ? isoToBerlinInput(e.ends_at) : null,
              movable: Date.parse(e.starts_at) > now && !["cancelled", "completed"].includes(e.status),
              muted: e.status === "cancelled",
            }))}
            ideas={ideas.map((i) => ({ id: i.id, title: i.title, date: i.proposed_date, helpers: i.helpers_needed, type: i.type_suggestion }))}
          />
      </Panel>

          <Panel title="Events" icon={ListChecks} count={planned.length} description={editableSchedule ? "Edit or remove an event, or add one of your own." : undefined}>
            <div className="space-y-4">
              {!planned.length && <EmptyState>No events yet: accept ideas or add your own.</EmptyState>}
              <ul className="divide-y divide-gray-100" data-testid="schedule">
                {planned.map((e) => (
                  <ScheduleRow
                    key={e.id}
                    canEdit={editableSchedule}
                    canMark={canEdit}
                    event={{
                      id: e.id,
                      title: e.title,
                      type: e.type,
                      startsAt: isoToBerlinInput(e.starts_at),
                      startsIso: e.starts_at,
                      startsLabel: formatDateTime(e.starts_at),
                      endsAt: e.ends_at ? isoToBerlinInput(e.ends_at) : "",
                      location: e.location ?? "",
                      meetingPoint: e.meeting_point ?? "",
                      helpersNeeded: e.helpers_needed,
                      ocsNeeded: e.ocs_needed,
                      status: statusOf.get(e.id) ?? e.status,
                      proposer: (e.profiles as { full_name: string } | null)?.full_name ?? null,
                      signups: signupCount.get(e.id) ?? 0,
                      categoryId: e.category_id ?? "",
                      formatId: e.format_id ?? "",
                      big: isBigEvent({ big: e.big, type: e.type }),
                    }}
                    categories={categories}
                    formats={formats}
                  />
                ))}
              </ul>
              {editableSchedule && <AddEventForm cycleId={cycle.id} defaultStart={`${cycle.month}T19:00`} categories={categories} formats={formats} />}
            </div>
          </Panel>
    </div>
  );
}
