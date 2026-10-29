import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, cyclePlannedIn, formatDateTime, formatShortDate, isoToBerlinInput, monthStartIso } from "@/lib/dates";
import { plural } from "@/lib/plural";
import { CYCLE_STATUS_LABELS } from "@/lib/labels";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { AddEventForm, ClearResponseButton, CycleControls, IdeaCard, ScheduleRow } from "./ScheduleClient";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { Stepper } from "@/components/status";
import { z } from "zod";

export const metadata: Metadata = { title: "Month schedule" };

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const canEdit = hasRole(viewer.roles, "events");
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();

  const monthEnd = new Date(Date.UTC(Number(cycle.month.slice(0, 4)), Number(cycle.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [{ data: events }, { data: ideas }, { data: signups }, { data: responses }] = await Promise.all([
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
    supabase.rpc("cycle_responses", { cycle: id }),
  ]);

  const signupCount = new Map<string, number>();
  for (const s of signups ?? []) signupCount.set(s.event_id, (signupCount.get(s.event_id) ?? 0) + 1);
  const people = (responses ?? []).length;
  const [[{ progress, handInOpen }], { data: limitRows }] = await Promise.all([
    cyclesWithProgress(supabase, [cycle]),
    supabase.rpc("cycle_deadline_limits", { cycle: cycle.id }),
  ]);
  const limits = limitRows?.[0] ?? { form_latest: monthStartIso(cycle.month), description_latest: null };
  const planned = (events ?? []).filter((e) => e.status !== "dropped");
  const editableSchedule = canEdit && ["planning", "form_open"].includes(cycle.status);

  return (
    <>
      <PageHeader title={cycleLabel(cycle.month)} description={`Month schedule (${cyclePlannedIn(cycle.month)}): ideas, events and their types, the volunteer form and the roster.`}>
        <Badge tone={cycle.status === "confirmed" ? "green" : "blue"} className="self-center text-sm">
          {CYCLE_STATUS_LABELS[cycle.status]}
        </Badge>
      </PageHeader>
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-5 space-y-4">
            <Stepper steps={progress.steps} label="Steps of this cycle" testId="cycle-stepper" />
            <p className="rounded-md border border-esn/30 bg-esn/5 px-3 py-2 text-sm" data-testid="cycle-next">
              <span className="font-semibold text-esn-dark">{progress.current ? "Next: " : "✓ "}</span>
              {progress.action}
              <span className="text-gray-500"> · {progress.summary}</span>
            </p>
            {progress.current === "handin" && handInOpen.length > 0 && (
              <ul className="text-sm space-y-1" data-testid="hand-in-open">
                {handInOpen.map((h) => {
                  const e = (events ?? []).find((x) => x.id === h.event_id);
                  const missing = [!h.signed_off && "attendance list", h.photos === 0 && "photos", h.belege_missing > 0 && plural(h.belege_missing, "Beleg", "Belege")].filter(Boolean);
                  return (
                    <li key={h.event_id} className="flex flex-wrap gap-x-2">
                      <Link href={`/events/${h.event_id}/hand-in?from=cycle:${cycle.id}`} className="font-medium text-esn hover:underline">
                        {e?.title ?? "Event"}
                      </Link>
                      <span className="text-gray-500">
                        {formatShortDate(h.starts_at)} · missing: {missing.join(", ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <CycleControls
              cycle={{
                id: cycle.id,
                status: cycle.status,
                formClosesAt: cycle.form_closes_at ? formatDateTime(cycle.form_closes_at) : null,
                descriptionDeadline: cycle.description_deadline ? isoToBerlinInput(cycle.description_deadline) : "",
                formLatest: { input: isoToBerlinInput(limits.form_latest), label: formatDateTime(limits.form_latest) },
                descriptionLatest: limits.description_latest ? { input: isoToBerlinInput(limits.description_latest), label: formatDateTime(limits.description_latest) } : null,
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

        {cycle.status !== "planning" && (
          <Card>
            <CardHeader>
              <CardTitle>Volunteer answers</CardTitle>
              <Badge>{people}</Badge>
            </CardHeader>
            <CardContent>
              {!people && <EmptyState>Nobody has answered yet.</EmptyState>}
              <ul className="divide-y divide-gray-100 text-sm" data-testid="volunteer-responses">
                {(responses ?? []).map((r) => (
                  <li key={r.profile_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`response-${r.email}`}>
                    <span className="font-medium text-gray-900">{r.full_name}</span>
                    <span className="text-xs text-gray-500">
                      submitted {formatDateTime(r.submitted_at)} · {r.events} event{r.events === 1 ? "" : "s"}
                      {r.note && ` · “${r.note}”`}
                    </span>
                    {canEdit && cycle.status === "form_open" && (
                      <span className="ml-auto">
                        <ClearResponseButton cycleId={cycle.id} profileId={r.profile_id} name={r.full_name} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && cycle.status === "form_open" && (
                <p className="mt-2 text-xs text-gray-500">Answers are locked after submitting. Clear someone&apos;s answers (logged) when they made a mistake; they can then submit again.</p>
              )}
            </CardContent>
          </Card>
        )}

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
