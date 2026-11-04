import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, formatDate, formatDateTime, monthLabel, nowMs } from "@/lib/dates";
import { cycleTimeline, firstOpenIdeaMonth, relativeDue } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { respondIdeaPartner, withdrawIdea } from "@/app/actions/planning";
import { IdeaPartnersEditor } from "./PartnerPicker";
import { IdeasWorkspace } from "./Inspiration";
import type { PastEvent } from "@/lib/inspiration";
import { plural } from "@/lib/plural";
import { loadSorting } from "@/lib/sortingLoad";
import { categoryLabel } from "@/lib/formats";

export const metadata: Metadata = { title: "Ideas" };

const STATUS: Record<string, { label: string; tone: "gray" | "green" | "red" | "blue" }> = {
  proposed: { label: "Waiting for Events", tone: "gray" },
  accepted: { label: "Accepted", tone: "green" },
  merged: { label: "Merged", tone: "blue" },
  rejected: { label: "Not this time", tone: "red" },
};

export default async function IdeasPage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const [{ data: ideas }, { data: past }, { categories, formats }, days, { data: profiles }, { data: asked }] = await Promise.all([
    supabase
      .from("event_ideas")
      .select("id, title, proposed_date, pitch, helpers_needed, ocs_needed, wants_to_oc, status, decision_note, event_id, category_id, idea_partners(profile_id, role, status)")
      .eq("proposer_id", viewer.id)
      .order("created_at", { ascending: false }),
    // Previous events for "Get inspired": only what members may read (published descriptions, headcounts, photo folders).
    supabase.rpc("inspiration_events"),
    loadSorting(supabase),
    loadTimelineDays(supabase),
    supabase.from("profiles").select("id, full_name").order("full_name"),
    // Ideas others asked the viewer to join (round 2026-11-04).
    supabase
      .from("idea_partners")
      .select("role, status, event_ideas(id, title, proposed_date, status, event_id, profiles:proposer_id(full_name))")
      .eq("profile_id", viewer.id)
      .order("created_at", { ascending: false }),
  ]);
  const members = (profiles ?? []).filter((p) => p.id !== viewer.id).map((p) => ({ id: p.id, name: p.full_name }));
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const requests = (asked ?? [])
    .map((a) => ({ role: a.role as "oc" | "helper", status: a.status as "invited" | "accepted" | "declined", idea: a.event_ideas as unknown as { id: string; title: string; proposed_date: string; status: string; event_id: string | null; profiles: { full_name: string } | null } | null }))
    .filter((r) => r.idea && ["proposed", "accepted"].includes(r.idea.status));
  // The ideas window (round 2026-11-02): the next month until its deadline, every later month always.
  const now = nowMs();
  const open = firstOpenIdeaMonth(now, days);
  const due = cycleTimeline(open, days).ideasDue;
  const categoryOf = new Map(categories.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader
        title="Ideas"
        description="Propose an event – or get inspired by what ran before. The Events team builds each month's schedule from the ideas; by default you become its OC."
      />
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-esn/20 bg-esn/5 px-4 py-3 text-sm" data-testid="ideas-deadline">
        <span className="text-esn-dark">
          💡 Ideas for <strong>{monthLabel(open)}</strong> are due <strong>{formatDateTime(due)}</strong>
          <span className="text-gray-600"> ({relativeDue(due, now)})</span>.
        </span>
        <span className="text-gray-600">After that they go into {monthLabel(addMonths(open, 1))} or later – ideas for next year are welcome any time.</span>
      </div>
      {requests.length > 0 && (
        <Card className="mb-6" data-testid="idea-requests">
          <CardHeader>
            <CardTitle>Asked to join</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-gray-100">
              {requests.map(({ idea, role, status }) => (
                <li key={idea!.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="text-sm text-gray-900">
                    <strong>{idea!.profiles?.full_name ?? "Someone"}</strong> asks you to run <strong>{idea!.title}</strong> ({formatDate(`${idea!.proposed_date}T12:00:00Z`)}) as{" "}
                    {role === "oc" ? "co-OC" : "helper"}.
                  </span>
                  {status !== "invited" && <Badge tone={status === "accepted" ? "green" : "red"}>{status === "accepted" ? "You said yes" : "You said no"}</Badge>}
                  <span className="ml-auto flex gap-2">
                    {status !== "accepted" && (
                      <ActionButton action={respondIdeaPartner} input={{ idea_id: idea!.id, accept: true }} size="sm" done={`You're on ${idea!.title} as ${role === "oc" ? "co-OC" : "helper"}.`}>
                        Yes, I&apos;m in
                      </ActionButton>
                    )}
                    {status !== "declined" && (
                      <ActionButton action={respondIdeaPartner} input={{ idea_id: idea!.id, accept: false }} size="sm" variant="outline" done="Answer sent.">
                        {status === "accepted" ? "Step back" : "No, thanks"}
                      </ActionButton>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <IdeasWorkspace pool={(past ?? []) as PastEvent[]} earliest={open} days={days} categories={categories} formats={formats} members={members} proposeOpen={!ideas?.length}>
        <Card>
          <CardHeader>
            <CardTitle>Your ideas</CardTitle>
          </CardHeader>
          <CardContent>
            {!ideas?.length && <EmptyState>You haven&apos;t proposed anything yet.</EmptyState>}
            <ul className="divide-y divide-gray-100" data-testid="my-ideas">
              {(ideas ?? []).map((i) => (
                <li key={i.id} className="py-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{i.title}</span>
                    <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                    {i.category_id && categoryOf.has(i.category_id) && <Badge tone="purple">{categoryLabel(categoryOf.get(i.category_id)!)}</Badge>}
                    <span className="ml-auto text-xs text-gray-500">{formatDate(`${i.proposed_date}T12:00:00Z`)}</span>
                  </div>
                  {i.pitch && <p className="text-sm text-gray-600 whitespace-pre-line">{i.pitch}</p>}
                  <p className="text-xs text-gray-500">
                    {i.ocs_needed > 1 && `${i.ocs_needed} OCs · `}
                    {plural(i.helpers_needed, "helper")} · {i.wants_to_oc ? "you OC it" : "someone else OCs"}
                    {i.event_id && (
                      <>
                        {" · "}
                        <a className="text-esn hover:underline" href={`/events/${i.event_id}?from=me`}>
                          event page
                        </a>
                      </>
                    )}
                  </p>
                  {i.decision_note && <p className="text-xs text-gray-600">Events: {i.decision_note}</p>}
                  {i.status === "proposed" ? (
                    <IdeaPartnersEditor
                      ideaId={i.id}
                      members={members}
                      partners={(i.idea_partners ?? []).map((p) => ({ profile_id: p.profile_id, role: p.role as "oc" | "helper", status: p.status as "invited" | "accepted" | "declined" }))}
                    />
                  ) : (
                    (i.idea_partners ?? []).length > 0 && (
                      <p className="text-xs text-gray-500">
                        With:{" "}
                        {(i.idea_partners ?? [])
                          .map((p) => `${nameOf.get(p.profile_id) ?? "?"} (${p.role === "oc" ? "co-OC" : "helper"}, ${p.status === "accepted" ? "yes" : p.status === "declined" ? "no" : "asked"})`)
                          .join(", ")}
                      </p>
                    )
                  )}
                  {i.status === "proposed" && (
                    // A real button that asks first (usability review #31).
                    <ActionButton
                      action={withdrawIdea}
                      input={{ id: i.id }}
                      variant="outline"
                      className="text-red-700 hover:border-red-400 hover:text-red-800"
                      confirm={{
                        title: `Withdraw “${i.title}”?`,
                        body: "The Events team no longer sees it for the schedule. To bring it back, propose it again.",
                        confirmLabel: "Withdraw the idea",
                        danger: true,
                      }}
                      done="Idea withdrawn."
                    >
                      Withdraw idea
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </IdeasWorkspace>
    </>
  );
}
