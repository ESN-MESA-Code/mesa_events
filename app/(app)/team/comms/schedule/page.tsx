import type { Metadata } from "next";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinDate, cycleLabel, monthOf, monthStartIso, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { monthParam, parseMonthParam, pickMonth } from "@/lib/month";
import { PUBLISHABLE_STATUSES, listedAhead, postWarnings, telegramRefusal, type PostEventFacts } from "@/lib/publishing";
import { coerceFields } from "@/lib/description/template";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { CommsTabs } from "@/components/CommsTabs";
import { bundleMessage, bundlePrice, eventMessage, plainText } from "@/lib/telegram/messages";
import { ScheduleBoard, type BoardChannel, type BoardEvent, type BoardPost, type Coverage, type PretixChecklist } from "./ScheduleBoard";

export const metadata: Metadata = { title: "Publishing schedule" };

// The publishing schedule (brief 2026-10-29, E3; round 2026-10-31): the
// month's events listed on the left, the month as a calendar with the
// events on their dates and the posts on theirs; Comms plans, bundles,
// moves and publishes, and ticks pretix off per event. Events and
// executives look on. Round 2026-11-02: the month is the month the posts
// go out; the list also holds the upcoming events of later months (big
// ones first), so a party or trip weeks ahead is advertised from now on.
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string; event?: string }> }) {
  const viewer = await requirePageRole(["comms", "events"], { executiveMayRead: true, page: "Publishing schedule" });
  const editable = hasRole(viewer.roles, "comms");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const from = addMonths(thisMonth, -3);

  const [{ data: eventList }, { data: channelRows }, { data: postRows }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, starts_at, type, descriptions(status)")
      .in("status", [...PUBLISHABLE_STATUSES])
      .eq("source", "platform")
      .gte("starts_at", monthStartIso(from))
      .order("starts_at"),
    supabase.from("publication_channels").select("key, name, kind, schedulable, enabled, required").order("position"),
    supabase
      .from("publication_posts")
      .select("id, channel, scheduled_for, status, link, picture, note, skip_reason, last_error, published_at, confirmed_at, publication_post_events(event_id, position)")
      .gte("scheduled_for", new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString())
      .order("scheduled_for"),
  ]);
  const rows = (eventList ?? []).map((e) => ({ event_id: e.id, title: e.title, starts_at: e.starts_at, type: e.type, status: e.descriptions?.status ?? "missing" }));
  const posts = postRows ?? [];
  const months = [...new Set([...rows.map((r) => monthOf(r.starts_at)), ...posts.map((p) => monthOf(p.scheduled_for))])].sort();
  // Work: events still ahead that are on no schedulable channel yet, or posts waiting.
  // Events of later months are work of this month too: their posts can go out now.
  const planned = new Set(posts.filter((p) => p.status !== "skipped" && p.channel !== "pretix").flatMap((p) => p.publication_post_events.map((x) => x.event_id)));
  const hasWork = (m: string) =>
    rows.some((r) => Date.parse(r.starts_at) > now && !planned.has(r.event_id) && (monthOf(r.starts_at) === m || (m === thisMonth && listedAhead(monthOf(r.starts_at), m)))) ||
    posts.some((p) => monthOf(p.scheduled_for) === m && p.status === "planned");
  const month = pickMonth(months.map((m) => ({ month: m, hasWork: hasWork(m) })), parseMonthParam(sp.month), thisMonth) ?? thisMonth;

  const channels: BoardChannel[] = (channelRows ?? []).filter((c) => c.enabled && c.schedulable).map((c) => ({ key: c.key, name: c.name, kind: c.kind as BoardChannel["kind"], required: c.required }));
  const onBoard = new Set(channels.map((c) => c.key));
  const monthPosts = posts.filter((p) => monthOf(p.scheduled_for) === month && onBoard.has(p.channel));
  // pretix is a checklist (round 2026-10-31): ticked = a published pretix post of the event.
  const pretix: PretixChecklist = { enabled: (channelRows ?? []).some((c) => c.key === "pretix" && c.enabled), done: {} };
  for (const p of posts) if (p.channel === "pretix" && p.status === "published") for (const x of p.publication_post_events) pretix.done[x.event_id] ??= { link: p.link };
  const today = berlinDate(new Date(now).toISOString());
  // The month's events and – while the month is not over – the upcoming ones of the next months.
  const monthEvents = rows.filter((r) => monthOf(r.starts_at) === month || (month >= thisMonth && listedAhead(monthOf(r.starts_at), month) && berlinDate(r.starts_at) >= today));
  // Events on a post of this month that take place in another month are shown too.
  const ids = [...new Set([...monthEvents.map((r) => r.event_id), ...monthPosts.flatMap((p) => p.publication_post_events.map((x) => x.event_id))])];
  const [{ data: eventRows }, { data: descriptions }] = ids.length
    ? await Promise.all([
        supabase.from("events").select("id, title, starts_at, type, planning_cycles(description_deadline)").in("id", ids),
        supabase.from("descriptions").select("event_id, status, fields, approved_fields").in("event_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const desc = new Map((descriptions ?? []).map((d) => [d.event_id, d]));
  const fieldsOf = (id: string) => coerceFields(desc.get(id)?.approved_fields ?? desc.get(id)?.fields ?? {});
  const titleOf = (id: string) => (eventRows ?? []).find((e) => e.id === id)?.title ?? "";
  // The Telegram text Comms looks at before confirming (what the job posts; sign-up links are added then).
  const telegramPreview = (ids: string[], note: string) =>
    plainText(
      ids.length === 1
        ? eventMessage({ ...fieldsOf(ids[0]), title: fieldsOf(ids[0]).title || titleOf(ids[0]) }).html
        : bundleMessage(note, ids.map((id) => ({ title: fieldsOf(id).title || titleOf(id), startsAt: facts.get(id)?.startsAt ?? "", price: bundlePrice(fieldsOf(id)) }))).html
    );
  const facts = new Map<string, PostEventFacts>(
    (eventRows ?? []).map((e) => {
      const d = desc.get(e.id);
      return [
        e.id,
        { id: e.id, title: e.title, startsAt: e.starts_at, description: d?.status ?? "missing", price: coerceFields(d?.approved_fields ?? d?.fields ?? {}).price, deadline: e.planning_cycles?.description_deadline ?? null },
      ];
    })
  );
  const onChannel = (channel: string) => {
    const n = new Map<string, number>();
    for (const p of posts) if (p.channel === channel && p.status !== "skipped") for (const x of p.publication_post_events) n.set(x.event_id, (n.get(x.event_id) ?? 0) + 1);
    return n;
  };
  const counts = new Map(channels.map((c) => [c.key, onChannel(c.key)]));
  // Per event and channel, over all months: published, else the first planned post.
  const coverage: Coverage = {};
  for (const p of posts) {
    if (p.status === "skipped") continue;
    for (const x of p.publication_post_events) {
      const cur = (coverage[x.event_id] ??= {})[p.channel];
      if (!cur || (cur.status === "planned" && (p.status === "published" || p.scheduled_for < cur.at))) {
        coverage[x.event_id][p.channel] = { status: p.status as "planned" | "published", at: p.scheduled_for };
      }
    }
  }
  const boardPosts: BoardPost[] = monthPosts.map((p) => {
    const evs = [...p.publication_post_events].sort((a, b) => a.position - b.position).map((x) => x.event_id);
    return {
      id: p.id,
      channel: p.channel,
      scheduledFor: p.scheduled_for,
      status: p.status as BoardPost["status"],
      confirmed: !!p.confirmed_at,
      link: p.link,
      picture: p.picture,
      note: p.note,
      skipReason: p.skip_reason,
      lastError: p.last_error,
      publishedAt: p.published_at,
      events: evs,
      // Telegram: what the job would refuse – then there is nothing to confirm yet.
      refusal: p.channel === "telegram" && p.status === "planned" ? telegramRefusal(evs.map((id) => facts.get(id)!).filter(Boolean)) : null,
      warnings: postWarnings({ channel: p.channel, scheduledFor: p.scheduled_for, status: p.status }, evs.map((id) => facts.get(id)!).filter(Boolean), counts.get(p.channel) ?? new Map()),
      preview: p.channel === "telegram" && evs.length ? telegramPreview(evs, p.note) : null,
    };
  });
  const boardEvents = monthEvents
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((r): BoardEvent => ({ id: r.event_id, title: r.title, startsAt: r.starts_at, description: r.status, type: r.type }))
    .concat(
      ids
        .filter((id) => !monthEvents.some((r) => r.event_id === id))
        .map((id) => facts.get(id))
        .filter((f): f is PostEventFacts => !!f)
        .map((f) => ({ id: f.id, title: f.title, startsAt: f.startsAt, description: f.description, type: (eventRows ?? []).find((e) => e.id === f.id)?.type ?? null }))
    );
  // ?event=… (from the Comms page): that event is highlighted.
  const focusEvent = /^[0-9a-f-]{36}$/.test(sp.event ?? "") && boardEvents.some((e) => e.id === sp.event) ? sp.event! : null;

  return (
    <>
      <PageHeader title="Comms" description="Every event goes out on Telegram and Instagram: drag it from the list onto a day, bundle posts, publish – and tick pretix off once its page is up. The list also holds the events of later months, so big ones can be advertised weeks ahead. Telegram posts go out by themselves once confirmed.">
        <div className="flex flex-wrap items-center gap-3">
          <MonthSelector
            options={months.map((m) => ({ value: monthParam(m), label: cycleLabel(m), note: hasWork(m) ? "to plan" : undefined }))}
            current={monthParam(month)}
            path="/team/comms/schedule"
            storageKey="mesa:month:schedule"
            explicit={!!parseMonthParam(sp.month)}
          />
        </div>
      </PageHeader>
      <CommsTabs current="schedule" month={monthParam(month)} executive={viewer.roles.includes("executive")} />
      {!channels.length ? (
        <Card>
          <EmptyState>No channel is switched on for the schedule (Admin → Publishing channels).</EmptyState>
        </Card>
      ) : (
        <ScheduleBoard
          month={month}
          channels={channels}
          events={boardEvents}
          posts={boardPosts}
          editable={editable}
          viewer={{ email: viewer.email, name: viewer.name }}
          today={today}
          initialFocus={focusEvent}
          coverage={coverage}
          pretix={pretix}
        />
      )}
    </>
  );
}
