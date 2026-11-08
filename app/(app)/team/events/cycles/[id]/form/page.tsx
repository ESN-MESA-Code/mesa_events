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
import { CalendarDays, ClipboardList, Clock, Lock, Users } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { Panel } from "@/components/Panel";
import { cn } from "@/lib/utils";
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

  const [{ data: events }, { data: signups }, { data: responses }, { data: limitRows }, { data: members }, days, { data: blacklist }] = await Promise.all([
    supabase.from("events").select("id, title, starts_at, helpers_needed, status").eq("cycle_id", id).neq("status", "dropped").order("starts_at"),
    supabase.rpc("cycle_signups", { cycle: id }),
    supabase.rpc("cycle_responses", { cycle: id }),
    supabase.rpc("cycle_deadline_limits", { cycle: id }),
    // Everyone who has signed in to the app, for "not answered yet" (usability review #19).
    cycle.status === "form_open" ? supabase.from("profiles").select("id, full_name, email").order("full_name") : Promise.resolve({ data: [] }),
    loadTimelineDays(supabase),
    // The blacklist (2026-11-07): they may answer, the allocation leaves them out.
    supabase.from("volunteer_blacklist").select("profile_id, reason").is("removed_at", null),
  ]);
  const blacklisted = new Map((blacklist ?? []).map((b) => [b.profile_id, b.reason]));
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

  const totalOc = [...perEvent.values()].filter((c) => c.oc > 0).length;
  const helpersCovered = (events ?? []).filter((e) => (perEvent.get(e.id)?.helper ?? 0) >= e.helpers_needed).length;

  return (
    <div className="space-y-6">
      <Panel
        title="Volunteer form"
        icon={ClipboardList}
        description="Members pick the events they can do and rank OC and helper per event."
        aside={
          <Badge tone={cycle.status === "form_open" ? "green" : "gray"} data-testid="form-state">
            {state}
          </Badge>
        }
      >
        <div className="space-y-4">
          <ul className="grid gap-3 sm:grid-cols-3">
            <FormStat label="Answers" value={people.length} note={plural(people.length, "volunteer")} />
            <FormStat label="Events with an OC wish" value={totalOc} total={events?.length ?? 0} />
            <FormStat label="Events with enough helpers" value={helpersCovered} total={events?.length ?? 0} />
          </ul>
          <p className="sr-only">{plural(people.length, "volunteer")} answered.</p>
          {cycle.status === "planning" && Date.parse(timeline.formOpens) > now && Date.parse(timeline.formCloses) > now && (
            <p className="flex items-start gap-2 rounded-xl bg-esn/5 px-3 py-2.5 text-sm text-esn-dark" data-testid="form-opens-auto">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Opens by itself on <strong>{formatDateTime(timeline.formOpens)}</strong> with the events on the schedule, closing {formatDateTime(timeline.formCloses)}. Open it earlier here if the schedule is ready.
              </span>
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
          {!["planning", "form_open", "form_closed"].includes(cycle.status) && (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Lock className="h-4 w-4" aria-hidden="true" />
              The allocation has run – the form stays closed.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Sign-ups per event" icon={CalendarDays} count={events?.length ?? 0}>
          {!events?.length ? (
            <EmptyState>No events on the schedule yet.</EmptyState>
          ) : (
            <table className="w-full text-sm" data-testid="form-signups">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  <th className="pb-2 pr-3">Event</th>
                  <th className="pb-2 pr-3 text-right">OC</th>
                  <th className="pb-2 text-right">Helpers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => {
                  const c = perEvent.get(e.id) ?? { oc: 0, helper: 0 };
                  return (
                    <tr key={e.id}>
                      <td className="py-2.5 pr-3">
                        <span className="block text-xs tabular-nums text-gray-500">{formatDateTime(e.starts_at)}</span>
                        <span className="font-semibold text-gray-900">{e.title}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <span className={cn("inline-flex min-w-8 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", c.oc ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>{c.oc}</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className={cn("inline-flex min-w-12 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", c.helper >= e.helpers_needed ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>
                          {c.helper}/{e.helpers_needed}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Volunteer answers" icon={Users} count={people.length}>
            {!people.length && <EmptyState>Nobody has answered yet.</EmptyState>}
            <ul className="divide-y divide-gray-100 text-sm" data-testid="volunteer-responses">
              {people.map((r) => (
                <li key={r.profile_id} className="flex items-start gap-3 py-2.5" data-testid={`response-${r.email}`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-esn/10 text-xs font-bold text-esn" aria-hidden="true">
                    {initials(r.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">{r.full_name}</span>
                      {blacklisted.has(r.profile_id) && (
                        <Badge tone="red" title={`On the blacklist: ${blacklisted.get(r.profile_id)} – left out of the automatic allocation`}>
                          Blacklisted
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-gray-500">
                      submitted {formatDateTime(r.submitted_at)} · {plural(r.events, "event")}
                    </span>
                    {r.note && <span className="mt-0.5 block text-xs italic text-gray-600">“{r.note}”</span>}
                  </span>
                  {canEdit && cycle.status === "form_open" && <ClearResponseButton cycleId={cycle.id} profileId={r.profile_id} name={r.full_name} />}
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
        </Panel>
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** A number on top of the form: label, the value and (with a total) a thin bar. */
function FormStat({ label, value, total, note }: { label: string; value: number; total?: number; note?: string }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <li className="rounded-xl bg-gray-50 px-3 py-2.5">
      <span className="block text-xs font-medium text-gray-500">{label}</span>
      <span className="block text-lg font-bold tabular-nums text-gray-900">
        {value}
        {total !== undefined && <span className="text-sm font-normal text-gray-400"> / {total}</span>}
        {note && total === undefined && <span className="sr-only"> {note}</span>}
      </span>
      {pct !== null && (
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
          <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-esn")} style={{ width: `${pct}%` }} />
        </span>
      )}
    </li>
  );
}
