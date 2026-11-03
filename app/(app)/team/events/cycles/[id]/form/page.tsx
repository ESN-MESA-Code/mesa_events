import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { cycleLabel, formatDateTime, isoToBerlinInput, monthStartIso, nowMs } from "@/lib/dates";
import { cycleTimeline } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { plural } from "@/lib/plural";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { ClearResponseButton } from "../ScheduleClient";
import { FormControls } from "../CycleControls";
import { CopyButton } from "@/components/CopyButton";

export const metadata: Metadata = { title: "Volunteer form" };

// The cycle's volunteer form on its own page: open it with a deadline, close
// it early, the answers (cleared when someone made a mistake) and the
// sign-ups per event, in date order.
export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const canEdit = hasRole(viewer.roles, "events");
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("*").eq("id", id).maybeSingle();
  if (!cycle) notFound();

  const [{ data: events }, { data: signups }, { data: responses }, { data: limitRows }, { data: members }, days] = await Promise.all([
    supabase.from("events").select("id, title, starts_at, helpers_needed, status").eq("cycle_id", id).neq("status", "dropped").order("starts_at"),
    supabase.rpc("cycle_signups", { cycle: id }),
    supabase.rpc("cycle_responses", { cycle: id }),
    supabase.rpc("cycle_deadline_limits", { cycle: id }),
    // Everyone who has signed in to the app, for "not answered yet" (usability review #19).
    cycle.status === "form_open" ? supabase.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: [] }),
    loadTimelineDays(supabase),
  ]);
  const formLatest = limitRows?.[0]?.form_latest ?? monthStartIso(cycle.month);
  const timeline = cycleTimeline(cycle.month, days);
  const now = nowMs();
  const people = responses ?? [];
  const answered = new Set(people.map((r) => r.profile_id));
  const missing = (members ?? []).filter((m) => !answered.has(m.id));
  const perEvent = new Map<string, { oc: number; helper: number }>();
  for (const s of signups ?? []) {
    const c = perEvent.get(s.event_id) ?? { oc: 0, helper: 0 };
    if (s.oc_rank) c.oc++;
    if (s.helper_rank) c.helper++;
    perEvent.set(s.event_id, c);
  }
  const state =
    cycle.status === "planning"
      ? "Not opened yet"
      : cycle.status === "form_open"
        ? `Open · closes ${cycle.form_closes_at ? formatDateTime(cycle.form_closes_at) : "–"}`
        : `Closed${cycle.form_closes_at ? ` ${formatDateTime(cycle.form_closes_at)}` : ""}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Volunteer form</CardTitle>
          <Badge tone={cycle.status === "form_open" ? "green" : "gray"} data-testid="form-state">
            {state}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">
            Members pick the events they can do and rank OC and helper per event. {plural(people.length, "volunteer")} answered.
          </p>
          {cycle.status === "planning" && Date.parse(timeline.formOpens) > now && Date.parse(timeline.formCloses) > now && (
            <p className="text-sm text-gray-700" data-testid="form-opens-auto">
              🕘 Opens by itself on <strong>{formatDateTime(timeline.formOpens)}</strong> with the events on the schedule, closing {formatDateTime(timeline.formCloses)}. Open it earlier here if the schedule is ready.
            </p>
          )}
          {canEdit && (
            <FormControls
              cycleId={cycle.id}
              month={cycleLabel(cycle.month)}
              answers={people.length}
              status={cycle.status}
              formLatest={{ input: isoToBerlinInput(formLatest), label: formatDateTime(formLatest) }}
              standard={Date.parse(timeline.formCloses) > now ? { input: isoToBerlinInput(timeline.formCloses), label: formatDateTime(timeline.formCloses) } : null}
            />
          )}
          {!["planning", "form_open", "form_closed"].includes(cycle.status) && <p className="text-sm text-gray-500">The allocation has run – the form stays closed.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sign-ups per event</CardTitle>
          </CardHeader>
          <CardContent>
            {!events?.length ? (
              <EmptyState>No events on the schedule yet.</EmptyState>
            ) : (
              <table className="w-full text-sm" data-testid="form-signups">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="py-1 pr-3 font-medium">Date</th>
                    <th className="py-1 pr-3 font-medium">Event</th>
                    <th className="py-1 pr-3 text-right font-medium">OC</th>
                    <th className="py-1 text-right font-medium">Helpers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {events.map((e) => {
                    const c = perEvent.get(e.id) ?? { oc: 0, helper: 0 };
                    return (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-gray-600">{formatDateTime(e.starts_at)}</td>
                        <td className="py-2 pr-3 font-medium text-gray-900">{e.title}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${c.oc ? "" : "text-amber-700"}`}>{c.oc}</td>
                        <td className={`py-2 text-right tabular-nums ${c.helper >= e.helpers_needed ? "" : "text-amber-700"}`}>
                          {c.helper}/{e.helpers_needed}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Volunteer answers</CardTitle>
            <Badge>{people.length}</Badge>
          </CardHeader>
          <CardContent>
            {!people.length && <EmptyState>Nobody has answered yet.</EmptyState>}
            <ul className="divide-y divide-gray-100 text-sm" data-testid="volunteer-responses">
              {people.map((r) => (
                <li key={r.profile_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`response-${r.email}`}>
                  <span className="font-medium text-gray-900">{r.full_name}</span>
                  <span className="text-xs text-gray-500">
                    submitted {formatDateTime(r.submitted_at)} · {plural(r.events, "event")}
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
            {cycle.status === "form_open" && missing.length > 0 && (
              // Open: nudging them is the step's task; the cycle's next action links here (review 2026-11-03 #11).
              <details id="not-answered" open className="mt-3 scroll-mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm" data-testid="not-answered">
                <summary className="cursor-pointer font-medium text-amber-900">Not answered yet: {plural(missing.length, "member")}</summary>
                <p className="mt-1 text-xs text-amber-900">Everyone who has signed in to the app at least once. Nudge them in the members&apos; Chat, or copy the addresses.</p>
                <ul className="mt-2 columns-1 gap-4 text-xs text-gray-800 sm:columns-2">
                  {missing.map((m) => (
                    <li key={m.id}>{m.full_name || m.email}</li>
                  ))}
                </ul>
                <CopyButton text={missing.map((m) => m.email).join(", ")} label="Copy their email addresses" />
              </details>
            )}
            {canEdit && cycle.status === "form_open" && (
              <p className="mt-2 text-xs text-gray-500">Answers are locked after submitting. Clear someone&apos;s answers (logged) when they made a mistake; they can then submit again.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
