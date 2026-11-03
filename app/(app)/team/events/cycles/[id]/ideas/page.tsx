import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { formatDateTime, formatShortDate } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { loadSorting } from "@/lib/sortingLoad";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { IdeaCard } from "../ScheduleClient";

export const metadata: Metadata = { title: "Ideas" };

const DECIDED: Record<string, { label: string; tone: "green" | "blue" | "red" }> = {
  accepted: { label: "Accepted", tone: "green" },
  merged: { label: "Merged", tone: "blue" },
  rejected: { label: "Not this time", tone: "red" },
};

// The month's ideas, a tab of its own (round 2026-11-03): always there,
// also once the schedule is locked – the open ideas (accept, merge, reject
// while the schedule can change) and the ones decided. Ideas of one format
// sit together and say when that format is planned already (round 2026-11-01).
export default async function CycleIdeasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await requirePageRole(["events"], { executiveMayRead: true, hide: true });
  const supabase = await createSessionClient();
  const { data: cycle } = await supabase.from("planning_cycles").select("id, month, status").eq("id", id).maybeSingle();
  if (!cycle) notFound();
  const editable = hasRole(viewer.roles, "events") && ["planning", "form_open"].includes(cycle.status);

  const monthEnd = new Date(Date.UTC(Number(cycle.month.slice(0, 4)), Number(cycle.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [{ data: rows }, { data: events }, { categories, formats }] = await Promise.all([
    supabase
      .from("event_ideas")
      .select("id, title, proposed_date, pitch, helpers_needed, wants_to_oc, type_suggestion, category_id, format_id, status, decision_note, event_id, profiles:proposer_id(full_name)")
      .gte("proposed_date", cycle.month)
      .lte("proposed_date", monthEnd)
      .order("proposed_date"),
    supabase.from("events").select("id, title, starts_at, format_id").eq("cycle_id", id).neq("status", "dropped").order("starts_at"),
    loadSorting(supabase),
  ]);
  const open = (rows ?? []).filter((i) => i.status === "proposed");
  const decided = (rows ?? []).filter((i) => i.status !== "proposed");
  // Ideas of one format next to each other (in the order of their first date).
  const firstOfFormat = new Map<string, string>();
  for (const i of open) if (i.format_id && !firstOfFormat.has(i.format_id)) firstOfFormat.set(i.format_id, i.proposed_date);
  const ideas = open.slice().sort((a, b) => {
    const ka = a.format_id ? `${firstOfFormat.get(a.format_id)}|${a.format_id}` : a.proposed_date;
    const kb = b.format_id ? `${firstOfFormat.get(b.format_id)}|${b.format_id}` : b.proposed_date;
    return ka < kb ? -1 : ka > kb ? 1 : a.proposed_date < b.proposed_date ? -1 : 1;
  });

  return (
    <div className="space-y-6">
      {!editable && open.length > 0 && (
        <Alert tone="info" data-testid="ideas-locked">
          The schedule is fixed now, so these ideas can no longer be added to this month. Members can propose them again for a later month.
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Open ideas</CardTitle>
          <Badge tone={ideas.length ? "amber" : undefined}>{ideas.length}</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="idea-inbox">
          {!ideas.length && <EmptyState>No open ideas for this month.</EmptyState>}
          {ideas.map((i) => (
            <IdeaCard
              key={i.id}
              canEdit={editable}
              cycleId={cycle.id}
              events={(events ?? []).map((e) => ({ id: e.id, title: e.title, formatId: e.format_id, when: formatDateTime(e.starts_at) }))}
              categories={categories}
              formats={formats}
              sameFormatIdeas={i.format_id ? ideas.filter((x) => x.format_id === i.format_id).length - 1 : 0}
              idea={{
                id: i.id,
                title: i.title,
                date: i.proposed_date,
                pitch: i.pitch,
                helpers: i.helpers_needed,
                wantsToOc: i.wants_to_oc,
                typeSuggestion: i.type_suggestion,
                categoryId: i.category_id,
                formatId: i.format_id,
                proposer: (i.profiles as { full_name: string } | null)?.full_name ?? "",
              }}
            />
          ))}
          <p className="text-xs text-gray-500 md:col-span-2 xl:col-span-3">
            Ideas dated in other months appear in those months&apos; Ideas tab.{editable && " On the Schedule tab, drag an idea from the calendar tray onto a day to add it quickly."}
          </p>
        </CardContent>
      </Card>
      {decided.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Decided</CardTitle>
            <Badge>{decided.length}</Badge>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-gray-100 text-sm" data-testid="ideas-decided">
              {decided.map((i) => {
                const d = DECIDED[i.status] ?? { label: i.status, tone: "blue" as const };
                return (
                  <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                    <span className="w-24 shrink-0 tabular-nums text-xs text-gray-600">{formatShortDate(i.proposed_date)}</span>
                    {i.event_id ? (
                      <Link href={`/events/${i.event_id}?from=cycle:${id}`} className="font-medium text-gray-900 hover:text-esn">
                        {i.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900">{i.title}</span>
                    )}
                    <span className="text-xs text-gray-500">by {(i.profiles as { full_name: string } | null)?.full_name ?? "someone"}</span>
                    <Badge tone={d.tone} className="ml-auto">
                      {d.label}
                    </Badge>
                    {i.decision_note && <span className="w-full text-xs text-gray-500 sm:pl-27">“{i.decision_note}”</span>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
