import type { Metadata } from "next";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinDate, cycleLabel, monthOf, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { monthParam, parseMonthParam, pickMonth } from "@/lib/month";
import { postWarnings, type PostEventFacts } from "@/lib/publishing";
import { coerceFields } from "@/lib/description/template";
import { Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { MonthSelector } from "@/components/MonthSelector";
import { CommsTabs } from "@/components/CommsTabs";
import { bundleMessage, bundlePrice, eventMessage, plainText } from "@/lib/telegram/messages";
import { ScheduleBoard, type BoardChannel, type BoardPost, type Coverage } from "./ScheduleBoard";

export const metadata: Metadata = { title: "Publishing schedule" };

const daysOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
};

// The publishing schedule (brief 2026-10-29, E3): a month board with a lane
// per channel, the month's events in a tray; Comms plans, bundles, moves
// and publishes; Events and executives look on.
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const viewer = await requirePageRole(["comms", "events"], { executiveMayRead: true, page: "Publishing schedule" });
  const editable = hasRole(viewer.roles, "comms");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const thisMonth = monthOf(new Date(now).toISOString());
  const from = addMonths(thisMonth, -3);

  const [{ data: overview }, { data: channelRows }, { data: postRows }] = await Promise.all([
    supabase.rpc("description_overview"),
    supabase.from("publication_channels").select("key, name, kind, schedulable, enabled, required").order("position"),
    supabase
      .from("publication_posts")
      .select("id, channel, scheduled_for, status, link, picture, note, skip_reason, last_error, published_at, confirmed_at, publication_post_events(event_id, position)")
      .gte("scheduled_for", new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString())
      .order("scheduled_for"),
  ]);
  const rows = (overview ?? []).filter((r) => monthOf(r.starts_at) >= from);
  const posts = postRows ?? [];
  const months = [...new Set([...rows.map((r) => monthOf(r.starts_at)), ...posts.map((p) => monthOf(p.scheduled_for))])].sort();
  // Work: events still ahead that are on no schedulable channel yet, or posts waiting.
  const planned = new Set(posts.filter((p) => p.status !== "skipped").flatMap((p) => p.publication_post_events.map((x) => x.event_id)));
  const hasWork = (m: string) =>
    rows.some((r) => monthOf(r.starts_at) === m && Date.parse(r.starts_at) > now && !planned.has(r.event_id)) ||
    posts.some((p) => monthOf(p.scheduled_for) === m && p.status === "planned");
  const month = pickMonth(months.map((m) => ({ month: m, hasWork: hasWork(m) })), parseMonthParam(sp.month), thisMonth) ?? thisMonth;

  const channels: BoardChannel[] = (channelRows ?? []).filter((c) => c.enabled && c.schedulable).map((c) => ({ key: c.key, name: c.name, kind: c.kind as BoardChannel["kind"], required: c.required }));
  const monthPosts = posts.filter((p) => monthOf(p.scheduled_for) === month);
  const monthEvents = rows.filter((r) => monthOf(r.starts_at) === month);
  // Events on a post of this month that take place in another month are shown too.
  const ids = [...new Set([...monthEvents.map((r) => r.event_id), ...monthPosts.flatMap((p) => p.publication_post_events.map((x) => x.event_id))])];
  const [{ data: eventRows }, { data: descriptions }] = ids.length
    ? await Promise.all([
        supabase.from("events").select("id, title, starts_at").in("id", ids),
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
      return [e.id, { id: e.id, title: e.title, startsAt: e.starts_at, description: d?.status ?? "missing", price: coerceFields(d?.approved_fields ?? d?.fields ?? {}).price }];
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
      warnings: postWarnings({ channel: p.channel, scheduledFor: p.scheduled_for, status: p.status }, evs.map((id) => facts.get(id)!).filter(Boolean), counts.get(p.channel) ?? new Map()),
      preview: p.channel === "telegram" && evs.length ? telegramPreview(evs, p.note) : null,
    };
  });
  const boardEvents = monthEvents
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((r) => ({ id: r.event_id, title: r.title, startsAt: r.starts_at, description: r.status }))
    .concat(
      ids
        .filter((id) => !monthEvents.some((r) => r.event_id === id))
        .map((id) => facts.get(id))
        .filter((f): f is PostEventFacts => !!f)
        .map((f) => ({ id: f.id, title: f.title, startsAt: f.startsAt, description: f.description }))
    );

  return (
    <>
      <PageHeader title="Comms" description="Every event goes out on Telegram, Instagram and pretix: plan the posts around the event's date, bundle them, publish. Telegram posts go out by themselves once confirmed.">
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
        <Card>
          <CardContent className="pt-5">
            <ScheduleBoard
              days={daysOf(month)}
              channels={channels}
              events={boardEvents}
              posts={boardPosts}
              editable={editable}
              viewer={{ email: viewer.email, name: viewer.name }}
              today={berlinDate(new Date(now).toISOString())}
              coverage={coverage}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
