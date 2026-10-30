import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { berlinDate, formatDateTime, isoToBerlinInput, nowMs } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { AddEventForm, IdeaCard, ScheduleRow } from "./ScheduleClient";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { z } from "zod";

export const metadata: Metadata = { title: "Month schedule" };

// The cycle's schedule: the month as a drag-and-drop calendar, the events as
// an aligned list (edit, remove, add) and the month's open ideas. The
// volunteer form, roster, descriptions and hand-in have their own pages
// (the steps in the header link there).

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const canEdit = hasRole(viewer.roles, "events");
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();

  const monthEnd = new Date(Date.UTC(Number(cycle.month.slice(0, 4)), Number(cycle.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [{ data: events }, { data: ideas }, { data: signups }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, type, starts_at, ends_at, location, helpers_needed, price_cents, status, proposed_by, profiles:proposed_by(full_name)")
      .eq("cycle_id", id)
      .order("starts_at"),
    supabase
      .from("event_ideas")
      .select("id, title, proposed_date, pitch, helpers_needed, wants_to_oc, type_suggestion, profiles:proposer_id(full_name)")
      .eq("status", "proposed")
      .gte("proposed_date", cycle.month)
      .lte("proposed_date", monthEnd)
      .order("proposed_date"),
    supabase.rpc("cycle_signups", { cycle: id }),
  ]);

  const signupCount = new Map<string, number>();
  for (const s of signups ?? []) signupCount.set(s.event_id, (signupCount.get(s.event_id) ?? 0) + 1);
  const planned = (events ?? []).filter((e) => e.status !== "dropped");
  const editableSchedule = canEdit && ["planning", "form_open"].includes(cycle.status);
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <span className="text-sm text-gray-500">{plural(planned.length, "event")}</span>
        </CardHeader>
        <CardContent>
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
            ideas={(ideas ?? []).map((i) => ({ id: i.id, title: i.title, date: i.proposed_date, helpers: i.helpers_needed, type: i.type_suggestion }))}
          />
        </CardContent>
      </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <span className="text-sm text-gray-500">{plural(planned.length, "event")}</span>
            </CardHeader>
            <CardContent className="space-y-4">
              {!planned.length && <EmptyState>No events yet: accept ideas or add your own.</EmptyState>}
              <ul className="divide-y divide-gray-100" data-testid="schedule">
                {planned.map((e) => (
                  <ScheduleRow
                    key={e.id}
                    canEdit={editableSchedule}
                    event={{
                      id: e.id,
                      title: e.title,
                      type: e.type,
                      startsAt: isoToBerlinInput(e.starts_at),
                      startsLabel: formatDateTime(e.starts_at),
                      endsAt: e.ends_at ? isoToBerlinInput(e.ends_at) : "",
                      location: e.location ?? "",
                      helpersNeeded: e.helpers_needed,
                      status: e.status,
                      proposer: (e.profiles as { full_name: string } | null)?.full_name ?? null,
                      signups: signupCount.get(e.id) ?? 0,
                    }}
                  />
                ))}
              </ul>
              {editableSchedule && <AddEventForm cycleId={cycle.id} defaultStart={`${cycle.month}T19:00`} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ideas for this month</CardTitle>
              <Badge>{ideas?.length ?? 0}</Badge>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="idea-inbox">
              {!ideas?.length && <EmptyState>No open ideas for this month.</EmptyState>}
              {(ideas ?? []).map((i) => (
                <IdeaCard
                  key={i.id}
                  canEdit={editableSchedule}
                  cycleId={cycle.id}
                  events={planned.map((e) => ({ id: e.id, title: e.title }))}
                  idea={{
                    id: i.id,
                    title: i.title,
                    date: i.proposed_date,
                    pitch: i.pitch,
                    helpers: i.helpers_needed,
                    wantsToOc: i.wants_to_oc,
                    typeSuggestion: i.type_suggestion,
                    proposer: (i.profiles as { full_name: string } | null)?.full_name ?? "",
                  }}
                />
              ))}
              <p className="text-xs text-gray-500 md:col-span-2 xl:col-span-3">Ideas dated in other months appear in those months&apos; cycles. Drag an idea from the calendar tray onto a day to add it quickly.</p>
            </CardContent>
          </Card>
        </div>
    </div>
  );
}
