import type { Metadata } from "next";
import Link from "next/link";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import {
  CalendarClock,
  CalendarDays,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  FileText,
  Hand,
  Landmark,
  Lightbulb,
  MessagesSquare,
  Receipt,
  TriangleAlert,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, cycleLabel, formatCents, formatShortDate, monthOf, monthStartIso, nextMonthStartIso, nowMs } from "@/lib/dates";
import { TIME_ZONE } from "@/lib/env";
import { monthParam } from "@/lib/month";
import { volunteerForms } from "@/lib/eventStatus";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { hasRole, isInternalPlanner, roleGroups, APP_ROLES } from "@/lib/roles";
import { STAFFED_KINDS, internalStaffing } from "@/lib/internal";
import { peopleOf } from "@/lib/internalEvents";
import { loadEsn } from "@/lib/esn/load";
import type { NextStep } from "@/lib/checklist";
import { EmptyState } from "@/components/ui";
import { DueLabel } from "@/components/status";
import { cn } from "@/lib/utils";
import { isAre, plural } from "@/lib/plural";
import { OrientationCard } from "@/components/Orientation";
import { HomeDutyCard, HomeEventCard, dutyHref, stepHref } from "@/components/MyEventCard";
import { ComingUpCard } from "@/components/ComingUpCard";
import { LiveCard, SectionHeader, SlotCard, TodoRow } from "@/components/home";
import { byUrgency, eventGroup, needsYou } from "@/lib/myEvents";
import { itemTimed, loadMyDuties, loadMyEvents, myItems } from "@/lib/myEventsLoad";
import { dutyTimed } from "@/lib/myDuties";
import { cycleTimeline, upcomingCycleMonth } from "@/lib/timeline";
import { loadTimelineDays } from "@/lib/timelineLoad";
import { loadStillToPlan } from "@/lib/publishingLoad";

export const metadata: Metadata = { title: "Home" };

const DAY = 86_400_000;
/** Home lists this many of the member's next events; the rest are on My events. */
const NEXT_UP = 3;
/** Open slots shown on Home; the rest are on the Calendar. */
const OPEN_SLOTS = 3;

/** What a next step is about, as an icon. */
function stepIcon(step: Pick<NextStep, "tab" | "anchor">): LucideIcon {
  if (step.anchor === "register-receipt" || step.anchor === "your-receipts") return Receipt;
  if (step.tab === "description") return FileText;
  if (step.tab === "attendance") return ClipboardCheck;
  if (step.tab === "hand-in") return Upload;
  if (step.anchor === "chat-space") return MessagesSquare;
  if (step.anchor === "decide") return CircleHelp;
  return CalendarDays;
}

/** "One event is running right now, 3 things need you and 2 events are looking for people." */
function summary(live: number, todo: number, slots: number): string {
  const parts = [
    live && (live === 1 ? "one event is running right now" : `${live} events are running right now`),
    todo && `${plural(todo, "thing")} ${todo === 1 ? "needs" : "need"} you`,
    slots && `${plural(slots, "event")} ${isAre(slots)} looking for people`,
  ].filter(Boolean) as string[];
  if (!parts.length) return "Nothing is waiting for you.";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

// "What's next for me" (round 2026-11-03 (2)), laid out anew on 2026-11-04
// (design canvas "MESA Home Redesign"): an event happening now or a duty on
// now as its own card; To do with everything else that needs the member – a
// next step overdue or due within a week, an open volunteer form, ideas others
// asked the member to join, payout details, paper receipts, a cash box to sign
// off; Help wanted with the open slots (offers, not obligations); the member's
// next events; Coming up in MESA beside them; the team queues for team
// members in their own band below. Everything about the member's own events
// is on My events; the cycle dates are on the Calendar.
export default async function HomePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const isEvents = hasRole(viewer.roles, "events");
  const isComms = hasRole(viewer.roles, "comms");
  const isFinance = hasRole(viewer.roles, "finance");
  const isExec = viewer.roles.includes("executive");

  const [forms, events, duties, { data: slots }, { data: claims }, { count: everAssigned }, { data: payout }, { data: asked }] = await Promise.all([
    volunteerForms(viewer.id),
    loadMyEvents(supabase, viewer.id, now, { since: now - 45 * DAY }),
    loadMyDuties(supabase, viewer.id, now),
    supabase.rpc("open_slots"),
    supabase
      .from("reimbursements")
      .select("id, status, payout_method, event_id, events(id, title), receipts(vendor, amount_cents)")
      .eq("claimant_id", viewer.id)
      .in("status", ["not_submitted", "beleg_received", "checked"]),
    // A member who never had an event gets the orientation (usability review #14).
    supabase.from("assignments").select("id", { count: "exact", head: true }).eq("profile_id", viewer.id),
    supabase.from("profile_payout_details").select("profile_id").eq("profile_id", viewer.id).maybeSingle(),
    supabase.from("idea_partners").select("role, event_ideas(id, title, status, profiles:proposer_id(full_name))").eq("profile_id", viewer.id).eq("status", "invited"),
  ]);
  // Ideas still open (or accepted, before the roster) where someone named the member as partner.
  const partnerRequests = (asked ?? [])
    .map((a) => ({ role: a.role, idea: a.event_ideas as unknown as { id: string; title: string; status: string; profiles: { full_name: string } | null } | null }))
    .filter((r) => r.idea && ["proposed", "accepted"].includes(r.idea.status));

  const mine = events.filter((a) => a.event.status !== "dropped");
  const needed = byUrgency(
    mine.filter((a) => needsYou(a.event, a.step, now)),
    (a) => a.event,
    (a) => a.step,
    now
  );
  const neededIds = new Set(needed.map((a) => a.event.id));
  // Duties at office hours and Stammtisch: on duty now, or a cash box to sign off (round 2026-11-03 (2)).
  const neededDuties = duties.filter((d) => needsYou(dutyTimed(d.duty), d.step, now));
  const neededKeys = new Set(neededDuties.map((d) => d.key));
  // The next events and duties not already under Now or To do.
  const nextUp = myItems(
    mine.filter((a) => !neededIds.has(a.event.id)),
    duties.filter((d) => !neededKeys.has(d.key))
  )
    .filter((x) => eventGroup(itemTimed(x), now) !== "past")
    .sort((a, b) => itemTimed(a).starts_at.localeCompare(itemTimed(b).starts_at));

  const myIds = new Set(mine.map((a) => a.event.id));
  const claimable = (slots ?? []).filter((s) => !myIds.has(s.event_id));
  const { data: slotEvents } = claimable.length
    ? await supabase.from("events").select("id, title, starts_at").in("id", claimable.map((s) => s.event_id)).order("starts_at")
    : { data: [] };
  const slotOf = new Map(claimable.map((s) => [s.event_id, s]));

  const openForms = forms.filter((f) => !f.submittedAt);
  // Saved profile details reach every open claim; without them Finance cannot pay.
  const noPayout = payout ? 0 : (claims ?? []).filter((c) => !c.payout_method).length;
  // Paper receipts not handed in, unless their event's step already says so.
  const receipts = (claims ?? []).filter((c) => c.status === "not_submitted" && !neededIds.has(c.event_id));

  const liveEvents = needed.filter((a) => a.live);
  const liveDuties = neededDuties.filter((d) => d.live);
  const todoEvents = needed.filter((a) => !a.live);
  const todoDuties = neededDuties.filter((d) => !d.live);
  const todo = todoEvents.length + todoDuties.length + openForms.length + partnerRequests.length + (noPayout ? 1 : 0) + receipts.length;
  const live = liveEvents.length + liveDuties.length;
  const isPlanner = isInternalPlanner(viewer.roles);
  const isAdmin = hasRole(viewer.roles, "admin");
  const hasTeam = isEvents || isComms || isFinance || isExec || isPlanner || isAdmin;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">{format(new TZDate(now, TIME_ZONE), "EEEE, d MMMM")}</p>
        <h1 className="mt-0.5 text-3xl font-extrabold tracking-tight text-gray-900">Hi {viewer.name.split(" ")[0]}</h1>
        <p className="mt-1 text-gray-700" data-testid="home-summary">
          {summary(live, todo, claimable.length)}
        </p>
      </div>

      {!everAssigned && <OrientationCard hasPayout={!!payout} />}

      {liveEvents.map(({ event, step }) => (
        <LiveCard
          key={event.id}
          testId="home-step"
          label="Happening now"
          title={event.title}
          titleHref={stepHref(event.id, step, "home")}
          titleTestId="next-step"
          stepLabel={step.label}
          primary={{ href: `/events/${event.id}/attendance?from=home`, label: "Open attendance (QR code)", testId: "happening-now" }}
          secondary={{ href: `/events/${event.id}?from=home`, label: "Event page" }}
        />
      ))}
      {liveDuties.map((d) => (
        <LiveCard
          key={d.key}
          testId="home-duty"
          label="On duty now"
          title={d.duty.title}
          titleHref={dutyHref(d)}
          titleTestId="duty-step"
          stepLabel={d.step.label}
          primary={d.step.cash ? { href: dutyHref(d), label: "Open the cash box" } : undefined}
        />
      ))}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {todo > 0 ? (
            <section aria-labelledby="todo-title" className="overflow-hidden rounded-2xl border border-gray-200 bg-white" data-testid="home-needs-you">
              <div className="px-4 pb-2 pt-4 sm:px-5">
                <SectionHeader id="todo-title" title="To do" count={todo} note="Most urgent first" />
              </div>
              <ul className="border-t border-gray-100">
                {todoEvents.map(({ event, step }) => (
                  <TodoRow
                    key={event.id}
                    testId="home-step"
                    linkTestId="next-step"
                    href={stepHref(event.id, step, "home")}
                    icon={stepIcon(step)}
                    title={step.label}
                    detail={
                      <>
                        {event.title} · {formatShortDate(event.starts_at)}
                        {step.due && (
                          <>
                            {" · "}
                            <DueLabel iso={step.due} now={now} note={step.dueNote} />
                          </>
                        )}
                      </>
                    }
                    due={step.due}
                    now={now}
                  />
                ))}
                {todoDuties.map((d) => (
                  <TodoRow
                    key={d.key}
                    testId="home-duty"
                    linkTestId="duty-step"
                    href={dutyHref(d)}
                    icon={d.step.cash ? Wallet : CalendarClock}
                    title={d.step.label}
                    detail={`${d.duty.title} · ${formatShortDate(d.duty.starts_at)}`}
                    now={now}
                  />
                ))}
                {openForms.map((f) => (
                  <TodoRow
                    key={f.id}
                    testId="home-volunteer"
                    href="/volunteer"
                    icon={Hand}
                    title={`The volunteer form for ${cycleLabel(f.month)} is open`}
                    detail={<>{f.form_closes_at ? <DueLabel iso={f.form_closes_at} now={now} /> : "Open now"} · say which events you can OC or help with</>}
                    due={f.form_closes_at}
                    now={now}
                    cta="Fill in the form"
                  />
                ))}
                {partnerRequests.map(({ role, idea }) => (
                  <TodoRow
                    key={idea!.id}
                    testId="home-partner-request"
                    href="/ideas"
                    icon={Lightbulb}
                    title={`${idea!.profiles?.full_name ?? "Someone"} asks you to run ${idea!.title} with them`}
                    detail={`As ${role === "oc" ? "co-OC" : "helper"} – say yes or no on the Ideas page`}
                    now={now}
                    cta="Answer"
                  />
                ))}
                {noPayout > 0 && (
                  <TodoRow
                    testId="home-claims"
                    href="/me/reimbursements#payout"
                    icon={Landmark}
                    title="Add your IBAN or PayPal"
                    detail={`Finance cannot pay ${plural(noPayout, "claim")} until you do.`}
                    now={now}
                    cta="Add payout details"
                  />
                )}
                {receipts.map((c) => {
                  const e = c.events as { id: string; title: string } | null;
                  const r = c.receipts as { vendor: string; amount_cents: number } | null;
                  return (
                    <TodoRow
                      key={c.id}
                      testId="home-claims"
                      href={`/events/${c.event_id}/hand-in?from=home#your-receipts`}
                      icon={Receipt}
                      title="Hand the paper receipt to Finance"
                      detail={`${r?.vendor} · ${formatCents(r?.amount_cents)}${e ? ` · ${e.title}` : ""}`}
                      now={now}
                    />
                  );
                })}
              </ul>
            </section>
          ) : (
            <section className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 sm:px-5" data-testid="home-needs-you">
              <CircleCheck className="h-5 w-5" aria-hidden="true" />
              {live ? "Nothing else waiting for you" : "Nothing waiting for you"}
            </section>
          )}

          {claimable.length > 0 && (
            <section aria-labelledby="help-title" className="space-y-3" data-testid="home-open-slots">
              <SectionHeader
                id="help-title"
                title="Help wanted"
                note="Claim an open slot"
                link={{ href: "/calendar", label: claimable.length > OPEN_SLOTS ? `${plural(claimable.length - OPEN_SLOTS, "more")} on the Calendar →` : "Calendar →" }}
              />
              <ul className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3">
                {(slotEvents ?? []).slice(0, OPEN_SLOTS).map((e) => {
                  const s = slotOf.get(e.id);
                  return <SlotCard key={e.id} id={e.id} title={e.title} startsAt={e.starts_at} need={s?.open_oc ? "Needs an OC" : `Needs ${plural(s?.open_helpers || 1, "helper")}`} />;
                })}
              </ul>
            </section>
          )}

          <section aria-labelledby="mine-title" className="space-y-3">
            <SectionHeader id="mine-title" title="My events" link={{ href: "/me", label: "All my events →" }} />
            {!nextUp.length ? (
              <div className="rounded-2xl border border-gray-200 bg-white">
                <EmptyState>{needed.length || neededDuties.length ? "Nothing else coming up." : "Nothing planned. Volunteer when the next form opens, or claim an open slot."}</EmptyState>
              </div>
            ) : (
              <ul className="grid gap-3 md:grid-cols-3" data-testid="home-my-events">
                {nextUp.slice(0, NEXT_UP).map((x) => (x.type === "event" ? <HomeEventCard key={x.key} item={x.item} now={now} /> : <HomeDutyCard key={x.key} item={x.item} />))}
              </ul>
            )}
            {nextUp.length > NEXT_UP && (
              <Link href="/me" className="block text-sm font-semibold text-esn hover:underline">
                {plural(nextUp.length - NEXT_UP, "more event")} on My events →
              </Link>
            )}
          </section>
        </div>

        <aside className="min-w-0">
          <ComingUpCard viewerId={viewer.id} now={now} />
        </aside>
      </div>

      {hasTeam && (
        <section aria-labelledby="teams-title" className="space-y-3 pt-2">
          <SectionHeader id="teams-title" title="Your teams" note="What waits in the teams you're on" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(isEvents || isExec) && <EventsQueue />}
            {(isComms || isExec) && <CommsQueue />}
            {(isFinance || isExec) && <FinanceQueue />}
            {(isPlanner || isExec) && <InternalQueue />}
            {isExec && <EsnQueue />}
            {isAdmin && <AdminQueue />}
          </div>
        </section>
      )}
    </div>
  );
}

/** A team's card in the band; `clear` when nothing in it waits (figures at zero are hidden). */
function QueueCard({ title, dot, href, testId, clear, children }: { title: string; dot: string; href: string; testId: string; clear?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid={testId}>
      <div className="flex items-center gap-2.5">
        <span className={cn("h-2.5 w-2.5 rounded-[3px]", dot)} aria-hidden="true" />
        <h3 className="font-bold text-gray-900">{title}</h3>
        <Link href={href} className="ml-auto text-sm font-semibold text-esn hover:underline">
          Open →
        </Link>
      </div>
      {clear && (
        <p className="flex flex-1 flex-col items-center justify-center gap-1.5 py-3 text-sm font-semibold text-emerald-700">
          <CircleCheck className="h-7 w-7" aria-hidden="true" />
          All clear
        </p>
      )}
      {children}
    </div>
  );
}

const FIGURE_TONE = { blue: "text-esn", amber: "text-amber-700", red: "text-red-700" };

function Figure({ label, value, tone, href }: { label: string; value: number; tone?: keyof typeof FIGURE_TONE; href?: string }) {
  if (!value) return null;
  const body = (
    <>
      {label}
      <span className={cn("ml-auto pl-3 font-bold tabular-nums", FIGURE_TONE[tone ?? "blue"])}>{value}</span>
    </>
  );
  const row = "-mx-2 flex items-center rounded-md px-2 py-1 text-sm text-gray-700";
  return href ? (
    <Link href={href} className={cn(row, "hover:bg-gray-50")}>
      {body}
    </Link>
  ) : (
    <p className={row}>{body}</p>
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
  const late = Date.parse(cycleTimeline(upcoming, days).formOpens) < now;
  const short = (slots ?? []).length;
  return (
    <QueueCard title="Events team" dot="bg-esn" href="/team/events" testId="queue-events">
      {missing && (
        <Link
          href="/team/events?new=1"
          className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:underline", late ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")}
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          No cycle for {cycleLabel(upcoming)} yet – plan it
        </Link>
      )}
      {!near.length && !missing && <p className="text-sm text-gray-600">No cycle running – start the next month.</p>}
      {near.length > 0 && (
        <ul>
          {near.map((c) => (
            <li key={c.id}>
              <Link href={`/team/events/cycles/${c.id}`} className="-mx-2 block rounded-md px-2 py-1 hover:bg-gray-50">
                <span className={cn("block text-sm font-semibold", c.progress.late ? "text-red-700" : "text-gray-900")}>{cycleLabel(c.month)}</span>
                <span className="block text-[13px] text-gray-600">{c.progress.current ? `${c.progress.steps.find((s) => s.state === "current")!.label}: ${c.progress.action}` : c.progress.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <Link href="/team/events" className="text-sm font-semibold text-esn hover:underline">
          {plural(more, "more month")} on the Events page →
        </Link>
      )}
      {short > 0 && (
        <div className="mt-auto border-t border-gray-100 pt-2">
          <Figure label="Upcoming events short of people" value={short} tone="amber" />
        </div>
      )}
    </QueueCard>
  );
}

async function CommsQueue() {
  const supabase = await createSessionClient();
  const now = nowMs();
  const [{ data }, { data: posts }, work] = await Promise.all([
    supabase.rpc("description_overview"),
    // The advertisement schedule (brief 2026-10-29, E3): planned posts until a week ahead.
    supabase.from("publication_posts").select("scheduled_for").eq("status", "planned").lte("scheduled_for", new Date(now + 7 * 86_400_000).toISOString()),
    // Upcoming events not on every channel yet, or without their pretix page (round 2026-11-02, -03).
    loadStillToPlan(supabase, now),
  ]);
  const overdue = (posts ?? []).filter((p) => Date.parse(p.scheduled_for) < now).length;
  const thisWeek = (posts ?? []).length - overdue;
  // Only what can still be done: no missed events, Late only while the event is ahead (review 2026-10-29 A6).
  const rows = (data ?? []).filter((r) => !r.missed).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  // Each figure leads to the month of its first event, filtered to that stage (brief 2026-10-29, C).
  const link = (list: typeof rows, show: string) => (list.length ? `/team/comms?month=${monthParam(monthOf(list[0].starts_at))}&show=${show}` : undefined);
  const review = rows.filter((r) => r.status === "submitted");
  const late = rows.filter((r) => r.late);
  const clear = !review.length && !late.length && !work.pretix.length && !work.toPlan.length && !thisWeek && !overdue;
  return (
    <QueueCard title="Comms" dot="bg-esn-magenta" href={link([...review, ...late].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), "needs") ?? "/team/comms"} testId="queue-comms" clear={clear}>
      <Figure label="Awaiting review" value={review.length} href={link(review, "review")} />
      <Figure label="Late" value={late.length} tone="red" href={link(late, "write")} />
      {/* Approved descriptions go to the Chat space by themselves; then pretix, then the advertising (round 2026-11-03). */}
      <Figure label="pretix pages to set up" value={work.pretix.length} tone="amber" href="/team/comms/pretix" />
      <Figure label="Upcoming events still to advertise" value={work.toPlan.length} tone="amber" href="/team/comms/schedule" />
      <Figure label="Posts planned this week" value={thisWeek} href="/team/comms/schedule" />
      <Figure label="Overdue posts" value={overdue} tone="red" href="/team/comms/schedule" />
    </QueueCard>
  );
}

/**
 * HR and the Vice President (and the executives, who look): the next four
 * weeks' Stammtisch and office hours without an OC or short of helpers, and
 * next month with nothing planned yet.
 */
async function InternalQueue() {
  const supabase = await createSessionClient();
  const now = nowMs();
  const nextMonth = addMonths(monthOf(new Date(now).toISOString()), 1);
  const [{ data: soon }, { count: planned }] = await Promise.all([
    supabase
      .from("internal_events")
      .select("id, kind, helpers_needed")
      .eq("status", "scheduled")
      .in("kind", STAFFED_KINDS)
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 28 * DAY).toISOString()),
    supabase.from("internal_events").select("id", { count: "exact", head: true }).gte("starts_at", monthStartIso(nextMonth)).lt("starts_at", nextMonthStartIso(nextMonth)),
  ]);
  const people = await peopleOf(supabase, (soon ?? []).map((e) => e.id));
  const staffing = (soon ?? []).map((e) => {
    const list = people.get(e.id) ?? [];
    return internalStaffing(list.some((p) => p.role === "oc"), list.filter((p) => p.role === "helper").length, e.helpers_needed);
  });
  const noOc = staffing.filter((s) => s === "no_oc").length;
  const short = staffing.filter((s) => s === "short").length;
  const empty = !planned;
  return (
    <QueueCard title="Internal" dot="bg-esn-accent" href="/team/internal" testId="queue-internal" clear={!noOc && !short && !empty}>
      {empty && (
        <Link href={`/team/internal?view=month&month=${monthParam(nextMonth)}`} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:underline">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Nothing planned for {cycleLabel(nextMonth)} yet – plan it
        </Link>
      )}
      {(noOc > 0 || short > 0) && <p className="text-[13px] text-gray-600">Stammtisch and office hours in the next 4 weeks</p>}
      <Figure label="Without an OC" value={noOc} tone="red" href="/team/internal/roster?only=open" />
      <Figure label="Short of helpers" value={short} tone="amber" href="/team/internal/roster?only=open" />
    </QueueCard>
  );
}

/** The executive board: events of the last half year still to upload to activities.esn.org (as the ESN Activities page counts them). */
async function EsnQueue() {
  const supabase = await createSessionClient();
  const now = nowMs();
  const { data: happened } = await supabase
    .from("events")
    .select("id")
    .in("status", ["confirmed", "understaffed", "completed"])
    .eq("source", "platform")
    .gte("starts_at", monthStartIso(addMonths(monthOf(new Date(now).toISOString()), -6)))
    .lte("starts_at", new Date(now).toISOString());
  const esn = await loadEsn(supabase, (happened ?? []).map((e) => e.id));
  const states = [...esn.values()].map((x) => x.status.state);
  const ready = states.filter((s) => s === "ready").length;
  const notReady = states.filter((s) => s === "not_ready").length;
  return (
    <QueueCard title="ESN Activities" dot="bg-esn-orange" href="/team/esn-activities" testId="queue-esn" clear={!ready && !notReady}>
      <Figure label="Ready to upload" value={ready} href="/team/esn-activities" />
      <Figure label="Still missing details" value={notReady} tone="amber" href="/team/esn-activities" />
    </QueueCard>
  );
}

/** IT: background jobs that failed (retrying or given up) and role groups without an address. */
async function AdminQueue() {
  const supabase = await createSessionClient();
  const { data: jobs } = await supabase.from("jobs").select("status").in("status", ["failed", "dead"]);
  const dead = (jobs ?? []).filter((j) => j.status === "dead").length;
  const retrying = (jobs ?? []).length - dead;
  const groups = roleGroups();
  const unset = APP_ROLES.filter((r) => !groups[r]).length;
  return (
    <QueueCard title="Admin" dot="bg-gray-500" href="/admin" testId="queue-admin" clear={!dead && !retrying && !unset}>
      <Figure label="Jobs that gave up" value={dead} tone="red" href="/admin" />
      <Figure label="Jobs retrying" value={retrying} tone="amber" href="/admin" />
      <Figure label="Role groups not configured" value={unset} tone="amber" href="/admin" />
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
  const receive = (claims ?? []).filter((c) => c.status === "not_submitted").length;
  const check = (claims ?? []).filter((c) => c.status === "beleg_received").length;
  return (
    <QueueCard title="Finance" dot="bg-esn-green" href="/team/finance" testId="queue-finance" clear={!receive && !check && !toPay.size}>
      <Figure label="Paper receipts to receive" value={receive} tone="amber" />
      <Figure label="Claims to check" value={check} />
      <Figure label="Batches to pay" value={toPay.size} />
    </QueueCard>
  );
}
