import type { Metadata } from "next";
import { CalendarClock, Plus } from "lucide-react";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, dueUrgency, formatDate, formatDateTime, monthLabel, nowMs } from "@/lib/dates";
import { cycleTimeline, firstOpenIdeaMonth, relativeDue } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { buttonVariants, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { DateTile } from "@/components/DateTile";
import { SectionHeader } from "@/components/home";
import { respondIdeaPartner } from "@/app/actions/planning";
import { IdeasWorkspace } from "./Inspiration";
import { IdeaCard, type IdeaStatus } from "./IdeaCard";
import type { PastEvent } from "@/lib/inspiration";
import { loadSorting } from "@/lib/sortingLoad";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ideas" };

/** The deadline's colours: red within 24 hours, amber within 48, else ESN blue (as on Home). */
const DUE_TONE = { urgent: "bg-red-50 text-red-700", soon: "bg-amber-50 text-amber-800", later: "bg-esn/5 text-esn" } as const;

/**
 * Ideas (redesign 2026-11-07): one clear way in ("Propose an idea" opens the
 * form in a side panel, also from "Propose this again"), the deadline as a
 * strip, requests to join first, the member's ideas as cards, and the past
 * events to borrow from as a gallery below.
 */
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
  const waiting = requests.filter((r) => r.status === "invited").length;
  // The ideas window (round 2026-11-02): the next month until its deadline, every later month always.
  const now = nowMs();
  const open = firstOpenIdeaMonth(now, days);
  const due = cycleTimeline(open, days).ideasDue;
  const urgency = dueUrgency(due, now);
  const categoryOf = new Map(categories.map((c) => [c.id, c]));
  const mine = ideas ?? [];

  return (
    <>
      <PageHeader title="Ideas" description="Propose an event for a coming month – or bring back one that worked. The Events team builds each month's schedule from the ideas.">
        <a href="#propose" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Propose an idea
        </a>
      </PageHeader>

      <div className="space-y-8">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" data-testid="ideas-deadline">
          <span className={cn("hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex", DUE_TONE[urgency])} aria-hidden="true">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-gray-900">
              Ideas for <strong>{monthLabel(open)}</strong> are due <strong>{formatDateTime(due)}</strong>
              <span className="sm:hidden"> ({relativeDue(due, now)})</span>.
            </p>
            <p className="text-gray-600">After that they go into {monthLabel(addMonths(open, 1))} or later – ideas for next year are welcome any time.</p>
          </div>
          <span className={cn("hidden shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex", DUE_TONE[urgency])}>{relativeDue(due, now)}</span>
        </div>

        {requests.length > 0 && (
          <section aria-labelledby="asked-heading" className="space-y-3" data-testid="idea-requests">
            <SectionHeader id="asked-heading" title="Asked to join" count={waiting} note={waiting ? "Someone wants to run an idea with you." : undefined} />
            <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {requests.map(({ idea, role, status }) => (
                <li key={idea!.id} className={cn("flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3 first:border-t-0 sm:px-5", status === "invited" && "bg-amber-50/50")}>
                  <DateTile iso={`${idea!.proposed_date}T12:00:00Z`} />
                  <div className="min-w-48 flex-1 text-sm">
                    <p className="font-semibold text-gray-900 break-words">{idea!.title}</p>
                    <p className="text-gray-600">
                      {idea!.profiles?.full_name ?? "Someone"} asks you to run it as <strong className="font-semibold text-gray-800">{role === "oc" ? "co-OC" : "helper"}</strong>
                      {" · "}
                      {formatDate(`${idea!.proposed_date}T12:00:00Z`)}
                    </p>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    {status !== "invited" && (
                      <span className={cn("text-xs font-semibold", status === "accepted" ? "text-emerald-700" : "text-red-700")}>{status === "accepted" ? "You said yes" : "You said no"}</span>
                    )}
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
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <IdeasWorkspace pool={(past ?? []) as PastEvent[]} earliest={open} days={days} categories={categories} formats={formats} members={members}>
          <section aria-labelledby="mine-heading" className="space-y-3">
            <SectionHeader id="mine-heading" title="Your ideas" count={mine.length} />
            {!mine.length ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center" data-testid="my-ideas">
                <p className="font-semibold text-gray-900">You haven&apos;t proposed anything yet.</p>
                <p className="max-w-md text-sm text-gray-600">Got something you&apos;d love to do with the internationals? Propose it – or scroll down and bring back an event that worked before.</p>
                <a href="#propose" className={buttonVariants()}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Propose your first idea
                </a>
              </div>
            ) : (
              <ul className="grid items-start gap-4 md:grid-cols-2" data-testid="my-ideas">
                {mine.map((i) => (
                  <IdeaCard
                    key={i.id}
                    idea={{
                      ...i,
                      status: i.status as IdeaStatus,
                      partners: (i.idea_partners ?? []).map((p) => ({ profile_id: p.profile_id, role: p.role as "oc" | "helper", status: p.status as "invited" | "accepted" | "declined" })),
                    }}
                    category={i.category_id ? categoryOf.get(i.category_id) : null}
                    members={members}
                    nameOf={nameOf}
                  />
                ))}
              </ul>
            )}
          </section>
        </IdeasWorkspace>
      </div>
    </>
  );
}
