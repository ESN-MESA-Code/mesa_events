import type { Metadata } from "next";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { berlinTime, cycleLabel, dueUrgency, formatDateTime, monthLabel, nowMs } from "@/lib/dates";
import { relativeDue } from "@/lib/timeline";
import { venue } from "@/lib/calendarView";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { RANK_LABELS } from "@/lib/volunteer";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { DateTile } from "@/components/DateTile";
import { EmptyState, PageHeader } from "@/components/ui";
import { VolunteerForm } from "./VolunteerForm";

export const metadata: Metadata = { title: "Volunteer" };

/** The deadline's colours: red within 24 hours, amber within 48, else ESN blue (as on Home). */
const DUE_TONE = { urgent: "bg-red-50 text-red-700", soon: "bg-amber-50 text-amber-800", later: "bg-esn/5 text-esn" } as const;

// The month's volunteer form: every event of an open cycle; volunteers pick
// what they can do and rank OC and helper preferences per event. One
// submission per person: afterwards the answers are shown read-only.
// Redesign 2026-11-07: three steps (events, limits, note) beside a live
// summary with the submit button; the submitted answers as a receipt.
export default async function VolunteerPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const { data: cycles } = await supabase.from("planning_cycles").select("id, month, form_closes_at").eq("status", "form_open").order("month");
  const now = nowMs();

  const forms = await Promise.all(
    (cycles ?? []).map(async (c) => {
      const [{ data: events }, { data: response }, { data: ideas }, { data: partnered }, { data: fixed }] = await Promise.all([
        supabase
          .from("events")
          .select("id, title, type, starts_at, location, helpers_needed, ocs_needed")
          .eq("cycle_id", c.id)
          .eq("status", "scheduled")
          .order("starts_at"),
        supabase
          .from("volunteer_responses")
          .select("note, submitted_at, max_events, max_oc, volunteer_choices(event_id, oc_rank, helper_rank)")
          .eq("cycle_id", c.id)
          .eq("profile_id", viewer.id)
          .maybeSingle(),
        // The viewer's own ideas on the form (also those they do not OC), and those they joined as partner.
        supabase.from("event_ideas").select("event_id").eq("proposer_id", viewer.id).not("event_id", "is", null),
        supabase.from("idea_partners").select("event_ideas(event_id)").eq("profile_id", viewer.id).neq("status", "declined"),
        // Who is on each event already: the proposer who OCs it and the partners who accepted.
        supabase.rpc("event_fixed_people", { cycle: c.id }),
      ]);
      const mine = new Set([
        ...(ideas ?? []).map((i) => i.event_id),
        ...(partnered ?? []).map((p) => (p.event_ideas as { event_id: string | null } | null)?.event_id),
      ]);
      return { cycle: c, events: events ?? [], response, mine, fixed: fixed ?? [] };
    })
  );

  return (
    <>
      <PageHeader
        title="Volunteer"
        description="Say which of the month's events you'd like to help with – as OC (the organiser) or as helper. You submit once; after the deadline the roster is made fairly from everyone's answers."
      />
      {!forms.length && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6">
          <EmptyState>No volunteer form is open right now. The Events team opens the next one when the month&apos;s schedule is ready – it will show up on your Home page.</EmptyState>
        </div>
      )}
      <div className="space-y-12">
        {forms.map(({ cycle, events, response, mine, fixed }) => {
          const label = cycleLabel(cycle.month);
          const chosen = new Map((response?.volunteer_choices ?? []).map((c) => [c.event_id, c]));
          const closes = cycle.form_closes_at;
          const urgency = closes ? dueUrgency(closes, now) : "later";
          const fromIdeas = events.flatMap((e) => fixed.filter((f) => f.event_id === e.id && f.profile_id === viewer.id).map((f) => `${e.title} (${f.role === "oc" ? "OC" : "helper"})`));
          return (
            <section key={cycle.id} aria-label={`Volunteer form ${label}`} className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="text-xl font-bold text-gray-900">{monthLabel(cycle.month)}</h2>
                <span className="text-sm text-gray-600">{plural(events.length, "event")}</span>
                {closes && (
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold sm:ml-auto", response ? "bg-gray-100 text-gray-600" : DUE_TONE[urgency])}>
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {response ? "Roster after" : "Open until"} {formatDateTime(closes)}
                    {!response && relativeDue(closes, now) && ` · ${relativeDue(closes, now)}`}
                  </span>
                )}
              </div>
              {response ? (
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="volunteer-summary">
                  <div className="flex items-start gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-4 sm:px-5">
                    <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />
                    <div className="text-sm">
                      <p className="font-semibold text-emerald-900">Submitted ✓ on {formatDateTime(response.submitted_at)}</p>
                      <p className="text-emerald-800">Your answers are locked – ask the Events team if something changes. You&apos;ll see your events on Home once the roster is out.</p>
                    </div>
                  </div>
                  <div className="space-y-4 px-4 py-4 sm:px-5">
                    {chosen.size ? (
                      <ul className="divide-y divide-gray-100">
                        {events
                          .filter((e) => chosen.has(e.id))
                          .map((e) => {
                            const c = chosen.get(e.id)!;
                            return (
                              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                                <DateTile iso={e.starts_at} />
                                <div className="min-w-40 flex-1">
                                  <p className="text-xs text-gray-600">{berlinTime(e.starts_at)}</p>
                                  <p className="font-semibold text-gray-900 break-words">{e.title}</p>
                                </div>
                                <span className="flex flex-wrap gap-1.5">
                                  {c.oc_rank && <RankChip role="OC" rank={c.oc_rank} />}
                                  {c.helper_rank && <RankChip role="Helper" rank={c.helper_rank} />}
                                </span>
                              </li>
                            );
                          })}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-600">You did not pick any event this month.</p>
                    )}
                    {(fromIdeas.length > 0 || chosen.size > 0 || response.note) && (
                      <dl className="grid gap-x-6 gap-y-2 rounded-xl bg-gray-50 px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
                        {fromIdeas.length > 0 && (
                          <>
                            <dt className="font-medium text-gray-700">From your ideas</dt>
                            <dd className="text-gray-600">You are on {fromIdeas.join(", ")}.</dd>
                          </>
                        )}
                        {chosen.size > 0 && (
                          <>
                            <dt className="font-medium text-gray-700">Your limits</dt>
                            <dd className="text-gray-600">
                              {response.max_events ? `At most ${plural(response.max_events, "event")}` : "No limit on events"}
                              {response.max_oc ? `, OC of at most ${plural(response.max_oc, "event")}.` : "."}
                            </dd>
                          </>
                        )}
                        {response.note && (
                          <>
                            <dt className="font-medium text-gray-700">Your note</dt>
                            <dd className="whitespace-pre-line text-gray-600">{response.note}</dd>
                          </>
                        )}
                      </dl>
                    )}
                  </div>
                </div>
              ) : (
                <VolunteerForm
                  cycleId={cycle.id}
                  month={monthLabel(cycle.month)}
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    type: e.type === "standard" ? null : EVENT_TYPE_LABELS[e.type],
                    startsAt: e.starts_at,
                    time: berlinTime(e.starts_at),
                    when: formatDateTime(e.starts_at),
                    venue: venue(e.location) ?? "",
                    helpers: e.helpers_needed,
                    ocs: e.ocs_needed,
                    fixed: fixed
                      .filter((f) => f.event_id === e.id)
                      .map((f) => ({ name: f.full_name, role: f.role as "oc" | "helper", me: f.profile_id === viewer.id, proposer: f.source === "proposer" })),
                    mine: mine.has(e.id),
                  }))}
                />
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** "OC: Keen" – darker for stronger wishes. */
function RankChip({ role, rank }: { role: string; rank: number }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", rank <= 2 ? "bg-esn text-white" : "bg-esn/10 text-esn-dark")}>
      {role}: {RANK_LABELS[rank]}
    </span>
  );
}
