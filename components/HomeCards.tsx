import Link from "next/link";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinTime, cycleLabel, formatShortDate, monthLabel, monthOf } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { INTERNAL_KIND_LABELS, INTERNAL_KIND_TONES, internalPath, type InternalKind } from "@/lib/internal";
import { cycleTimeline, milestones, relativeDue, upcomingCycleMonth, type MilestoneId } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { plural } from "@/lib/plural";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
/** Description states that count as "in". */
const IN = ["submitted", "approved", "published"];

/**
 * The planning timeline on Home (round 2026-11-02): the cycle members are
 * working towards (next month's events until their descriptions are due),
 * its four dates – ideas, form opens, sign-up closes, descriptions – and
 * where the member stands at each: their ideas for the month, their answer,
 * their descriptions as OC. A date someone set on the cycle (form deadline,
 * description deadline) wins over the standard day.
 */
export async function CycleTimelineCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const days = await loadTimelineDays(supabase);
  const month = upcomingCycleMonth(now, days);
  const standard = cycleTimeline(month, days);
  const [{ data: cycle }, { count: ideas }] = await Promise.all([
    supabase.from("planning_cycles").select("id, status, form_closes_at, description_deadline").eq("month", month).maybeSingle(),
    supabase.from("event_ideas").select("id", { count: "exact", head: true }).eq("proposer_id", viewerId).gte("proposed_date", month).lt("proposed_date", addMonths(month, 1)),
  ]);
  const [{ data: answer }, { data: myOc }] = cycle
    ? await Promise.all([
        supabase.from("volunteer_responses").select("submitted_at").eq("cycle_id", cycle.id).eq("profile_id", viewerId).maybeSingle(),
        cycle.status === "confirmed"
          ? supabase.from("assignments").select("events!inner(cycle_id, status, descriptions(status))").eq("profile_id", viewerId).eq("role", "oc").eq("status", "active").eq("events.cycle_id", cycle.id)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: null }, { data: [] }];
  const timeline = { ...standard, formCloses: cycle?.form_closes_at ?? standard.formCloses, descriptionsDue: cycle?.description_deadline ?? standard.descriptionsDue };
  const ocEvents = (myOc ?? [])
    .map((a) => a.events as unknown as { status: string; descriptions: { status: string } | null })
    .filter((e) => !["cancelled", "dropped"].includes(e.status));
  const ocIn = ocEvents.filter((e) => IN.includes(e.descriptions?.status ?? "")).length;
  const formOpen = cycle?.status === "form_open";
  const formDone = !!cycle && !["planning", "form_open"].includes(cycle.status);

  const detail: Record<Exclude<MilestoneId, "roster">, React.ReactNode> = {
    ideas: ideas ? `You proposed ${plural(ideas, "idea")}` : "Propose what you'd love to run",
    formOpens: formOpen ? "Pick the events you can OC or help with" : formDone ? "The roster is being made" : "Pick the events you can OC or help with",
    formCloses: answer?.submitted_at ? "✓ You answered" : formOpen ? <span className="font-medium text-amber-800">Not answered yet</span> : formDone ? "Closed – roster next" : "Sign up as OC or helper",
    descriptions: ocEvents.length ? `Your descriptions: ${ocIn} of ${ocEvents.length} in` : "OCs submit their event's description",
  };
  const steps = milestones(timeline, now).map((m) => {
    // The form really opened (or not) – the cycle knows better than the calendar.
    const opened = m.id === "formOpens" && (formOpen || formDone);
    return { ...m, state: opened ? ("passed" as const) : m.state, when: opened ? (formOpen ? "Open now" : "Opened") : formatShortDate(m.at), detail: detail[m.id as Exclude<MilestoneId, "roster">] };
  });
  const ideasOpen = Date.parse(timeline.ideasDue) >= now;

  return (
    <Card data-testid="home-timeline" className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-esn/10 bg-gradient-to-r from-esn/[0.07] to-esn-accent/[0.07] px-5 py-4">
        <div className="mr-auto min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-esn">Planning timeline</p>
          <h2 className="text-lg font-semibold text-gray-900">{cycleLabel(month)}</h2>
        </div>
        {ideasOpen ? (
          <Link href="/ideas#propose" className={buttonVariants({ size: "sm", variant: "outline" })}>
            Propose an idea
          </Link>
        ) : (
          <Link href="/ideas" className="text-sm text-esn hover:underline">
            Ideas for {monthLabel(addMonths(month, 1)).split(" ")[0]} and later →
          </Link>
        )}
      </div>
      <ol className="grid gap-4 px-5 py-4 sm:grid-cols-4 sm:gap-0" aria-label={`Timeline of ${cycleLabel(month)}`}>
        {steps.map((s, i) => (
          <li key={s.id} className="flex gap-3 sm:block" data-state={s.state} data-testid={`timeline-${s.id}`}>
            <div className="flex items-center sm:mb-2" aria-hidden="true">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  s.state === "passed" && "bg-emerald-500 text-white",
                  s.state === "next" && "bg-esn text-white ring-4 ring-esn/15",
                  s.state === "later" && "border-2 border-gray-300 bg-white text-gray-400"
                )}
              >
                {s.state === "passed" ? "✓" : i + 1}
              </span>
              {i < steps.length - 1 && <span className={cn("hidden h-0.5 flex-1 sm:block", s.state === "passed" ? "bg-emerald-300" : "bg-gray-200")} />}
            </div>
            <div className="min-w-0 sm:pr-3">
              <p className={cn("text-xs tabular-nums", s.state === "next" ? "font-semibold text-esn" : "text-gray-500")}>
                {s.when}
                {s.state === "next" && ` · ${relativeDue(s.at, now)}`}
              </p>
              <p className={cn("text-sm font-semibold", s.state === "passed" ? "text-gray-500" : "text-gray-900")}>{s.label}</p>
              <p className="text-xs text-gray-600">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * What comes up in MESA (round 2026-11-02): the internal events, meetings
 * and office hours of the next weeks – the member's own ESN events are under
 * "My events", the month at a glance is the Calendar. RLS shows executive
 * board meetings to the executive board only.
 */
export async function ComingUpCard({ viewerId, now }: { viewerId: string; now: number }) {
  const supabase = await createSessionClient();
  const [{ data: next }, { data: mine }] = await Promise.all([
    supabase
      .from("internal_events")
      .select("id, kind, title, starts_at, status")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 30 * DAY).toISOString())
      .eq("status", "scheduled")
      .order("starts_at")
      .limit(6),
    supabase.from("internal_event_people").select("internal_event_id, role").eq("profile_id", viewerId),
  ]);
  const myRole = new Map((mine ?? []).map((p) => [p.internal_event_id, p.role]));
  return (
    <Card data-testid="home-internal">
      <CardHeader>
        <CardTitle>Coming up in MESA</CardTitle>
        <Link href={`/calendar?month=${monthParam(monthOf(new Date(now).toISOString()))}&show=internal`} className="text-sm text-esn hover:underline">
          Calendar →
        </Link>
      </CardHeader>
      <CardContent>
        {!next?.length ? (
          <EmptyState>Nothing planned in the next four weeks.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm" data-testid="home-internal-next">
            {next.map((e) => {
              const role = myRole.get(e.id);
              const kind = e.kind as InternalKind;
              return (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">
                    {formatShortDate(e.starts_at)}
                    <span className="block">{berlinTime(e.starts_at)}</span>
                  </span>
                  <Link href={internalPath(kind, e.id)} className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-esn">
                    {e.title}
                  </Link>
                  {role ? <Badge tone="blue">{role === "oc" ? "You: OC" : role === "helper" ? "You: helper" : "Signed up"}</Badge> : <Badge tone={INTERNAL_KIND_TONES[kind]}>{INTERNAL_KIND_LABELS[kind]}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
