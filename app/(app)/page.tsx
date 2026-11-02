import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, berlinTime, cycleLabel, formatCents, formatDateTime, formatShortDate, monthOf, nowMs } from "@/lib/dates";
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
import { ComingUpCard, CycleTimelineCard } from "@/components/HomeCards";
import { StepIcon } from "@/components/StepIcon";
import { OrientationCard } from "@/components/Orientation";
import { byUrgency, happeningNow } from "@/lib/myEvents";
import { cycleTimeline, upcomingCycleMonth } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { eventMeeting, meetingShort } from "@/lib/meeting";
import { loadStillToPlan } from "@/lib/publishingLoad";

export const metadata: Metadata = { title: "Home" };

const DAY = 86_400_000;
const STEP_TONE: Record<NextStep["kind"], string> = {
  action: "border-esn/30 bg-esn/5 text-esn-dark",
  waiting: "border-gray-200 bg-gray-50 text-gray-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

// "What's next for me" (reworked in round 2026-11-02): what waits on the
// member (an open volunteer form, claims), the planning timeline of the
// coming month, my events with their next step, open slots, what comes up
// in MESA, and one card per team queue for team members. The leaderboard
// has its own page; the month at a glance is the Calendar.
export default async function HomePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const isEvents = hasRole(viewer.roles, "events");
  const isComms = hasRole(viewer.roles, "comms");
  const isFinance = hasRole(viewer.roles, "finance");
  const isExec = viewer.roles.includes("executive");

  const [forms, { data: assignments }, { data: slots }, { data: claims }, { count: everAssigned }, { data: payout }] = await Promise.all([
    volunteerForms(viewer.id),
    supabase
      .from("assignments")
      .select("id, role, events(id, title, status, starts_at, ends_at, location, meeting_point, meeting_street, meeting_postal_code, meeting_city, meeting_time, helpers_needed, chat_space_name, chat_space_url, chat_space_requested_at, planning_cycles(description_deadline))")
      .eq("profile_id", viewer.id)
      .eq("status", "active"),
    supabase.rpc("open_slots"),
    supabase
      .from("reimbursements")
      .select("id, status, payout_method, suggested_cents, approved_cents, events(id, title), receipts(vendor, amount_cents)")
      .eq("claimant_id", viewer.id)
      .in("status", ["not_submitted", "beleg_received", "checked"]),
    // A member who never had an event gets the orientation (usability review #14).
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("profile_id", viewer.id),
    supabase.from("profile_payout_details").select("profile_id").eq("profile_id", viewer.id).maybeSingle(),
  ]);

  // My events: upcoming, and recent ones whose hand-in is not finished.
  type Ev = {
    id: string;
    title: string;
    status: EventStatus;
    starts_at: string;
    ends_at: string | null;
    location: string | null;
    meeting_point: string | null;
    meeting_street: string | null;
    meeting_postal_code: string | null;
    meeting_city: string | null;
    meeting_time: string | null;
    helpers_needed: number;
    chat_space_name: string | null;
    chat_space_url: string | null;
    chat_space_requested_at: string | null;
    planning_cycles: { description_deadline: string | null } | null;
  };
  const mine = (assignments ?? [])
    .map((a) => ({ role: a.role as "oc" | "helper", event: a.events as unknown as Ev | null }))
    .filter((a): a is { role: "oc" | "helper"; event: Ev } => !!a.event && Date.parse(a.event.starts_at) > now - 45 * DAY && !["draft", "dropped"].includes(a.event.status));
  const withSteps = await Promise.all(
    mine.map(async (a) => {
      const input = await checklistInput(supabase, a.event, a.event.planning_cycles?.description_deadline ?? null, viewer.id);
      return { ...a, step: nextStep(input, a.role) };
    })
  );
  // Most urgent first (usability review #10): happening now, overdue, due soon, to do, waiting, done.
  const myEvents = byUrgency(
    withSteps.filter((a) => Date.parse(a.event.starts_at) > now - DAY || a.step.kind !== "done"),
    (a) => a.event,
    (a) => a.step,
    now
  ).map((a) => ({ ...a, live: happeningNow(a.event, now) }));

  const myIds = new Set(mine.map((a) => a.event.id));
  const claimable = (slots ?? []).filter((s) => !myIds.has(s.event_id));
  const { data: slotEvents } = claimable.length
    ? await supabase.from("events").select("id, title, starts_at").in("id", claimable.map((s) => s.event_id)).order("starts_at")
    : { data: [] };

  const needs = (claims ?? []).filter((c) => !c.payout_method || c.status === "not_submitted");
  const openForms = forms.filter((f) => !f.submittedAt);
  // What waits on the member besides an event's next step (those are under My events).
  const waiting = openForms.length + needs.length;

  return (
    <>
      <PageHeader
        title={`Hi ${viewer.name.split(" ")[0]}`}
        description={
          <>
            {formatDateTime(new Date(now).toISOString()).slice(0, -7)}
            {" · "}
            {waiting ? <span className="font-medium text-amber-800">{plural(waiting, "thing")} waiting for you</span> : "nothing waiting for you right now"}
          </>
        }
      />
      <div className="space-y-6">
        {!everAssigned && <OrientationCard formOpen={openForms.length > 0} hasPayout={!!payout} />}

        {waiting > 0 && (
          <section aria-labelledby="needs-you" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-testid="home-needs-you">
            <h2 id="needs-you" className="mb-2 text-sm font-semibold text-amber-900">
              Waiting for you
            </h2>
            <ul className="space-y-2">
              {openForms.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm" data-testid="home-volunteer">
                  <span className="text-lg" aria-hidden>
                    🙋
                  </span>
                  <div className="mr-auto min-w-0">
                    <p className="font-medium text-gray-900">The volunteer form for {cycleLabel(f.month)} is open</p>
                    <p className="text-xs text-gray-600">
                      {f.form_closes_at ? <DueLabel iso={f.form_closes_at} now={now} /> : "Open now"} · say which events you can OC or help with
                    </p>
                  </div>
                  <Link href="/volunteer" className={buttonVariants({ size: "sm" })}>
                    Fill in the form
                  </Link>
                </li>
              ))}
              {needs.map((c) => {
                const e = c.events as { id: string; title: string } | null;
                const r = c.receipts as { vendor: string; amount_cents: number } | null;
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm" data-testid="home-claims">
                    <span className="text-lg" aria-hidden>
                      🧾
                    </span>
                    <div className="mr-auto min-w-0">
                      <p className="font-medium text-gray-900">
                        {r?.vendor} · {formatCents(r?.amount_cents)}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                        {e?.title} <ClaimStatusBadge status={c.status as ClaimStatus} />
                      </p>
                    </div>
                    <span className="text-xs text-amber-800">
                      {!c.payout_method && (
                        <Link href="/me#claims" className="underline">
                          Add bank or PayPal details
                        </Link>
                      )}
                      {!c.payout_method && c.status === "not_submitted" && " · "}
                      {c.status === "not_submitted" && "Hand the paper receipt to Finance"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <CycleTimelineCard viewerId={viewer.id} now={now} />
        {forms
          .filter((f) => f.submittedAt)
          .map((f) => (
            <Alert key={f.id} tone="success" data-testid="home-volunteer">
              Volunteer form for <strong>{cycleLabel(f.month)}</strong>: submitted ✓ – you signed up for {plural(f.events, "event")}.{" "}
              <Link href="/volunteer" className="font-medium underline">
                See your answers
              </Link>
            </Alert>
          ))}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>My events</CardTitle>
              <Link href="/me" className="text-sm text-esn hover:underline">
                All my events →
              </Link>
            </CardHeader>
            <CardContent>
              {!myEvents.length && (
                <EmptyState>{openForms.length ? "Nothing planned yet – fill in the volunteer form, or claim an open slot." : "Nothing planned. Volunteer when the next form opens, or claim an open slot."}</EmptyState>
              )}
              <ul className="space-y-3" data-testid="home-my-events">
                {myEvents.map(({ event, role, step, live }) => (
                  <li key={event.id} className={cn("flex gap-3 rounded-lg border p-3", live ? "border-esn-orange/60 ring-1 ring-esn-orange/40" : "border-gray-200")}>
                    <DateTile iso={event.starts_at} live={live} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/events/${event.id}?from=home`} className="font-medium text-gray-900 hover:text-esn break-words">
                          {event.title}
                        </Link>
                        <Badge tone="blue">{role === "oc" ? "OC" : "Helper"}</Badge>
                        {live && (
                          <Badge tone="amber" data-testid="happening-now">
                            ● Happening now
                          </Badge>
                        )}
                        {event.status !== "confirmed" && <EventStatusBadge status={event.status} />}
                        <span className="ml-auto text-xs tabular-nums text-gray-500">{berlinTime(event.starts_at)}</span>
                      </div>
                      {live && (
                        <Link href={`/events/${event.id}/attendance?from=home`} className={cn(buttonVariants({ size: "sm" }), "h-auto w-full whitespace-normal py-1.5 sm:w-auto")}>
                          Happening now – open attendance (QR code)
                        </Link>
                      )}
                      <Link
                        href={`/events/${event.id}${step.tab ? `/${step.tab}` : ""}?from=home`}
                        className={cn("flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-sm hover:underline", STEP_TONE[step.kind])}
                        data-testid="next-step"
                      >
                        <StepIcon kind={step.kind === "done" ? "done" : step.kind} />
                        <span className="font-medium">{step.label}</span>
                        {step.due && <DueLabel iso={step.due} now={now} note={step.dueNote} className="text-xs" />}
                      </Link>
                      {/* A helper's way in before the event (usability review #9): when, where, the Chat space. */}
                      {role === "helper" && step.anchor === "chat-space" && (
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600" data-testid="helper-info">
                          <span>
                            Starts {berlinTime(event.starts_at)}
                            {event.location && ` · ${event.location}`}
                          </span>
                          {/* Where to be first, when it is not the location (round 2026-11-02). */}
                          {eventMeeting(event) && <span data-testid="helper-meeting">{meetingShort(eventMeeting(event))}</span>}
                          {event.chat_space_url ? (
                            <a href={event.chat_space_url} target="_blank" rel="noopener noreferrer" className="font-medium text-esn hover:underline">
                              Open the Chat space ↗
                            </a>
                          ) : (
                            <span>{event.chat_space_requested_at ? "The Chat space is being created." : "The Chat space is created when the month's roster is confirmed."}</span>
                          )}
                        </p>
                      )}
                    </div>
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
                        <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">{formatShortDate(e.starts_at)}</span>
                        <Link href={`/events/${e.id}?from=home`} className="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-esn">
                          {e.title}
                        </Link>
                        <Badge tone="amber">{s.open_oc ? "OC needed" : plural(s.open_helpers, "helper slot")}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>

            <ComingUpCard viewerId={viewer.id} now={now} />
          </div>
        </div>

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

/** An event's day as a small calendar leaf ("Nov / 3 / Tue"). */
function DateTile({ iso, live }: { iso: string; live: boolean }) {
  const [weekday, day, month] = formatShortDate(iso).split(" ");
  return (
    <div
      className={cn("flex w-12 shrink-0 flex-col items-center self-start rounded-lg py-1.5 leading-tight", live ? "bg-esn-orange/10 text-esn-orange" : "bg-esn/5 text-esn-dark")}
      aria-hidden="true"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{month}</span>
      <span className="text-lg font-bold tabular-nums">{day}</span>
      <span className="text-[10px] text-gray-500">{weekday}</span>
    </div>
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
  const [{ data: cycles }, { data: slots }, days] = await Promise.all([
    supabase.from("planning_cycles").select("id, month, status, form_closes_at, description_deadline").order("month"),
    supabase.rpc("open_slots"),
    loadTimelineDays(supabase),
  ]);
  // Done cycles drop out (review 2026-10-29 A4); only last month to two months ahead are listed, the rest behind "more" (usability review #11).
  const progress = (await cyclesWithProgress(supabase, cycles ?? [])).filter((c) => !c.progress.done);
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const near = progress.filter((c) => c.month >= addMonths(thisMonth, -1) && c.month <= addMonths(thisMonth, 2));
  const more = progress.length - near.length;
  // The month the timeline plans now needs a cycle (round 2026-11-02).
  const upcoming = upcomingCycleMonth(now, days);
  const missing = !(cycles ?? []).some((c) => c.month === upcoming);
  return (
    <QueueCard title="Events team" href="/team/events" testId="queue-events">
      {missing && (
        <Link href="/team/events?new=1" className={cn("block text-xs font-medium hover:underline", Date.parse(cycleTimeline(upcoming, days).formOpens) < now ? "text-red-700" : "text-amber-800")}>
          No cycle for {cycleLabel(upcoming)} yet – plan it →
        </Link>
      )}
      {!near.length && !missing && <p className="text-gray-500">No cycle running – start the next month.</p>}
      <ul className="space-y-1.5">
        {near.map((c) => (
          <li key={c.id}>
            <Link href={`/team/events?month=${monthParam(c.month)}`} className={cn("font-medium hover:underline", c.progress.late ? "text-red-700" : "text-esn")}>
              {cycleLabel(c.month)}
            </Link>
            <span className="block text-xs text-gray-600">{c.progress.current ? `${c.progress.steps.find((s) => s.state === "current")!.label}: ${c.progress.action}` : c.progress.summary}</span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <Link href="/team/events" className="block text-xs text-esn hover:underline">
          {plural(more, "more month")} on the Events page →
        </Link>
      )}
      <Figure label="Upcoming events short of people" value={(slots ?? []).length} tone="amber" />
    </QueueCard>
  );
}

async function CommsQueue() {
  const supabase = await createSessionClient();
  const now = nowMs();
  const [{ data }, { data: posts }, toPlan] = await Promise.all([
    supabase.rpc("description_overview"),
    // The publishing schedule (brief 2026-10-29, E3): planned posts until a week ahead.
    supabase.from("publication_posts").select("scheduled_for").eq("status", "planned").lte("scheduled_for", new Date(now + 7 * 86_400_000).toISOString()),
    // Upcoming events of any month not on every channel yet (round 2026-11-02).
    loadStillToPlan(supabase, now),
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
      <Figure label="Upcoming events still to plan" value={toPlan.length} tone="amber" href="/team/comms/schedule" />
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
      <Figure label="Paper receipts to receive" value={(claims ?? []).filter((c) => c.status === "not_submitted").length} tone="amber" />
      <Figure label="Claims to check" value={(claims ?? []).filter((c) => c.status === "beleg_received").length} />
      <Figure label="Batches to pay" value={toPay.size} />
    </QueueCard>
  );
}
