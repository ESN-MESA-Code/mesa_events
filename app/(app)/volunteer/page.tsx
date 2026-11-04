import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { cycleLabel, formatDateTime } from "@/lib/dates";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { RANK_LABELS } from "@/lib/volunteer";
import { plural } from "@/lib/plural";
import { Alert, Badge, Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { VolunteerForm } from "./VolunteerForm";

export const metadata: Metadata = { title: "Volunteer" };

// The month's volunteer form: every event of an open cycle; volunteers pick
// what they can do and rank OC and helper preferences per event. One
// submission per person: afterwards the answers are shown read-only.
export default async function VolunteerPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const { data: cycles } = await supabase.from("planning_cycles").select("id, month, form_closes_at").eq("status", "form_open").order("month");

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
        description="Pick the events you can do and say how much you want to be OC or helper. You submit once; after the deadline the roster is allocated fairly – how is explained below the form."
      />
      {!forms.length && (
        <Card>
          <EmptyState>No volunteer form is open right now. The Events team opens the next one when the month&apos;s schedule is ready – it will show up on your Home page.</EmptyState>
        </Card>
      )}
      <div className="space-y-8">
        {forms.map(({ cycle, events, response, mine, fixed }) => {
          const label = cycleLabel(cycle.month);
          const chosen = new Map((response?.volunteer_choices ?? []).map((c) => [c.event_id, c]));
          return (
            <section key={cycle.id} aria-label={`Volunteer form ${label}`}>
              <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
              <p className="text-sm text-gray-500 mb-3">{cycle.form_closes_at ? `Open until ${formatDateTime(cycle.form_closes_at)}.` : "Open."}</p>
              {response ? (
                <Card data-testid="volunteer-summary">
                  <CardContent className="pt-5 space-y-3">
                    <Alert tone="success">
                      Submitted ✓ on {formatDateTime(response.submitted_at)}. Your answers are locked – ask the Events team if something changes.
                    </Alert>
                    {chosen.size ? (
                      <>
                        <p className="text-sm font-medium text-gray-900">You signed up for:</p>
                        <ul className="divide-y divide-gray-100 text-sm">
                          {events
                            .filter((e) => chosen.has(e.id))
                            .map((e) => {
                              const c = chosen.get(e.id)!;
                              return (
                                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                                  <span className="font-medium text-gray-900">{e.title}</span>
                                  <span className="text-xs text-gray-500">{formatDateTime(e.starts_at)}</span>
                                  <span className="ml-auto flex gap-1">
                                    {c.oc_rank && <Badge tone="blue">OC: {RANK_LABELS[c.oc_rank]}</Badge>}
                                    {c.helper_rank && <Badge>Helper: {RANK_LABELS[c.helper_rank]}</Badge>}
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                      </>
                    ) : (
                      <p className="text-sm text-gray-600">You did not pick any event this month.</p>
                    )}
                    {fixed.some((f) => f.profile_id === viewer.id) && (
                      <p className="text-sm text-gray-600">
                        From your ideas you are on:{" "}
                        {events
                          .flatMap((e) => fixed.filter((f) => f.event_id === e.id && f.profile_id === viewer.id).map((f) => `${e.title} (${f.role === "oc" ? "OC" : "helper"})`))
                          .join(", ")}
                        .
                      </p>
                    )}
                    {chosen.size > 0 && (
                      <p className="text-sm text-gray-600">
                        {response.max_events ? `At most ${plural(response.max_events, "event")}` : "No limit on events"}
                        {response.max_oc ? `, OC of at most ${plural(response.max_oc, "event")}.` : "."}
                      </p>
                    )}
                    {response.note && <p className="text-sm text-gray-600">Your note: {response.note}</p>}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-4">
                    <VolunteerForm
                      cycleId={cycle.id}
                      month={label}
                      events={events.map((e) => ({
                        id: e.id,
                        title: e.title,
                        type: EVENT_TYPE_LABELS[e.type],
                        when: formatDateTime(e.starts_at),
                        location: e.location ?? "",
                        helpers: e.helpers_needed,
                        ocs: e.ocs_needed,
                        fixed: fixed
                          .filter((f) => f.event_id === e.id)
                          .map((f) => ({ name: f.full_name, role: f.role as "oc" | "helper", me: f.profile_id === viewer.id, proposer: f.source === "proposer" })),
                        mine: mine.has(e.id),
                      }))}
                    />
                  </CardContent>
                </Card>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
