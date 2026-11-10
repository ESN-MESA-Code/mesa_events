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
import { CalendarDays, FileText, Plus, Ticket, Trash2, X } from "lucide-react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { berlinDate, berlinTime, formatDateTime } from "@/lib/dates";
import { addDays, dayDiff } from "@/lib/month";
import { FORMAT_LABEL, defaultPostDay, type PostFormat } from "@/lib/publishing";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { Mark, MarkerShape } from "./Board";
import { ChannelPicker, FieldLabel, FormatPicker, channelIcon } from "./fields";
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
  const past = inDays < 0;
  const descDone = event.description === "approved" || event.description === "published";

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [event.id]);

  return (
    <aside
      aria-label={`${event.title} – details and planning`}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-gray-200 bg-white p-4 text-sm shadow-2xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:max-h-none lg:w-[24rem] lg:rounded-2xl"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) onClose();
      }}
      data-testid="event-panel"
    >
      <div className="flex items-start gap-2">
        <h2 ref={heading} tabIndex={-1} className="flex min-w-0 flex-1 items-start gap-1.5 text-base font-bold leading-snug text-gray-900 outline-none">
          <span className="min-w-0 break-words">
            {category?.emoji && <span aria-hidden="true">{category.emoji} </span>}
            {event.title}
          </span>
        </h2>
        <button type="button" aria-label="Close the panel" className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-900" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <CalendarDays className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          {formatDateTime(event.startsAt)}
        </span>
        <span aria-hidden="true">·</span>
        <span className={cn(inDays >= 0 && inDays <= 7 && "font-semibold text-amber-700", inDays < 0 && "text-gray-400")}>
          {inDays < 0 ? "past" : inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${plural(inDays, "day")}`}
        </span>
        {category && <span className="text-gray-500">· {category.name}</span>}
        {event.big && <Badge tone="amber" title="Marked big by the Events team – advertise it weeks ahead">big</Badge>}
        {event.draft && (
          <Badge tone="gray" title="Its month is still being planned – the date may change until the Events team fixes it.">
            draft – date may change
          </Badge>
        )}
      </p>

      {/* What it needs, with the board's icons: filled green done, a blue outline planned, red missing. */}
      <dl className="mt-3 grid grid-cols-[1.25rem_5.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 rounded-xl bg-gray-50 p-3 text-xs">
        <Mark icon={FileText} tone={descDone ? "done" : past ? "off" : "missing"} label={`Description: ${desc?.label ?? event.description}`} />
        <dt className="text-gray-500">Description</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          <Badge tone={desc?.tone ?? "gray"}>{desc?.label ?? event.description}</Badge>
          <Link href={`/events/${event.id}/description?from=comms`} className="text-esn hover:underline">
            Open
          </Link>
        </dd>
        {pretix.enabled && (
          <>
            <Mark icon={Ticket} tone={pretix.done[event.id] ? "done" : past || event.draft ? "off" : "missing"} label={pretix.done[event.id] ? "pretix page set up" : "pretix page not set up"} />
            <dt className="text-gray-500">pretix page</dt>
            <dd>
              <Link href={`/team/comms/pretix?event=${event.id}#pretix-${event.id}`} className={cn("hover:underline", pretix.done[event.id] ? "text-emerald-700" : past || event.draft ? "text-gray-500" : "font-semibold text-red-700")}>
                {pretix.done[event.id] ? "Set up" : "Not set up yet →"}
              </Link>
            </dd>
          </>
        )}
        {channels.map((c) => {
          const m = channelMark(coverage, event.id, c.key);
          const tone = m.state === "posted" ? "done" : m.state === "planned" ? "planned" : c.required && missing ? "missing" : "off";
          return (
            <div key={c.key} className="contents">
              <Mark icon={channelIcon(c.key)} tone={tone} label={`${c.name}: ${m.state === "missing" ? "not planned" : m.state}`} />
              <dt className="text-gray-500">{c.name}</dt>
              <dd className={cn(tone === "done" ? "text-emerald-700" : tone === "planned" ? "font-medium text-esn" : tone === "missing" ? "font-semibold text-red-700" : "text-gray-500")}>
                {m.state === "posted" ? `Posted ${dayLabel(berlinDate(m.at!))}` : m.state === "planned" ? `First post planned ${dayLabel(berlinDate(m.at!))}` : tone === "missing" ? "Not planned yet" : "Not planned"}
              </dd>
            </div>
          );
        })}
      </dl>

      <section className="mt-4">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Posts ({sorted.length})</h3>
        {sorted.length ? (
          <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="panel-posts">
            {sorted.map((p) => {
              const lead = leadOf(p, byId);
              const out = !days.includes(berlinDate(p.scheduledFor));
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenPost(p.id)} className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-gray-50">
                    <MarkerShape post={p} />
                    <span className="w-[6.75rem] shrink-0 whitespace-nowrap tabular-nums text-gray-600">
                      {dayLabel(berlinDate(p.scheduledFor))} {berlinTime(p.scheduledFor)}
                    </span>
                    <span className="shrink-0 font-semibold">{shortOf(p.channel)}</span>
                    <span className="min-w-0 truncate">{p.title || (p.format ? FORMAT_LABEL[p.format] : p.channel === "telegram" ? "Message" : "Post")}</span>
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
    <div className="grid min-w-0 gap-2.5 text-xs" data-testid={`plan-${event.id}`}>
      <ol className="space-y-2.5">
        {rows.map((r, i) => (
          <li key={i} className={cn("grid min-w-0 gap-2", rows.length > 1 && "rounded-xl border border-gray-200 bg-gray-50/60 p-2.5")}>
            {rows.length > 1 && (
              <div className="flex items-center">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700">Post {i + 1}</span>
                <button
                  type="button"
                  aria-label={`Remove post ${i + 1}`}
                  className="-my-1 ml-auto flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="space-y-1">
              <FieldLabel>Channel</FieldLabel>
              <ChannelPicker channels={channels} value={r.channel} onChange={(key) => set(i, { channel: key })} label={label("Channel", i)} />
            </div>
            <div className="space-y-1">
              <FieldLabel>Format</FieldLabel>
              {r.channel === "telegram" ? (
                <p className="rounded-lg bg-sky-50 px-2.5 py-2 leading-4 text-sky-900">A message made from the event’s description.</p>
              ) : (
                <FormatPicker value={r.format} onChange={(f) => set(i, { format: f })} label={label("Format", i)} />
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
              <div className="space-y-1">
                <FieldLabel htmlFor={`plan-day-${i}`}>Day</FieldLabel>
                <Input id={`plan-day-${i}`} aria-label={label("Day", i)} type="date" min={minDay} max={eventDay} value={r.day} onChange={(e) => set(i, { day: e.target.value })} className="h-8 min-w-0 px-2 text-xs" />
              </div>
              <div className="space-y-1">
                <FieldLabel htmlFor={`plan-time-${i}`}>Time</FieldLabel>
                <Input id={`plan-time-${i}`} aria-label={label("Time", i)} type="time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} className="h-8 min-w-0 px-2 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel htmlFor={`plan-title-${i}`}>
                Title<span className="font-normal normal-case tracking-normal text-gray-400"> – optional</span>
              </FieldLabel>
              <Input id={`plan-title-${i}`} aria-label={label("Title", i)} placeholder="e.g. Save the date" value={r.title} maxLength={120} onChange={(e) => set(i, { title: e.target.value })} className="h-8 min-w-0 px-2 text-xs" />
            </div>
            {r.day && !days.includes(r.day) && <span className="text-gray-500">{dayLabel(r.day)} is outside the weeks shown – it is planned all the same.</span>}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        {rows.length < 10 && (
          <button type="button" className="inline-flex items-center gap-1 font-medium text-esn hover:underline" onClick={addRow} data-testid="plan-add-row">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Another post
          </button>
        )}
        <Button type="button" size="sm" className="ml-auto" disabled={pending || rows.some((r) => !r.day || !r.channel)} onClick={plan}>
          {rows.length === 1 ? "Plan the post" : `Plan ${rows.length} posts`}
        </Button>
      </div>
      {candidates.length > 0 && (
        <span className="grid min-w-0 gap-1 border-t border-gray-100 pt-2.5">
          <FieldLabel htmlFor={`plan-into-${event.id}`}>Or add it to a planned post</FieldLabel>
          <span className="flex min-w-0 gap-1.5">
          <Select id={`plan-into-${event.id}`} aria-label={`Post for ${event.title}`} value={into} onChange={(e) => setInto(e.target.value)} className="h-8 min-w-0 px-1.5 py-1 text-xs">
            <option value="">Choose a post…</option>
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
        </span>
      )}
      {error && (
        <span role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
