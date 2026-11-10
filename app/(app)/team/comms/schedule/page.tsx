import type { Metadata } from "next";
import { requirePageRole } from "@/lib/access";
import { createSessionClient } from "@/lib/supabase/session";
import { addMonths, berlinDate, monthOf, monthStartIso, nowMs } from "@/lib/dates";
import { hasRole } from "@/lib/roles";
import { addDays, dayDiff, monthParam, parseMonthParam } from "@/lib/month";
import { AHEAD_MONTHS, PUBLISHABLE_STATUSES, advertisable, isBigEvent, postWarnings, telegramRefusal, type PostEventFacts } from "@/lib/publishing";
import { coerceFields } from "@/lib/description/template";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CommsTabs } from "@/components/CommsTabs";
import { hasHeading, messagePictures, plainText, postMessages } from "@/lib/telegram/messages";
import { loadDefaultPictures } from "@/lib/publishingLoad";
import { ScheduleBoard } from "./ScheduleBoard";
import { BOARD_WEEKS, mondayOf, type BoardCategory, type BoardChannel, type BoardEvent, type BoardPost, type Coverage, type PreviewMessage, type PretixChecklist } from "./boardModel";

export const metadata: Metadata = { title: "Advertisement schedule" };

const isDay = (s: string | undefined): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const UUID = /^[0-9a-f-]{36}$/;

// The advertisement schedule (brief 2026-10-29, E3; one board since round
// 2026-11-09 (5)): a row per event, the days left to right – from this week
// on for eight weeks, ← → by four (?from=YYYY-MM-DD, a Monday; ?month=YYYY-MM
// still works and opens on that month). Each post a marker on its day, the
// event's day a 📅, a line from its first post to it. Comms plans, bundles,
// moves and publishes; Events and executives look on. ?event= focuses an
// event (the Comms page links so), ?post= opens a post (the content list).
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ from?: string; month?: string; event?: string; post?: string }> }) {
  const viewer = await requirePageRole(["comms", "events"], { executiveMayRead: true, page: "Advertisement schedule" });
  const editable = hasRole(viewer.roles, "comms");
  const sp = await searchParams;
  const supabase = await createSessionClient();
  const now = nowMs();
  const today = berlinDate(new Date(now).toISOString());
  const thisMonth = monthOf(new Date(now).toISOString());
  const thisWeek = mondayOf(today);
  const askedMonth = parseMonthParam(sp.month);
  // The window: ?from, else ?month (this week when it is this month), else this week.
  const explicitFrom = isDay(sp.from) ? mondayOf(sp.from) : null;
  let from = explicitFrom ?? (askedMonth && askedMonth !== thisMonth ? mondayOf(askedMonth) : thisWeek);
  // Loaded from three months back (the coverage marks look at every post), or earlier when the board looks there.
  const loadFrom = [addMonths(thisMonth, -3), addMonths(`${from.slice(0, 7)}-01`, -1)].sort()[0];

  const [{ data: eventList }, { data: channelRows }, { data: postRows }, { data: team }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, starts_at, type, big, status, category_id, descriptions(status)")
      .in("status", ["draft", ...PUBLISHABLE_STATUSES])
      .eq("source", "platform")
      .gte("starts_at", monthStartIso(loadFrom))
      .order("starts_at"),
    supabase.from("publication_channels").select("key, name, kind, schedulable, enabled, required").order("position"),
    supabase
      .from("publication_posts")
      .select(
        "id, channel, scheduled_for, status, link, picture, note, skip_reason, last_error, published_at, confirmed_at, title, format, assignees, progress, caption, design_link, publication_post_events(event_id, position, picture)"
      )
      .gte("scheduled_for", new Date(Date.parse(`${loadFrom}T00:00:00Z`) - 86_400_000).toISOString())
      .order("scheduled_for"),
    supabase.rpc("comms_team"),
  ]);
  // Drafts (their cycle still being planned) only once they are close enough to advertise (round 2026-11-09).
  const rows = (eventList ?? []).filter((e) => advertisable({ status: e.status, startsAt: e.starts_at }, now));
  const posts = postRows ?? [];
  const channels: BoardChannel[] = (channelRows ?? []).filter((c) => c.enabled && c.schedulable).map((c) => ({ key: c.key, name: c.name, kind: c.kind as BoardChannel["kind"], required: c.required }));
  const onBoard = new Set(channels.map((c) => c.key));

  // A post or an event asked for by the link is shown even when the window would miss it (unless ?from says where to look).
  const span = BOARD_WEEKS * 7;
  const fits = (d: string) => d >= from && dayDiff(from, d) < span;
  const askedPost = UUID.test(sp.post ?? "") ? posts.find((p) => p.id === sp.post) : undefined;
  const focusId = UUID.test(sp.event ?? "") ? sp.event! : null;
  if (!explicitFrom && askedPost && !fits(berlinDate(askedPost.scheduled_for))) from = mondayOf(addDays(berlinDate(askedPost.scheduled_for), -7));
  if (!explicitFrom && !askedPost && focusId) {
    const ev = (eventList ?? []).find((e) => e.id === focusId);
    const firstPost = posts.find((p) => p.channel !== "pretix" && p.status !== "skipped" && p.publication_post_events.some((x) => x.event_id === focusId));
    const evDay = ev ? berlinDate(ev.starts_at) : null;
    const start = [firstPost ? berlinDate(firstPost.scheduled_for) : null, evDay ? addDays(evDay, -21) : null].filter((d): d is string => !!d).sort()[0];
    if (evDay && start && !(fits(evDay) && fits(start))) {
      // From its first post (or three weeks before), as long as the event's day still fits.
      const want = mondayOf(start < today && evDay >= today ? today : start);
      from = dayDiff(want, evDay) < span ? want : mondayOf(addDays(evDay, -(span - 7)));
    }
  }
  const to = addDays(from, span - 1);
  const inWindow = (d: string) => d >= from && d <= to;

  // The rows: the events of the window, the big ones of the next months (the Events team's mark – advertised weeks ahead), the focused one,
  // and whatever the window's posts advertise.
  const aheadUntil = addMonths(`${from.slice(0, 7)}-01`, AHEAD_MONTHS);
  const windowPosts = posts.filter((p) => onBoard.has(p.channel) && inWindow(berlinDate(p.scheduled_for)));
  const listed = new Set([
    ...rows
      .filter((r) => {
        const d = berlinDate(r.starts_at);
        return inWindow(d) || (d > to && d >= today && isBigEvent(r) && monthOf(r.starts_at) <= aheadUntil) || r.id === focusId;
      })
      .map((r) => r.id),
    ...windowPosts.flatMap((p) => p.publication_post_events.map((x) => x.event_id)),
  ]);
  // The posts on the board: the window's, and every other one of a listed event (the event panel lists them).
  const boardRows = posts.filter((p) => onBoard.has(p.channel) && (inWindow(berlinDate(p.scheduled_for)) || p.publication_post_events.some((x) => listed.has(x.event_id))));
  const ids = [...new Set([...listed, ...boardRows.flatMap((p) => p.publication_post_events.map((x) => x.event_id))])];

  // pretix is a checklist (round 2026-10-31): ticked = a published pretix post of the event.
  const pretix: PretixChecklist = { enabled: (channelRows ?? []).some((c) => c.key === "pretix" && c.enabled), done: {} };
  for (const p of posts) if (p.channel === "pretix" && p.status === "published") for (const x of p.publication_post_events) pretix.done[x.event_id] ??= { link: p.link };
  const [{ data: eventRows }, { data: descriptions }] = ids.length
    ? await Promise.all([
        supabase.from("events").select("id, title, starts_at, type, big, status, format_id, category_id, planning_cycles(description_deadline)").in("id", ids),
        supabase.from("descriptions").select("event_id, status, fields, approved_fields").in("event_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const categoryIds = [...new Set((eventRows ?? []).map((e) => e.category_id).filter((c): c is string => !!c))];
  const { data: categoryRows } = categoryIds.length ? await supabase.from("event_categories").select("id, name, emoji").in("id", categoryIds).order("sort") : { data: [] };
  const desc = new Map((descriptions ?? []).map((d) => [d.event_id, d]));
  const fieldsOf = (id: string) => coerceFields(desc.get(id)?.approved_fields ?? desc.get(id)?.fields ?? {});
  const titleOf = (id: string) => (eventRows ?? []).find((e) => e.id === id)?.title ?? "";
  // The defaults of the Pictures tab (round 2026-11-03, -09): an event's format's, else its category's, else its type's.
  const defaults = await loadDefaultPictures(supabase, eventRows ?? []);
  // The Telegram messages Comms looks at before confirming – what the job posts, one per event, each with its picture (round 2026-11-03).
  const telegramPreview = (evs: Array<{ event_id: string; picture: string | null }>, note: string, postPicture: string | null): PreviewMessage[] => {
    const ids = evs.map((x) => x.event_id);
    const texts = postMessages(note, ids.map((id) => ({ fields: { ...fieldsOf(id), title: fieldsOf(id).title || titleOf(id) }, link: pretix.done[id]?.link ?? null })));
    const pictures = messagePictures(note, postPicture, evs.map((x) => ({ own: x.picture, fallback: defaults.get(x.event_id) ?? null })));
    const head = hasHeading(note, ids.length);
    return texts.map((t, i) => {
      const eventId = head ? (i === 0 ? null : ids[i - 1]) : ids[i];
      const own = eventId ? (evs.find((x) => x.event_id === eventId)?.picture ?? (!head && i === 0 ? postPicture : null)) : postPicture;
      return { text: plainText(t.html), eventId, picture: pictures[i], isDefault: !!pictures[i] && !own };
    });
  };
  const facts = new Map<string, PostEventFacts>(
    (eventRows ?? []).map((e) => {
      const d = desc.get(e.id);
      return [
        e.id,
        { id: e.id, title: e.title, startsAt: e.starts_at, description: d?.status ?? "missing", price: coerceFields(d?.approved_fields ?? d?.fields ?? {}).price, deadline: e.planning_cycles?.description_deadline ?? null, pretix: !pretix.enabled || !!pretix.done[e.id], eventStatus: e.status },
      ];
    })
  );
  const onChannel = (channel: string) => {
    const n = new Map<string, number>();
    for (const p of posts) if (p.channel === channel && p.status !== "skipped") for (const x of p.publication_post_events) n.set(x.event_id, (n.get(x.event_id) ?? 0) + 1);
    return n;
  };
  const counts = new Map(channels.map((c) => [c.key, onChannel(c.key)]));
  // Per event and channel, over all loaded posts: published, else the first planned post.
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
  const toBoard = (p: (typeof posts)[number]): BoardPost => {
    const ordered = [...p.publication_post_events].sort((a, b) => a.position - b.position);
    const evs = ordered.map((x) => x.event_id);
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
      preview: p.channel === "telegram" && evs.length ? telegramPreview(ordered, p.note, p.picture) : null,
      title: p.title,
      format: p.format as BoardPost["format"],
      assignees: p.assignees ?? [],
      progress: (p.progress ?? "todo") as BoardPost["progress"],
      caption: p.caption ?? "",
      designLink: p.design_link,
    };
  };
  const boardPosts = boardRows.map(toBoard);
  const boardEvents: BoardEvent[] = (eventRows ?? [])
    .map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.starts_at,
      description: desc.get(e.id)?.status ?? "missing",
      big: isBigEvent({ big: e.big, type: e.type }),
      draft: e.status === "draft",
      categoryId: e.category_id,
      listed: listed.has(e.id),
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const categories: BoardCategory[] = (categoryRows ?? []).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }));
  const focusEvent = focusId && boardEvents.some((e) => e.id === focusId && e.listed) ? focusId : null;
  const openPost = askedPost && boardPosts.some((p) => p.id === askedPost.id) ? askedPost.id : null;
  // The months to jump to: three back, six ahead.
  const months = Array.from({ length: 10 }, (_, i) => addMonths(thisMonth, i - 3));
  // The tabs keep the month the board shows (this one while today is on it).
  const tabMonth = inWindow(today) ? thisMonth : `${addDays(from, 6).slice(0, 7)}-01`;

  return (
    <>
      <PageHeader title="Comms" description="One row per event, the days left to right: click a day on a row to plan posts, drag a post to move it. Telegram posts go out by themselves once confirmed." />
      <CommsTabs current="schedule" month={monthParam(tabMonth)} executive={viewer.roles.includes("executive")} />
      {!channels.length ? (
        <Card>
          <EmptyState>No channel is switched on for the schedule (Admin → Publishing channels).</EmptyState>
        </Card>
      ) : (
        <ScheduleBoard
          range={{ from, to, isDefault: from === thisWeek }}
          months={months}
          channels={channels}
          events={boardEvents}
          posts={boardPosts}
          categories={categories}
          editable={editable}
          viewer={{ email: viewer.email, name: viewer.name }}
          today={today}
          initialFocus={focusEvent}
          initialPost={openPost}
          team={team ?? []}
          coverage={coverage}
          pretix={pretix}
        />
      )}
    </>
  );
}
