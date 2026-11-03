import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, formatDate, formatDateTime, monthLabel, nowMs } from "@/lib/dates";
import { cycleTimeline, firstOpenIdeaMonth, relativeDue } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { withdrawIdea } from "@/app/actions/planning";
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
  const [{ data: ideas }, { data: past }, { categories, formats }, days] = await Promise.all([
    supabase
      .from("event_ideas")
      .select("id, title, proposed_date, pitch, helpers_needed, wants_to_oc, status, decision_note, event_id, category_id")
      .eq("proposer_id", viewer.id)
      .order("created_at", { ascending: false }),
    // Previous events for "Get inspired": only what members may read (published descriptions, headcounts, photo folders).
    supabase.rpc("inspiration_events"),
    loadSorting(supabase),
    loadTimelineDays(supabase),
  ]);
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
      <IdeasWorkspace pool={(past ?? []) as PastEvent[]} earliest={open} days={days} categories={categories} formats={formats} proposeOpen={!ideas?.length}>
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
