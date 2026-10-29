import type { Metadata } from "next";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { formatDate } from "@/lib/dates";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { withdrawIdea } from "@/app/actions/planning";
import { IdeaForm } from "./IdeaForm";
import { plural } from "@/lib/plural";

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
  const { data: ideas } = await supabase
    .from("event_ideas")
    .select("id, title, proposed_date, pitch, helpers_needed, wants_to_oc, status, decision_note, event_id")
    .eq("proposer_id", viewer.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader title="Ideas" description="Propose an event. The Events team builds each month's schedule from the ideas; by default you become its OC." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Propose an idea</CardTitle>
          </CardHeader>
          <CardContent>
            <IdeaForm />
          </CardContent>
        </Card>
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
                    <ActionButton action={withdrawIdea} input={{ id: i.id }} variant="ghost" confirm="Withdraw this idea?">
                      Withdraw
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
