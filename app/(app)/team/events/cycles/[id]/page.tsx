import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, isoToBerlinInput, monthLabel } from "@/lib/dates";
import { CYCLE_STATUS_LABELS } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { AddEventForm, CycleControls, IdeaCard, ScheduleRow } from "./ScheduleClient";
import { z } from "zod";

export const metadata: Metadata = { title: "Month schedule" };

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true });
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
      .select("id, title, proposed_date, pitch, helpers_needed, wants_to_oc, profiles:proposer_id(full_name)")
      .eq("status", "proposed")
      .gte("proposed_date", cycle.month)
      .lte("proposed_date", monthEnd)
      .order("proposed_date"),
    supabase.rpc("cycle_signups", { cycle: id }),
  ]);

  const signupCount = new Map<string, number>();
  for (const s of signups ?? []) signupCount.set(s.event_id, (signupCount.get(s.event_id) ?? 0) + 1);
  const people = new Set((signups ?? []).map((s) => s.profile_id)).size;
  const planned = (events ?? []).filter((e) => e.status !== "dropped");
  const editableSchedule = canEdit && ["planning", "form_open"].includes(cycle.status);

  return (
    <>
      <PageHeader title={`${monthLabel(cycle.month)}`} description="Month schedule: ideas, events and their types, the volunteer form and the roster.">
        <Badge tone={cycle.status === "confirmed" ? "green" : "blue"} className="self-center text-sm">
          {CYCLE_STATUS_LABELS[cycle.status]}
        </Badge>
      </PageHeader>
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-5">
            <CycleControls
              cycle={{
                id: cycle.id,
                status: cycle.status,
                formClosesAt: cycle.form_closes_at ? formatDateTime(cycle.form_closes_at) : null,
                descriptionDeadline: cycle.description_deadline ? isoToBerlinInput(cycle.description_deadline) : "",
                defaultCloses: `${cycle.month.slice(0, 8)}01T23:59`,
              }}
              canEdit={canEdit}
              responses={people}
            />
            {["allocated", "confirmed"].includes(cycle.status) && (
              <p className="mt-3 text-sm">
                <Link href={`/team/events/cycles/${cycle.id}/roster`} className="text-esn font-medium hover:underline">
                  {cycle.status === "allocated" ? "Adjust the roster →" : "View the roster →"}
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <span className="text-sm text-gray-500">{planned.length} events</span>
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
            <CardContent className="space-y-3" data-testid="idea-inbox">
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
                    proposer: (i.profiles as { full_name: string } | null)?.full_name ?? "",
                  }}
                />
              ))}
              <p className="text-xs text-gray-500">Ideas dated in other months appear in those months&apos; cycles.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
