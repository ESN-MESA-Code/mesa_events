"use client";

// An event's panel on the board (round 2026-11-09 (5)): what the event cards
// of the old list showed – when, big / draft, the description, each channel,
// pretix – plus every post of the event and the planner for a campaign
// (several posts on several days in one go) or a bundle into an existing post.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { addToPost, planEventPosts } from "@/app/actions/publishing";
import { useAction } from "@/components/ActionButton";
import { DESCRIPTION_STATUS } from "@/components/status";
import { Badge, Button, Input, Select } from "@/components/ui";
import { berlinDate, berlinTime, formatDateTime } from "@/lib/dates";
import { addDays, dayDiff } from "@/lib/month";
import { FORMAT_LABEL, POST_FORMATS, defaultPostDay, isBigEvent, type PostFormat } from "@/lib/publishing";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { EventDot, MarkerShape } from "./Board";
import { STATE_TEXT, channelMark, dayLabel, leadOf, needsPosts, shortOf, stateOf, type BoardCategory, type BoardChannel, type BoardEvent, type BoardPost, type Coverage, type PretixChecklist } from "./boardModel";

export function EventPanel({
  event,
  channels,
  coverage,
  pretix,
  posts,
  allPosts,
  byId,
  categories,
  days,
  today,
  editable,
  onClose,
  onOpenPost,
}: {
  event: BoardEvent;
  channels: BoardChannel[];
  coverage: Coverage;
  pretix: PretixChecklist;
  /** The event's posts (every one loaded, not only the window's). */
  posts: BoardPost[];
  /** Every post (for "add it to a post"). */
  allPosts: BoardPost[];
  byId: Map<string, BoardEvent>;
  categories: BoardCategory[];
  /** The board's days. */
  days: string[];
  today: string;
  editable: boolean;
  onClose: () => void;
  onOpenPost: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const day = berlinDate(event.startsAt);
  const inDays = dayDiff(today, day);
  const desc = DESCRIPTION_STATUS[event.description];
  const category = categories.find((c) => c.id === event.categoryId);
  const required = channels.filter((c) => c.required);
  const missing = needsPosts(event, required, coverage, today);
  const sorted = [...posts].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [event.id]);

  return (
    <aside
      aria-label={`${event.title} – details and planning`}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 text-sm shadow-2xl lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:rounded-2xl lg:shadow-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) onClose();
      }}
      data-testid="event-panel"
    >
      <div className="flex items-start gap-2">
        <h2 ref={heading} tabIndex={-1} className="flex min-w-0 flex-1 items-start gap-1.5 text-base font-bold leading-snug text-gray-900 outline-none">
          <EventDot color={event.color} className="mt-1.5" />
          <span className="min-w-0 break-words">
            {category?.emoji && <span aria-hidden="true">{category.emoji} </span>}
            {event.title}
          </span>
        </h2>
        <button type="button" aria-label="Close the panel" className="px-1 text-gray-400 hover:text-gray-900" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-600">
        <span className="tabular-nums">📅 {formatDateTime(event.startsAt)}</span>
        <span aria-hidden="true">·</span>
        <span className={cn(inDays >= 0 && inDays <= 7 && "font-semibold text-amber-700", inDays < 0 && "text-gray-400")}>
          {inDays < 0 ? "past" : inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${plural(inDays, "day")}`}
        </span>
        {category && <span className="text-gray-500">· {category.name}</span>}
        {isBigEvent(event.type) && <Badge tone="amber">big</Badge>}
        {event.draft && (
          <Badge tone="gray" title="Its month is still being planned – the date may change until the Events team fixes it.">
            draft – date may change
          </Badge>
        )}
      </p>

      <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
        <dt className="text-gray-500">Description</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <Badge tone={desc?.tone ?? "gray"}>{desc?.label ?? event.description}</Badge>
          <Link href={`/events/${event.id}/description?from=comms`} className="text-esn hover:underline">
            Open
          </Link>
        </dd>
        {channels.map((c) => {
          const m = channelMark(coverage, event.id, c.key);
          return (
            <div key={c.key} className="contents">
              <dt className="text-gray-500">{c.name}</dt>
              <dd className={cn(m.state === "posted" ? "text-emerald-700" : m.state === "planned" ? "text-gray-800" : c.required && missing ? "font-semibold text-red-700" : "text-gray-500")}>
                {m.state === "posted" ? `✓ posted ${dayLabel(berlinDate(m.at!))}` : m.state === "planned" ? `⏰ first planned ${dayLabel(berlinDate(m.at!))}` : c.required && missing ? "– not planned yet" : "– not planned"}
              </dd>
            </div>
          );
        })}
        {pretix.enabled && (
          <>
            <dt className="text-gray-500">pretix</dt>
            <dd>
              <Link href={`/team/comms/pretix?event=${event.id}#pretix-${event.id}`} className={cn("hover:underline", pretix.done[event.id] ? "text-emerald-700" : "font-medium text-red-700")}>
                {pretix.done[event.id] ? "✓ page set up" : "page not set up →"}
              </Link>
            </dd>
          </>
        )}
      </dl>

      <section className="mt-4">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Posts ({sorted.length})</h3>
        {sorted.length ? (
          <ol className="space-y-0.5" data-testid="panel-posts">
            {sorted.map((p) => {
              const lead = leadOf(p, byId);
              const out = !days.includes(berlinDate(p.scheduledFor));
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenPost(p.id)} className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-gray-50">
                    <MarkerShape post={p} />
                    <span className="w-[6.75rem] shrink-0 whitespace-nowrap tabular-nums text-gray-600">
                      {dayLabel(berlinDate(p.scheduledFor))} {berlinTime(p.scheduledFor)}
                    </span>
                    <span className="shrink-0 font-semibold">{shortOf(p.channel)}</span>
                    <span className="min-w-0 truncate">{p.title || (p.format ? FORMAT_LABEL[p.format] : "Post")}</span>
                    <span className={cn("ml-auto shrink-0 text-[10px]", lead?.late ? "font-semibold text-red-700" : "text-gray-500")} title={lead?.text}>
                      {lead?.short} · {STATE_TEXT[stateOf(p)]}
                      {out ? " · not shown" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-gray-500">None yet.</p>
        )}
      </section>

      {editable && (
        <section className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Plan a campaign</h3>
          <p className="mb-2 text-xs text-gray-500">Several posts on several days at once – or click a day on the event&apos;s row for one day.</p>
          <PlanMenu key={event.id} event={event} channels={channels} days={days} today={today} posts={allPosts} byId={byId} />
        </section>
      )}
    </aside>
  );
}

type PlanRow = { channel: string; day: string; time: string; title: string; format: PostFormat | "" };

/**
 * A campaign in one go (round 2026-11-09): one or more posts of the event,
 * each with its channel, day, time and optionally a title and format; or
 * the event added to an existing post (bundle).
 */
function PlanMenu({ event, channels, days, today, posts, byId }: { event: BoardEvent; channels: BoardChannel[]; days: string[]; today: string; posts: BoardPost[]; byId: Map<string, BoardEvent> }) {
  const { run, pending, error } = useAction();
  const eventDay = berlinDate(event.startsAt);
  const minDay = eventDay < today ? undefined : today;
  // Any day up to the event (round 2026-11-02).
  const firstChannel = channels.find((c) => c.required && !posts.some((p) => p.channel === c.key && p.status !== "skipped" && p.events.includes(event.id))) ?? channels[0];
  const first: PlanRow = { channel: firstChannel?.key ?? "", day: defaultPostDay(days, today, eventDay), time: "10:00", title: "", format: "" };
  const [rows, setRows] = useState<PlanRow[]>([first]);
  const [into, setInto] = useState("");
  const set = (i: number, patch: Partial<PlanRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addRow = () =>
    setRows((r) => {
      const last = r[r.length - 1] ?? first;
      // The next post a week later when that is still before the event, else the same day (to change).
      const next = addDays(last.day, 7) < eventDay ? addDays(last.day, 7) : last.day;
      return [...r, { ...last, day: next, title: "", format: last.format }];
    });
  const candidates = posts.filter((p) => p.status === "planned" && p.events.length > 0 && !p.events.includes(event.id)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const label = (what: string, i: number) => `${what} for ${event.title}${i ? ` (post ${i + 1})` : ""}`;
  const plan = () =>
    run(
      planEventPosts,
      { event_id: event.id, posts: rows.map((r) => ({ channel: r.channel, day: r.day, time: r.time, title: r.title.trim(), format: r.channel === "telegram" ? "" : r.format })) },
      () => setRows([first]),
      (r) => (r.made === 1 ? "Post planned." : `${r.made} posts planned for ${event.title}.`)
    );
  return (
    <div className="grid min-w-0 gap-1.5 text-xs" data-testid={`plan-${event.id}`}>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className={cn("grid min-w-0 gap-1", rows.length > 1 && "rounded border border-gray-100 p-1")}>
            <span className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1">
              <Select aria-label={label("Channel", i)} value={r.channel} onChange={(e) => set(i, { channel: e.target.value })} className="h-8 min-w-0 px-1.5 py-1 text-xs">
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select aria-label={label("Format", i)} value={r.channel === "telegram" ? "" : r.format} disabled={r.channel === "telegram"} onChange={(e) => set(i, { format: e.target.value as PostFormat | "" })} className="h-8 min-w-0 px-1.5 py-1 text-xs">
                <option value="">{r.channel === "telegram" ? "Message" : "Format…"}</option>
                {POST_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </Select>
              {rows.length > 1 ? (
                <button type="button" aria-label={`Remove post ${i + 1}`} className="px-1 text-gray-400 hover:text-red-600" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                  ✕
                </button>
              ) : (
                <span />
              )}
            </span>
            <span className="grid grid-cols-[minmax(0,1fr)_4.75rem] gap-1">
              <Input aria-label={label("Day", i)} type="date" min={minDay} max={eventDay} value={r.day} onChange={(e) => set(i, { day: e.target.value })} className="h-8 min-w-0 px-1 text-xs" />
              <Input aria-label={label("Time", i)} type="time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} className="h-8 min-w-0 px-1 text-xs" />
            </span>
            <Input aria-label={label("Title", i)} placeholder="Title (optional), e.g. Save the date" value={r.title} maxLength={120} onChange={(e) => set(i, { title: e.target.value })} className="h-8 min-w-0 px-1.5 text-xs" />
            {r.day && !days.includes(r.day) && <span className="text-gray-500">{dayLabel(r.day)} is outside the weeks shown – it is planned all the same.</span>}
          </li>
        ))}
      </ol>
      {rows.length < 10 && (
        <button type="button" className="justify-self-start text-esn hover:underline" onClick={addRow} data-testid="plan-add-row">
          + Another post
        </button>
      )}
      <Button type="button" size="sm" disabled={pending || rows.some((r) => !r.day || !r.channel)} onClick={plan}>
        {rows.length === 1 ? "Plan the post" : `Plan ${rows.length} posts`}
      </Button>
      {candidates.length > 0 && (
        <span className="flex min-w-0 gap-1 border-t border-gray-100 pt-1.5">
          <Select aria-label={`Post for ${event.title}`} value={into} onChange={(e) => setInto(e.target.value)} className="h-8 min-w-0 px-1.5 py-1 text-xs">
            <option value="">…or add it to a post</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {shortOf(p.channel)} {dayLabel(berlinDate(p.scheduledFor))}: {[p.title, ...p.events.map((id) => byId.get(id)?.title ?? "…")].filter(Boolean).join(", ")}
              </option>
            ))}
          </Select>
          {into && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(addToPost, { post_id: into, event_id: event.id }, () => setInto(""), "Added to the post.")}>
              Add
            </Button>
          )}
        </span>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
