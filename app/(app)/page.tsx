import type { Metadata } from "next";
import Link from "next/link";
import { createSessionClient, getViewer } from "@/lib/supabase/session";
import { addMonths, cycleLabel, formatCents, formatDateTime, formatShortDate, monthOf, nowMs } from "@/lib/dates";
import { monthParam } from "@/lib/month";
import { volunteerForms } from "@/lib/eventStatus";
import { cyclesWithProgress } from "@/lib/cycleFacts";
import { hasRole } from "@/lib/roles";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { DueLabel } from "@/components/status";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/plural";
import { StepIcon } from "@/components/StepIcon";
import { OrientationCard } from "@/components/Orientation";
import { MyDutyRow, MyEventRow, dutyHref, stepHref } from "@/components/MyEventCard";
import { ComingUpCard } from "@/components/ComingUpCard";
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
/** Open slots named on Home; the rest are on the Calendar. */
const OPEN_SLOTS = 3;

// "What's next for me" (round 2026-11-03 (2)): one "Waiting for you" with
// everything that needs the member – an event happening now, a next step
// overdue or due within a week, an open volunteer form, payout details,
// paper receipts, open slots to claim, a duty at an office hour on now or its
// cash box to sign off – then two panels, the member's next events and
// duties and what comes up in MESA, and the team queues for team members.
// Everything about the member's own events is on My events; the cycle dates
// are on the Calendar.
export default async function HomePage() {
  const viewer = (await getViewer())!;
  const supabase = await createSessionClient();
  const now = nowMs();
  const isEvents = hasRole(viewer.roles, "events");
  const isComms = hasRole(viewer.roles, "comms");
  const isFinance = hasRole(viewer.roles, "finance");
  const isExec = viewer.roles.includes("executive");

  const [forms, events, duties, { data: slots }, { data: claims }, { count: everAssigned }, { data: payout }] = await Promise.all([
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
  ]);

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
  // The next events and duties not already under Waiting for you.
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

  const openForms = forms.filter((f) => !f.submittedAt);
  // Saved profile details reach every open claim; without them Finance cannot pay.
  const noPayout = payout ? 0 : (claims ?? []).filter((c) => !c.payout_method).length;
  // Paper receipts not handed in, unless their event's step already says so.
  const receipts = (claims ?? []).filter((c) => c.status === "not_submitted" && !neededIds.has(c.event_id));
  // Open slots are one offer at the end of the list.
  const waiting = needed.length + neededDuties.length + openForms.length + (noPayout ? 1 : 0) + receipts.length + (claimable.length ? 1 : 0);

  return (
    <>
      <PageHeader title={`Hi ${viewer.name.split(" ")[0]}`} description={formatDateTime(new Date(now).toISOString()).slice(0, -7)} />
      <div className="space-y-6">
        {!everAssigned && <OrientationCard hasPayout={!!payout} />}

        {waiting > 0 ? (
          <section aria-labelledby="needs-you" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-testid="home-needs-you">
            <h2 id="needs-you" className="mb-2 text-sm font-semibold text-amber-900">
              Waiting for you · {waiting}
            </h2>
            <ul className="space-y-2">
              {needed.map(({ event, step, live }) => (
                <NeedItem
                  key={event.id}
                  icon={live ? <span className="text-esn-orange">●</span> : <StepIcon kind={step.kind} />}
                  title={
                    <Link href={stepHref(event.id, step, "home")} className="hover:underline" data-testid="next-step">
                      {live ? `${event.title} – happening now` : step.label}
                    </Link>
                  }
                  detail={
                    <>
                      {live ? step.label : `${event.title} · ${formatShortDate(event.starts_at)}`}
                      {!live && step.due && (
                        <>
                          {" · "}
                          <DueLabel iso={step.due} now={now} note={step.dueNote} />
                        </>
                      )}
                    </>
                  }
                  testId="home-step"
                >
                  {live && (
                    <Link href={`/events/${event.id}/attendance?from=home`} className={buttonVariants({ size: "sm" })} data-testid="happening-now">
                      Open attendance (QR code)
                    </Link>
                  )}
                </NeedItem>
              ))}
              {neededDuties.map((d) => (
                <NeedItem
                  key={d.key}
                  icon={d.live ? <span className="text-esn-orange">●</span> : <StepIcon kind={d.step.kind} />}
                  title={
                    <Link href={dutyHref(d)} className="hover:underline" data-testid="duty-step">
                      {d.live ? `${d.duty.title} – on duty now` : d.step.label}
                    </Link>
                  }
                  detail={d.live ? d.step.label : `${d.duty.title} · ${formatShortDate(d.duty.starts_at)}`}
                  testId="home-duty"
                >
                  {d.live && d.step.cash && (
                    <Link href={dutyHref(d)} className={buttonVariants({ size: "sm" })}>
                      Open the cash box
                    </Link>
                  )}
                </NeedItem>
              ))}
              {openForms.map((f) => (
                <NeedItem
                  key={f.id}
                  icon="🙋"
                  title={`The volunteer form for ${cycleLabel(f.month)} is open`}
                  detail={<>{f.form_closes_at ? <DueLabel iso={f.form_closes_at} now={now} /> : "Open now"} · say which events you can OC or help with</>}
                  testId="home-volunteer"
                >
                  <Link href="/volunteer" className={buttonVariants({ size: "sm" })}>
                    Fill in the form
                  </Link>
                </NeedItem>
              ))}
              {noPayout > 0 && (
                <NeedItem icon="🏦" title="Add your IBAN or PayPal" detail={`Finance cannot pay ${plural(noPayout, "claim")} until you do.`} testId="home-claims">
                  <Link href="/me/reimbursements#payout" className={buttonVariants({ size: "sm", variant: "outline" })}>
                    Add payout details
                  </Link>
                </NeedItem>
              )}
              {receipts.map((c) => {
                const e = c.events as { id: string; title: string } | null;
                const r = c.receipts as { vendor: string; amount_cents: number } | null;
                return (
                  <NeedItem
                    key={c.id}
                    icon="🧾"
                    title={
                      <Link href={`/events/${c.event_id}/hand-in?from=home#your-receipts`} className="hover:underline">
                        Hand the paper receipt to Finance
                      </Link>
                    }
                    detail={`${r?.vendor} · ${formatCents(r?.amount_cents)}${e ? ` · ${e.title}` : ""}`}
                    testId="home-claims"
                  />
                );
              })}
              {claimable.length > 0 && (
                <NeedItem
                  icon="🤝"
                  title={claimable.length === 1 ? `${slotEvents?.[0]?.title ?? "An event"} needs ${claimable[0].open_oc ? "an OC" : "a helper"}` : `${claimable.length} events need people`}
                  detail={
                    <>
                      Claim an open slot:{" "}
                      {(slotEvents ?? []).slice(0, OPEN_SLOTS).map((e, i) => (
                        <span key={e.id}>
                          {i > 0 && ", "}
                          <Link href={`/events/${e.id}?from=home`} className="font-medium text-esn hover:underline">
                            {e.title}
                          </Link>{" "}
                          ({formatShortDate(e.starts_at)})
                        </span>
                      ))}
                      {claimable.length > OPEN_SLOTS && ` and ${claimable.length - OPEN_SLOTS} more on the Calendar`}
                    </>
                  }
                  testId="home-open-slots"
                />
              )}
            </ul>
          </section>
        ) : (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm font-medium text-emerald-800" data-testid="home-needs-you">
            Nothing waiting for you ✓
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>My events</CardTitle>
              <Link href="/me" className="text-sm text-esn hover:underline">
                All my events →
              </Link>
            </CardHeader>
            <CardContent>
              {!nextUp.length && <EmptyState>{needed.length || neededDuties.length ? "Nothing else coming up." : "Nothing planned. Volunteer when the next form opens, or claim an open slot."}</EmptyState>}
              <ul className="divide-y divide-gray-100" data-testid="home-my-events">
                {nextUp.slice(0, NEXT_UP).map((x) => (x.type === "event" ? <MyEventRow key={x.key} item={x.item} now={now} /> : <MyDutyRow key={x.key} item={x.item} />))}
              </ul>
              {nextUp.length > NEXT_UP && (
                <Link href="/me" className="mt-2 block text-sm text-esn hover:underline">
                  {plural(nextUp.length - NEXT_UP, "more event")} on My events →
                </Link>
              )}
            </CardContent>
          </Card>
          <ComingUpCard viewerId={viewer.id} now={now} />
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

/** One row of "Waiting for you": an icon, what to do, its detail, an optional button. */
function NeedItem({ icon, title, detail, testId, children }: { icon: React.ReactNode; title: React.ReactNode; detail: React.ReactNode; testId: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm" data-testid={testId}>
      <span className="flex w-5 justify-center text-lg" aria-hidden>
        {icon}
      </span>
      <div className="mr-auto min-w-0">
        <p className="font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-600">{detail}</p>
      </div>
      {children}
    </li>
  );
}

/** A team's card; `clear` when nothing in it waits (figures at zero are hidden). */
function QueueCard({ title, href, testId, clear, children }: { title: string; href: string; testId: string; clear?: boolean; children: React.ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Link href={href} className="text-sm text-esn hover:underline">
          Open →
        </Link>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        {clear && <p className="text-emerald-700">All clear ✓</p>}
        {children}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, tone, href }: { label: string; value: number; tone?: "amber" | "red" | "blue"; href?: string }) {
  if (!value) return null;
  return (
    <p className="flex items-center gap-2">
      {href ? (
        <Link href={href} className="text-esn hover:underline">
          {label}
        </Link>
      ) : (
        <span className="text-gray-600">{label}</span>
      )}
      <Badge tone={tone ?? "blue"} className="ml-auto tabular-nums">
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
            <Link href={`/team/events/cycles/${c.id}`} className={cn("font-medium hover:underline", c.progress.late ? "text-red-700" : "text-esn")}>
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
    <QueueCard title="Comms" href={link([...review, ...late].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), "needs") ?? "/team/comms"} testId="queue-comms" clear={clear}>
      <Figure label="Awaiting review" value={review.length} href={link(review, "review")} />
      <Figure label="Late" value={late.length} tone="red" href={link(late, "write")} />
      {/* Approved descriptions go to the Chat space by themselves; then pretix, then the advertising (round 2026-11-03). */}
      <Figure label="pretix pages to set up" value={work.pretix.length} tone="amber" href="/team/comms/schedule" />
      <Figure label="Upcoming events still to advertise" value={work.toPlan.length} tone="amber" href="/team/comms/schedule" />
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
  const receive = (claims ?? []).filter((c) => c.status === "not_submitted").length;
  const check = (claims ?? []).filter((c) => c.status === "beleg_received").length;
  return (
    <QueueCard title="Finance" href="/team/finance" testId="queue-finance" clear={!receive && !check && !toPay.size}>
      <Figure label="Paper receipts to receive" value={receive} tone="amber" />
      <Figure label="Claims to check" value={check} />
      <Figure label="Batches to pay" value={toPay.size} />
    </QueueCard>
  );
}
