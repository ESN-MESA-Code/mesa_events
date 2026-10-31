import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { cycleLabel, formatCents, formatDateTime, formatShortDate, monthOf, nowMs } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { nextStep, type NextStep } from "@/lib/checklist";
import { checklistInput, volunteerForms } from "@/lib/eventStatus";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { hasRole } from "@/lib/roles";
import type { EventStatus } from "@/lib/labels";
import type { ClaimStatus } from "@/lib/reimbursement";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { ClaimStatusBadge, DueLabel, EventStatusBadge } from "@/components/status";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/plural";
import { InternalCalendarCard, LeaderboardCard } from "@/components/HomeCards";

export const metadata: Metadata = { title: "Home" };

const DAY = 86_400_000;
const STEP_TONE: Record<NextStep["kind"], string> = {
  action: "border-esn/30 bg-esn/5 text-esn-dark",
  waiting: "border-gray-200 bg-gray-50 text-gray-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

// "What's next for me": the open volunteer form, my events with their next
// step, open slots, the internal calendar, my claims that need something,
// the semester's leaderboard, and one card per team queue for team members.
export default async function HomePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const isEvents = hasRole(viewer.roles, "events");
  const isComms = hasRole(viewer.roles, "comms");
  const isFinance = hasRole(viewer.roles, "finance");
  const isExec = viewer.roles.includes("executive");

  const [forms, { data: assignments }, { data: slots }, { data: claims }] = await Promise.all([
    volunteerForms(viewer.id),
    supabase
      .from("assignments")
      .select("id, role, events(id, title, status, starts_at, helpers_needed, chat_space_name, chat_space_requested_at, planning_cycles(description_deadline))")
      .eq("profile_id", viewer.id)
      .eq("status", "active"),
    supabase.rpc("open_slots"),
    supabase
      .from("reimbursements")
      .select("id, status, payout_method, suggested_cents, approved_cents, events(id, title), receipts(vendor, amount_cents)")
      .eq("claimant_id", viewer.id)
      .in("status", ["not_submitted", "beleg_received", "checked"]),
  ]);

  // My events: upcoming, and recent ones whose hand-in is not finished.
  type Ev = { id: string; title: string; status: EventStatus; starts_at: string; helpers_needed: number; chat_space_name: string | null; chat_space_requested_at: string | null; planning_cycles: { description_deadline: string | null } | null };
  const mine = (assignments ?? [])
    .map((a) => ({ role: a.role as "oc" | "helper", event: a.events as unknown as Ev | null }))
    .filter((a): a is { role: "oc" | "helper"; event: Ev } => !!a.event && Date.parse(a.event.starts_at) > now - 45 * DAY && !["draft", "dropped"].includes(a.event.status));
  const withSteps = await Promise.all(
    mine.map(async (a) => {
      const input = await checklistInput(supabase, a.event, a.event.planning_cycles?.description_deadline ?? null, viewer.id);
      return { ...a, step: nextStep(input, a.role) };
    })
  );
  const myEvents = withSteps
    .filter((a) => Date.parse(a.event.starts_at) > now - DAY || a.step.kind !== "done")
    .sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));

  const myIds = new Set(mine.map((a) => a.event.id));
  const claimable = (slots ?? []).filter((s) => !myIds.has(s.event_id));
  const { data: slotEvents } = claimable.length
    ? await supabase.from("events").select("id, title, starts_at").in("id", claimable.map((s) => s.event_id)).order("starts_at")
    : { data: [] };

  const needs = (claims ?? []).filter((c) => !c.payout_method || c.status === "not_submitted");

  return (
    <>
      <PageHeader title={`Hi ${viewer.name.split(" ")[0]}`} description="What's next for you." />
      <div className="space-y-6">
        {forms.map((f) =>
          f.submittedAt ? (
            <Alert key={f.id} tone="success" data-testid="home-volunteer">
              Volunteer form for <strong>{cycleLabel(f.month)}</strong>: submitted ✓ – you signed up for {plural(f.events, "event")}.{" "}
              <Link href="/volunteer" className="font-medium underline">
                See your answers
              </Link>
            </Alert>
          ) : (
            <div key={f.id} className="rounded-xl border border-esn/30 bg-esn/5 p-4 flex flex-wrap items-center gap-3" data-testid="home-volunteer">
              <div className="mr-auto">
                <p className="font-semibold text-esn-dark">The volunteer form for {cycleLabel(f.month)} is open</p>
                <p className="text-sm text-gray-600">{f.form_closes_at ? `Open until ${formatDateTime(f.form_closes_at)}.` : "Open now."} Say which events you can OC or help with.</p>
              </div>
              <Link href="/volunteer" className={buttonVariants()}>
                Fill in the form
              </Link>
            </div>
          )
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>My events</CardTitle>
              <Link href="/me" className="text-sm text-esn hover:underline">
                All my events →
              </Link>
            </CardHeader>
            <CardContent>
              {!myEvents.length && (
                <EmptyState>
                  {forms.some((f) => !f.submittedAt) ? "Nothing planned yet – fill in the volunteer form above, or claim an open slot." : "Nothing planned. Volunteer when the next form opens, or claim an open slot."}
                </EmptyState>
              )}
              <ul className="space-y-3" data-testid="home-my-events">
                {myEvents.map(({ event, role, step }) => (
                  <li key={event.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/events/${event.id}?from=home`} className="font-medium text-gray-900 hover:text-esn break-words">
                        {event.title}
                      </Link>
                      <Badge tone="blue">{role === "oc" ? "OC" : "Helper"}</Badge>
                      {event.status !== "confirmed" && <EventStatusBadge status={event.status} />}
                      <span className="ml-auto text-xs text-gray-500">{formatDateTime(event.starts_at)}</span>
                    </div>
                    <Link
                      href={`/events/${event.id}${step.tab ? `/${step.tab}` : ""}?from=home`}
                      className={cn("flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-sm hover:underline", STEP_TONE[step.kind])}
                      data-testid="next-step"
                    >
                      <span className="font-medium">
                        {step.kind === "action" ? "→ " : step.kind === "done" ? "✓ " : "… "}
                        {step.label}
                      </span>
                      {step.due && <DueLabel iso={step.due} now={now} note={step.dueNote} className="text-xs" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Open slots</CardTitle>
                <Badge tone={claimable.length ? "amber" : "gray"}>{claimable.length}</Badge>
              </CardHeader>
              <CardContent>
                {!claimable.length && <EmptyState>No open slots right now.</EmptyState>}
                <ul className="divide-y divide-gray-100 text-sm" data-testid="home-open-slots">
                  {(slotEvents ?? []).map((e) => {
                    const s = claimable.find((x) => x.event_id === e.id)!;
                    return (
                      <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                        <Link href={`/events/${e.id}?from=home`} className="font-medium text-gray-900 hover:text-esn">
                          {e.title}
                        </Link>
                        <span className="text-xs text-gray-500">{formatShortDate(e.starts_at)}</span>
                        <Badge tone="amber" className="ml-auto">
                          {s.open_oc ? "OC needed" : plural(s.open_helpers, "helper slot")}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <InternalCalendarCard viewerId={viewer.id} now={now} />

            {needs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>My claims need something</CardTitle>
                  <Badge tone="amber">{needs.length}</Badge>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-gray-100 text-sm" data-testid="home-claims">
                    {needs.map((c) => {
                      const e = c.events as { id: string; title: string } | null;
                      const r = c.receipts as { vendor: string; amount_cents: number } | null;
                      return (
                        <li key={c.id} className="py-2 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{r?.vendor}</span>
                            <span className="text-xs text-gray-500">
                              {e?.title} · receipt {formatCents(r?.amount_cents)}
                            </span>
                            <ClaimStatusBadge status={c.status as ClaimStatus} className="ml-auto" />
                          </div>
                          <p className="text-xs text-amber-800">
                            {!c.payout_method && (
                              <Link href="/me#claims" className="underline">
                                Add bank or PayPal details
                              </Link>
                            )}
                            {!c.payout_method && c.status === "not_submitted" && " · "}
                            {c.status === "not_submitted" && "Hand the paper Beleg to Finance"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <LeaderboardCard viewerId={viewer.id} now={now} />

        {(isEvents || isComms || isFinance || isExec) && (
          <section aria-label="Team queues" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Team queues</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(isEvents || isExec) && <EventsQueue />}
              {(isComms || isExec) && <CommsQueue />}
              {(isFinance || isExec) && <FinanceQueue />}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function QueueCard({ title, href, testId, children }: { title: string; href: string; testId: string; children: React.ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Link href={href} className="text-sm text-esn hover:underline">
          Open →
        </Link>
      </CardHeader>
      <CardContent className="text-sm space-y-2">{children}</CardContent>
    </Card>
  );
}

function Figure({ label, value, tone, href }: { label: string; value: number; tone?: "amber" | "red" | "blue"; href?: string }) {
  return (
    <p className="flex items-center gap-2">
      {href && value ? (
        <Link href={href} className="text-esn hover:underline">
          {label}
        </Link>
      ) : (
        <span className="text-gray-600">{label}</span>
      )}
      <Badge tone={value ? (tone ?? "blue") : "gray"} className="ml-auto tabular-nums">
        {value}
      </Badge>
    </p>
  );
}

async function EventsQueue() {
  const supabase = await createSessionClient();
  const [{ data: cycles }, { data: slots }] = await Promise.all([
    supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month"),
    supabase.rpc("open_slots"),
  ]);
  // Done cycles drop out (review 2026-10-29 A4).
  const progress = (await cyclesWithProgress(supabase, cycles ?? [])).filter((c) => !c.progress.done);
  return (
    <QueueCard title="Events team" href="/team/events" testId="queue-events">
      {!progress.length && <p className="text-gray-500">No cycle running – start the next month.</p>}
      <ul className="space-y-1.5">
        {progress.map((c) => (
          <li key={c.id}>
            <Link href={`/team/events?month=${monthParam(c.month)}`} className="font-medium text-esn hover:underline">
              {cycleLabel(c.month)}
            </Link>
            <span className="block text-xs text-gray-600">{c.progress.current ? `${c.progress.steps.find((s) => s.state === "current")!.label}: ${c.progress.action}` : c.progress.summary}</span>
          </li>
        ))}
      </ul>
      <Figure label="Upcoming events short of people" value={(slots ?? []).length} tone="amber" />
    </QueueCard>
  );
}

async function CommsQueue() {
  const supabase = await createSessionClient();
  const now = nowMs();
  const [{ data }, { data: posts }] = await Promise.all([
    supabase.rpc("description_overview"),
    // The publishing schedule (brief 2026-10-29, E3): planned posts until a week ahead.
    supabase.from("publication_posts").select("scheduled_for").eq("status", "planned").lte("scheduled_for", new Date(now + 7 * 86_400_000).toISOString()),
  ]);
  const overdue = (posts ?? []).filter((p) => Date.parse(p.scheduled_for) < now).length;
  const thisWeek = (posts ?? []).length - overdue;
  // Only what can still be done: no missed events, Late only while the event is ahead (review 2026-10-29 A6).
  const rows = (data ?? []).filter((r) => !r.missed).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  // Each figure leads to the month of its first event, filtered to that stage (brief 2026-10-29, C).
  const link = (list: typeof rows, show: string) => (list.length ? `/team/comms?month=${monthParam(monthOf(list[0].starts_at))}&show=${show}` : undefined);
  const review = rows.filter((r) => r.status === "submitted");
  const ready = rows.filter((r) => r.status === "approved");
  const late = rows.filter((r) => r.late);
  return (
    <QueueCard title="Comms" href={link([...review, ...ready, ...late].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), "needs") ?? "/team/comms"} testId="queue-comms">
      <Figure label="Awaiting review" value={review.length} href={link(review, "review")} />
      <Figure label="Approved – ready to publish" value={ready.length} href={link(ready, "publish")} />
      <Figure label="Late" value={late.length} tone="red" href={link(late, "write")} />
      <Figure label="Posts planned this week" value={thisWeek} href="/team/comms/schedule" />
      <Figure label="Overdue posts" value={overdue} tone="red" href="/team/comms/schedule" />
    </QueueCard>
  );
}

async function FinanceQueue() {
  const supabase = await createSessionClient();
  const [{ data: claims }, { data: batches }] = await Promise.all([
    supabase.from("reimbursements").select("status, batch_id").in("status", ["not_submitted", "beleg_received", "checked"]),
    supabase.from("payout_batches").select("id").eq("status", "open"),
  ]);
  const open = new Set((batches ?? []).map((b) => b.id));
  const toPay = new Set((claims ?? []).filter((c) => c.status === "checked" && c.batch_id && open.has(c.batch_id)).map((c) => c.batch_id));
  return (
    <QueueCard title="Finance" href="/team/finance" testId="queue-finance">
      <Figure label="Belege to receive" value={(claims ?? []).filter((c) => c.status === "not_submitted").length} tone="amber" />
      <Figure label="Claims to check" value={(claims ?? []).filter((c) => c.status === "beleg_received").length} />
      <Figure label="Batches to pay" value={toPay.size} />
    </QueueCard>
  );
}
