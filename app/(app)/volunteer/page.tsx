import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatDateTime, monthLabel } from "@/lib/dates";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { VolunteerForm } from "./VolunteerForm";

export const metadata: Metadata = { title: "Volunteer" };

// The month's volunteer form: every event of an open cycle; volunteers pick
// what they can do and rank OC and helper preferences per event.
export default async function VolunteerPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const { data: cycles } = await supabase.from("planning_cycles").select("id, month, form_closes_at").eq("status", "form_open").order("month");

  const forms = await Promise.all(
    (cycles ?? []).map(async (c) => {
      const [{ data: events }, { data: response }] = await Promise.all([
        supabase.from("events").select("id, title, type, starts_at, location, helpers_needed").eq("cycle_id", c.id).eq("status", "scheduled").order("starts_at"),
        supabase
          .from("volunteer_responses")
          .select("note, submitted_at, updated_at, volunteer_choices(event_id, oc_rank, helper_rank)")
          .eq("cycle_id", c.id)
          .eq("profile_id", viewer.id)
          .maybeSingle(),
      ]);
      return { cycle: c, events: events ?? [], response };
    })
  );

  return (
    <>
      <PageHeader
        title="Volunteer"
        description="Pick the events you can do and say how much you want to be OC or helper. After the deadline the roster is allocated: top choices first, then first come, first served."
      />
      {!forms.length && (
        <Card>
          <EmptyState>No volunteer form is open right now.</EmptyState>
        </Card>
      )}
      <div className="space-y-8">
        {forms.map(({ cycle, events, response }) => (
          <section key={cycle.id} aria-label={`Volunteer form ${monthLabel(cycle.month)}`}>
            <h2 className="text-lg font-semibold text-gray-900">{monthLabel(cycle.month)}</h2>
            <p className="text-sm text-gray-500 mb-3">
              {cycle.form_closes_at ? `Open until ${formatDateTime(cycle.form_closes_at)}.` : "Open."}
              {response && ` You answered on ${formatDateTime(response.submitted_at)}; you can still change your answers.`}
            </p>
            <Card>
              <CardContent className="pt-4">
                <VolunteerForm
                  cycleId={cycle.id}
                  note={response?.note ?? ""}
                  events={events.map((e) => ({
                    id: e.id,
                    title: e.title,
                    type: EVENT_TYPE_LABELS[e.type],
                    when: formatDateTime(e.starts_at),
                    location: e.location ?? "",
                    helpers: e.helpers_needed,
                  }))}
                  initial={Object.fromEntries(
                    (response?.volunteer_choices ?? []).map((c) => [c.event_id, { oc: c.oc_rank, helper: c.helper_rank }])
                  )}
                />
              </CardContent>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
