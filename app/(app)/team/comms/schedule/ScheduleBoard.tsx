"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { PictureButton, UploadedPicture, pictureProblem } from "@/components/PostPicture";
import { Alert, Badge, Button, Card, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import {
  addToPost,
  confirmPost,
  createPost,
  deletePost,
  editPost,
  markPostPublished,
  movePost,
  planEventPosts,
  publishPostNow,
  removeFromPost,
  reorderPost,
  setPostEventPicture,
  skipPost,
} from "@/app/actions/publishing";
import { DESCRIPTION_STATUS } from "@/components/status";
import { berlinDate, berlinTime, formatDateTime, formatShortDate, monthLabel, monthOf } from "@/lib/dates";
import { calendarWeeks, dayDiff } from "@/lib/month";
import { FORMAT_LABEL, POST_FORMATS, defaultPostDay, isBigEvent, namesOf, trayGroups, type PostFormat, type Progress } from "@/lib/publishing";
import { addDays } from "@/lib/month";
import { plural } from "@/lib/plural";
import { ContentEditor, NewPostForm, ProgressPill, RegularPostsForm, initials, type TeamMember } from "./PostContent";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface BoardChannel {
  key: string;
  name: string;
  kind: "auto" | "manual";
  /** Every event is published here (Telegram, Instagram). */
  required: boolean;
}

export interface BoardEvent {
  id: string;
  title: string;
  startsAt: string;
  /** Description status ("missing" when none). */
  description: string;
  /** standard, special, day_trip, weekend_trip – the big ones lead a later month in the list. */
  type: string | null;
  /** Its cycle is still being planned (round 2026-11-09): it may be advertised early, but its date may still change. */
  draft?: boolean;
  /** Its colour on the board (set by the board): the same dot on the list, its date and its posts. */
  color?: string;
}

/** An event's best post per channel, from every month (published wins over planned). */
export type Coverage = Record<string, Record<string, { status: "planned" | "published"; at: string }>>;

/** pretix as a checklist: the events whose pretix page is up, with its link when given. */
export interface PretixChecklist {
  enabled: boolean;
  done: Record<string, { link: string | null }>;
}

/** One Telegram message of a post as the preview shows it (round 2026-11-03). */
export interface PreviewMessage {
  /** Plain text. */
  text: string;
  /** The event of the message; null for the heading. */
  eventId: string | null;
  /** Its picture: its own, else the default of its format or type. */
  picture: string | null;
  /** The picture is a default (Pictures tab), not one of this post. */
  isDefault: boolean;
}

export interface BoardPost {
  id: string;
  channel: string;
  scheduledFor: string;
  status: "planned" | "published" | "skipped";
  /** Telegram: Comms confirmed it after the preview (only then it goes out). */
  confirmed: boolean;
  link: string | null;
  picture: string | null;
  note: string;
  skipReason: string | null;
  lastError: string | null;
  publishedAt: string | null;
  /** Event ids in the post's order. */
  events: string[];
  warnings: string[];
  /** Telegram, planned: why the job would not post it (description not approved, TBA price) – nothing to confirm yet. */
  refusal: string | null;
  /** Telegram: the messages as they will be posted, one per event, each with its picture (round 2026-11-03). */
  preview: PreviewMessage[] | null;
  /** Content planning (round 2026-11-09): a title (needed without events), post / story / reel, who, how far, caption, design. */
  title: string | null;
  format: PostFormat | null;
  assignees: string[];
  progress: Progress;
  caption: string;
  designLink: string | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHORT: Record<string, string> = { telegram: "TG", instagram: "IG" };
/** A channel's colour on the calendar. */
const CHANNEL_CHIP: Record<string, string> = {
  telegram: "border-sky-300 bg-sky-50 text-sky-900",
  instagram: "border-pink-300 bg-pink-50 text-pink-900",
};
const chipOf = (channel: string) => CHANNEL_CHIP[channel] ?? "border-gray-300 bg-gray-50 text-gray-800";

/**
 * An event's colour (round 2026-11-03): its dot on the list, on its date and
 * on every post that advertises it, so a post and its event are matched at a
 * glance. By date order, so neighbours differ.
 */
const EVENT_COLORS = ["bg-rose-500", "bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500", "bg-teal-500", "bg-fuchsia-500", "bg-lime-600", "bg-indigo-500"];

function EventDot({ color, className }: { color?: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white", color ?? "bg-gray-300", className)} />;
}

/** "in 3 days", "on the day", "2 days after!" – a post's day relative to its event. */
function leadTime(postDay: string, eventStart: string): { text: string; late: boolean } {
  const d = dayDiff(postDay, berlinDate(eventStart));
  if (d === 0) return { text: "on the event day", late: false };
  if (d < 0) return { text: `${-d} d after the event`, late: true };
  return { text: `${d} d before`, late: false };
}

/**
 * A post's lead time on its card (round 2026-11-09): "−3d", "−2w", "day of",
 * "+1d" (after – late), counted to its next event (the last one when all are
 * before the post); null for a post without events.
 */
function leadOf(post: BoardPost, byId: Map<string, BoardEvent>): { short: string; text: string; late: boolean } | null {
  const day = berlinDate(post.scheduledFor);
  const evs = post.events
    .map((id) => byId.get(id))
    .filter((e): e is BoardEvent => !!e)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (!evs.length) return null;
  const ev = evs.find((e) => berlinDate(e.startsAt) >= day) ?? evs[evs.length - 1];
  const d = dayDiff(day, berlinDate(ev.startsAt));
  const short = d === 0 ? "day of" : d < 0 ? `+${-d}d` : d < 14 ? `−${d}d` : `−${Math.round(d / 7)}w`;
  return { short, text: `${leadTime(day, ev.startsAt).text} – ${ev.title}`, late: d < 0 };
}

/** The "By event" view's marker colour per channel. */
const CHANNEL_DOT: Record<string, { solid: string; light: string }> = {
  telegram: { solid: "bg-sky-500 border-sky-600", light: "bg-sky-100 border-sky-500" },
  instagram: { solid: "bg-pink-500 border-pink-600", light: "bg-pink-100 border-pink-500" },
};
const dotOf = (channel: string) => CHANNEL_DOT[channel] ?? { solid: "bg-gray-500 border-gray-600", light: "bg-gray-100 border-gray-500" };

/** A post under the pointer wins over its day (bundling); the keyboard has no pointer and takes the overlap. */
const collisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const post = hits.find((c) => /^m?post\|/.test(String(c.id)));
  if (post) return [post];
  return hits.length ? hits : rectIntersection(args);
};

function Draggable({ id, disabled, className, children, testId }: { id: string; disabled: boolean; className?: string; children: React.ReactNode; testId?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  // Not draggable: no role="button" aria-disabled wrapper, which would read the post's own button as disabled.
  return (
    <div ref={setNodeRef} {...(disabled ? {} : { ...listeners, ...attributes })} data-testid={testId} className={cn(className, !disabled && "cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-40")}>
      {children}
    </div>
  );
}

/**
 * The advertisement schedule (brief 2026-10-29, E3; round 2026-10-31): the
 * month's events listed on the left (as the roster lists its volunteers),
 * each with a chip per channel; the month as a calendar like the other
 * calendars, with the events on the day they take place (📅) and the posts
 * on the day they go out. Drag a channel chip onto a day to plan that
 * post, onto a post of the same channel to bundle the event into it, a
 * post to another day to move it. Click a post for its details (Telegram's preview,
 * confirm, publish, skip …), an event to highlight its date and posts.
 * pretix is not scheduled: its own page (round 2026-11-09), linked from each event.
 * Round 2026-11-02: below the month's events the list holds the upcoming
 * events of later months, by month and big ones first; their chips are
 * dropped on this month's days like any other (a post may sit on any day
 * before its event).
 */
export function ScheduleBoard({
  month,
  channels,
  events,
  posts,
  timelinePosts,
  editable,
  viewer,
  today,
  coverage,
  pretix,
  team,
  initialFocus = null,
  initialPost = null,
}: {
  month: string;
  channels: BoardChannel[];
  events: BoardEvent[];
  posts: BoardPost[];
  /** Posts from this month on, as far as the list looks ahead – the "By event" view. */
  timelinePosts: BoardPost[];
  editable: boolean;
  viewer: { email: string; name: string };
  /** Berlin date; events before it are no longer advertised. */
  today: string;
  coverage: Coverage;
  pretix: PretixChecklist;
  /** An event to highlight (?event=… from the Comms page). */
  initialFocus?: string | null;
  /** Who can make posts (the Comms team). */
  team: TeamMember[];
  /** A post to open (?post=… from the content list). */
  initialPost?: string | null;
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [open, setOpen] = useState<string | null>(initialPost);
  const [mine, setMine] = useState(false);
  const [panel, setPanel] = useState<"" | "new" | "regular">("");
  // Round 2026-11-09: the calendar or one row per event; events and posts can be hidden.
  const [view, setView] = useState<"calendar" | "timeline">("calendar");
  const [showEvents, setShowEvents] = useState(true);
  const [showPosts, setShowPosts] = useState(true);
  const [others, setOthers] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const [hover, setHover] = useState<string | null>(null);
  const colored = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((e, i) => ({ ...e, color: EVENT_COLORS[i % EVENT_COLORS.length] }));
  const byId = new Map(colored.map((e) => [e.id, e]));
  const channelOf = new Map(channels.map((c) => [c.key, c]));
  const weeks = calendarWeeks(month);
  const days = weeks.flat().filter((d): d is string => !!d);
  const focusDay = focus ? berlinDate(byId.get(focus)?.startsAt ?? "") : null;
  const opened = timelinePosts.find((p) => p.id === open) ?? posts.find((p) => p.id === open) ?? null;
  // A focused event's campaign: from its first post to its day, shaded on the calendar.
  const campaignFrom = focus
    ? timelinePosts
        .filter((p) => p.events.includes(focus) && p.status !== "skipped")
        .map((p) => berlinDate(p.scheduledFor))
        .sort()[0] ?? null
    : null;
  const inCampaign = (d: string) => !!focusDay && !!campaignFrom && d >= campaignFrom && d < focusDay;
  const required = channels.filter((c) => c.required);

  // Others' changes (Realtime) and who else is on the board (presence).
  const refresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const later = () => {
      if (refresh.current) clearTimeout(refresh.current);
      refresh.current = setTimeout(() => router.refresh(), 300);
    };
    const channel = supabase
      .channel("publishing-schedule", { config: { presence: { key: viewer.email } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "publication_posts" }, later)
      .on("postgres_changes", { event: "*", schema: "public", table: "publication_post_events" }, later)
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>();
        setOthers(Object.entries(state).filter(([k]) => k !== viewer.email).map(([, m]) => m[0]?.name ?? "Someone"));
      })
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") await channel.track({ name: viewer.name });
      });
    return () => {
      if (refresh.current) clearTimeout(refresh.current);
      supabase.removeChannel(channel);
    };
  }, [router, viewer.email, viewer.name]);

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (!e.over || !editable) return;
    // The phone list's twins have their own ids ("mpost", "mday"): a hidden twin with the same id would take the drop.
    // The "By event" view: its markers ("tpost|<post>|<event>") move posts, its columns ("tday|<day>") are days.
    const [kind, a, b] = String(e.active.id).replace(/^mpost\|/, "post|").replace(/^tpost\|([^|]+)\|.*$/, "post|$1").split("|");
    const [target, x] = String(e.over.id).replace(/^mpost\|/, "post|").replace(/^tday\|/, "day|").split("|");
    const postOf = (id: string) => timelinePosts.find((p) => p.id === id) ?? posts.find((p) => p.id === id);
    if (kind === "chan") {
      // a = channel, b = event
      if (target === "day" || target === "mday") run(createPost, { channel: a, day: x, event_ids: [b] });
      else if (target === "post") {
        const p = postOf(x);
        if (!p) return;
        if (p.channel !== a) return setError(`That post is on ${channelOf.get(p.channel)?.name ?? p.channel} – drop the ${channelOf.get(a)?.name ?? a} chip on a day or on a ${channelOf.get(a)?.name ?? a} post.`);
        if (!p.events.includes(b)) run(addToPost, { post_id: x, event_id: b });
      }
    } else if (kind === "post") {
      const p = postOf(a);
      const day = target === "post" ? (postOf(x) ? berlinDate(postOf(x)!.scheduledFor) : null) : target === "day" || target === "mday" ? x : null;
      if (p && day && berlinDate(p.scheduledFor) !== day) run(movePost, { post_id: a, day, time: berlinTime(p.scheduledFor) });
    }
  }

  const overlay = dragging ? dragging.split("|") : null;
  const overlayText = overlay ? (overlay[0] === "chan" ? `${channelOf.get(overlay[1])?.name}: ${byId.get(overlay[2])?.title}` : "Move the post") : null;
  const eventsOn = (d: string) => events.filter((e) => berlinDate(e.startsAt) === d).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  const postsOn = (d: string) => posts.filter((p) => berlinDate(p.scheduledFor) === d).sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor));

  const eventLabel = (e: BoardEvent, phone: boolean, muted = false) => (
    <EventLabel
      key={e.id}
      event={e}
      color={byId.get(e.id)?.color}
      required={required}
      coverage={coverage}
      today={today}
      active={focus === e.id}
      muted={muted}
      phone={phone}
      onClick={() => setFocus(focus === e.id ? null : e.id)}
      onEnter={() => setHover(e.id)}
      onLeave={() => setHover(null)}
    />
  );
  // Round 2026-11-09: events are labels (what is happening), posts are cards (what Comms makes).
  const dayContent = (d: string, phone = false) => {
    const evs = showEvents ? eventsOn(d) : [];
    const ps = showPosts ? postsOn(d) : [];
    return (
      <>
        {evs.map((e) => eventLabel(e, phone))}
        {evs.length > 0 && ps.length > 0 && <div aria-hidden="true" className="border-t border-dashed border-gray-200" />}
        {ps.map((p) => (
          <PostChip
            key={p.id}
            post={p}
            byId={byId}
            editable={editable}
            focus={hover ?? focus}
            onOpen={() => setOpen(p.id)}
            phone={phone}
            team={team}
            dim={(mine && !p.assignees.includes(viewer.email)) || (!!focus && !p.events.includes(focus))}
          />
        ))}
      </>
    );
  };
  // The first days of next month at the end of the grid: their events (greyed), not for dropping.
  const lastDay = days[days.length - 1];
  const trailing = (i: number) => {
    const at = weeks.flat().findIndex((x) => x === lastDay);
    return i > at ? addDays(lastDay, i - at) : null;
  };

  return (
    <DndContext id="publishing-board" sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="space-y-3">
        {others.length > 0 && <p className="text-xs text-gray-500">Also on the board: {others.join(", ")}</p>}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <EventList month={month} events={colored} setHover={setHover} today={today} channels={channels} coverage={coverage} pretix={pretix} days={days} posts={posts} editable={editable} byId={byId} focus={focus} setFocus={setFocus} />

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-base font-bold text-gray-900">{view === "calendar" ? "Month board" : "By event"}</h2>
              <div role="radiogroup" aria-label="View" className="mr-auto flex rounded-lg bg-gray-100 p-0.5 text-xs" data-testid="board-view">
                {(["calendar", "timeline"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={cn("rounded-md px-2 py-1 font-medium", view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900")}
                  >
                    {v === "calendar" ? "Calendar" : "By event"}
                  </button>
                ))}
              </div>
              {pending && <span className="text-xs text-gray-500">Saving…</span>}
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700" title="Only the posts you make stand out">
                <input type="checkbox" className="accent-esn" checked={mine} onChange={(e) => setMine(e.target.checked)} data-testid="only-mine" /> Mine
              </label>
              {view === "calendar" && (
                <>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                    <input type="checkbox" className="accent-esn" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} data-testid="show-events" /> Events
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                    <input type="checkbox" className="accent-esn" checked={showPosts} onChange={(e) => setShowPosts(e.target.checked)} data-testid="show-posts" /> Posts
                  </label>
                </>
              )}
              {editable && (
                <>
                  <Button size="sm" variant={panel === "new" ? "default" : "outline"} onClick={() => setPanel(panel === "new" ? "" : "new")} data-testid="new-post">
                    + Post without event
                  </Button>
                  <Button size="sm" variant={panel === "regular" ? "default" : "outline"} onClick={() => setPanel(panel === "regular" ? "" : "regular")} data-testid="regular-posts">
                    Regular posts
                  </Button>
                </>
              )}
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600" data-testid="board-legend">
                <span className="inline-flex items-center gap-1 px-1 py-0.5 text-gray-600" title="When the event takes place – click it to see its posts">
                  <EventDot color="bg-rose-500" /> 📅 Event
                </span>
                <span className="rounded-md bg-gray-50 px-1.5 py-0.5" title="How long before its event a post goes out">
                  −3d = 3 days before
                </span>
                {channels.map((c) => (
                  <span key={c.key} className={cn("rounded-md border px-1.5 py-0.5", chipOf(c.key))} title={`${c.name} post`}>
                    {SHORT[c.key] ?? c.name} = {c.name}
                  </span>
                ))}
                <span className="rounded-md bg-gray-50 px-1.5 py-0.5" title="Not confirmed yet – will not go out">
                  ⏸ not confirmed
                </span>
              </p>
            </div>
            {panel === "new" && (
              <div className="mb-3">
                <NewPostForm channels={channels} days={days} today={today} onDone={() => setPanel("")} />
              </div>
            )}
            {panel === "regular" && (
              <div className="mb-3">
                <RegularPostsForm channels={channels} month={month} today={today} onDone={() => setPanel("")} />
              </div>
            )}
            {view === "timeline" && (
              <Timeline
                month={month}
                events={colored}
                posts={timelinePosts}
                today={today}
                editable={editable}
                focus={focus}
                setFocus={setFocus}
                onOpen={setOpen}
                dimmed={(p) => mine && !p.assignees.includes(viewer.email)}
              />
            )}
            {/* Desktop and tablet: the whole month at once. */}
            <div className={cn("hidden", view === "calendar" && "sm:block")} data-testid="schedule-board">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-gray-500">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {weeks.flat().map((d, i) => {
                  if (d)
                    return (
                      <Day key={d} id={`day|${d}`} day={d} today={today} highlight={d === focusDay} campaign={inCampaign(d)} disabled={!editable}>
                        {dayContent(d)}
                      </Day>
                    );
                  const next = trailing(i);
                  return next ? (
                    <div key={next} className="min-h-20 min-w-0 space-y-1 rounded-md border border-dashed border-gray-200 bg-gray-50/60 p-1" data-testid={`next-day-${next}`}>
                      <p className="text-[11px] font-semibold tabular-nums text-gray-400">
                        {Number(next.slice(8))} {formatShortDate(`${next}T12:00:00Z`).split(" ").pop()}
                      </p>
                      {showEvents && eventsOn(next).map((e) => eventLabel(e, false, true))}
                    </div>
                  ) : (
                    <div key={`blank-${i}`} aria-hidden="true" />
                  );
                })}
              </div>
            </div>
            {/* Phones: the days with something on them, plus drop targets while dragging (their own ids). */}
            <ol className={cn("space-y-1 sm:hidden", view === "timeline" && "hidden")}>
              {days
                .filter((d) => eventsOn(d).length > 0 || postsOn(d).length > 0 || (!!dragging && d >= today))
                .map((d) => (
                  <li key={d}>
                    <Day id={`mday|${d}`} day={d} today={today} highlight={d === focusDay} campaign={inCampaign(d)} disabled={!editable} wide>
                      {dayContent(d, true)}
                    </Day>
                  </li>
                ))}
            </ol>
            {editable && (
              <details className="group mt-3 text-xs text-gray-500">
                <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-gray-600 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
                  How the board works
                </summary>
                <p className="mt-1 pl-3">
                  Drag a channel chip of an event from the list onto a day to plan that post (10:00), or onto a post of the same channel to bundle them. Drag a post to another day to move it; click it for the preview, publishing and the rest. Click an event to see only its posts and the days from its first post to the event. “By event” shows each event as a row with its posts on their days. Keyboard: focus a chip, Space, arrow keys, Space – or “Plan…”, which plans several posts at once.
                </p>
              </details>
            )}
          </Card>
        </div>
      </div>
      {opened && (
        <PostDialog onClose={() => setOpen(null)} title={`${opened.title ? `${opened.title} – ` : ""}${channelOf.get(opened.channel)?.name ?? opened.channel} ${opened.format ? FORMAT_LABEL[opened.format].toLowerCase() : "post"}, ${formatDateTime(opened.scheduledFor)}`}>
          <PostDetails
            post={opened}
            channel={channelOf.get(opened.channel) ?? { key: opened.channel, name: opened.channel, kind: "manual", required: false }}
            byId={byId}
            editable={editable}
            team={team}
            viewerEmail={viewer.email}
          />
        </PostDialog>
      )}
      <DragOverlay>{overlayText ? <div className="rounded-md border border-esn bg-white px-2 py-1 text-xs shadow-md">{overlayText}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function Day({
  id,
  day,
  today,
  highlight,
  campaign = false,
  disabled,
  wide,
  children,
}: {
  id: string;
  day: string;
  today: string;
  highlight: boolean;
  /** Between the focused event's first post and its day. */
  campaign?: boolean;
  disabled: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      aria-label={formatShortDate(`${day}T12:00:00Z`)}
      data-testid={`${wide ? "mday" : "day"}-${day}`}
      className={cn(
        "min-w-0 rounded-md border p-1 space-y-1",
        wide ? "flex gap-2 space-y-0" : "min-h-20",
        isOver ? "border-esn bg-esn/10" : highlight ? "border-amber-400 bg-amber-50" : campaign ? "border-amber-200 bg-amber-50/50" : day < today ? "border-gray-100 bg-gray-50" : "border-gray-200 bg-white"
      )}
    >
      <p className={cn("text-[11px] font-semibold tabular-nums", wide && "w-14 shrink-0", day === today ? "text-esn" : "text-gray-500")}>{wide ? `${day.slice(8)}.${day.slice(5, 7)}.` : Number(day.slice(8))}</p>
      <div className={cn("space-y-1", wide && "min-w-0 flex-1")}>{children}</div>
    </div>
  );
}

/** A post on the calendar: drop a chip of its channel on it to bundle, drag it to move it, click it for the details. */
function PostChip({
  post,
  byId,
  editable,
  focus,
  onOpen,
  phone,
  team,
  dim,
}: {
  post: BoardPost;
  byId: Map<string, BoardEvent>;
  editable: boolean;
  focus: string | null;
  onOpen: () => void;
  phone: boolean;
  team: TeamMember[];
  /** "Mine" is on and the viewer does not make this post. */
  dim: boolean;
}) {
  const id = `${phone ? "mpost" : "post"}|${post.id}`;
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editable || post.status === "skipped" });
  const unconfirmed = post.channel === "telegram" && post.status === "planned" && !post.confirmed;
  const mark = post.status === "published" ? "✓" : post.status === "skipped" ? "⨯" : unconfirmed ? "⏸" : "⏰";
  const titles = post.events.map((id) => byId.get(id)?.title ?? "Event");
  const focused = !!focus && post.events.includes(focus);
  const who = post.assignees.map((e) => team.find((m) => m.email === e)?.name ?? e.split("@")[0]);
  const lead = leadOf(post, byId);
  return (
    <div ref={setNodeRef} data-testid={`post-${post.id}`} className={cn("rounded", isOver && "ring-2 ring-esn", focused && "ring-2 ring-amber-500", dim && "opacity-40")}>
      <Draggable id={id} disabled={!editable || post.status !== "planned"}>
        <button
          type="button"
          onClick={onOpen}
          title={`${post.title ? `${post.title}\n` : ""}${titles.join(", ")}${who.length ? `\nBy ${who.join(", ")}` : ""}${post.warnings.length ? `\n⚠ ${post.warnings.join("\n⚠ ")}` : ""}`}
          className={cn(
            "block w-full rounded-md border px-1 py-0.5 text-left text-[11px] leading-tight shadow-sm hover:brightness-95",
            chipOf(post.channel),
            post.status === "published" && "border-emerald-400",
            post.status === "skipped" && "opacity-60 line-through",
            unconfirmed && "border-dashed"
          )}
        >
          <span className="mr-1 inline-flex gap-0.5 align-middle" data-testid="event-dots">
            {post.events.map((id) => (
              <EventDot key={id} color={byId.get(id)?.color} />
            ))}
          </span>
          <span className="font-semibold">{SHORT[post.channel] ?? post.channel}</span>
          {post.format && post.format !== "post" && <span className="ml-0.5 rounded bg-white/70 px-0.5 text-[10px] uppercase">{FORMAT_LABEL[post.format]}</span>}{" "}
          <span className="tabular-nums">{berlinTime(post.scheduledFor)}</span> {mark}
          {post.warnings.length > 0 && (
            <span className="text-amber-700" aria-label="Has warnings">
              {" "}
              ⚠
            </span>
          )}
          {lead && (
            <span
              className={cn("float-right ml-1 rounded px-0.5 text-[10px] font-semibold tabular-nums", lead.late ? "bg-red-100 text-red-700" : "bg-white/80 text-gray-600")}
              title={lead.text}
              data-testid="lead-time"
            >
              {lead.short}
            </span>
          )}
          <span className={cn("block break-words", !phone && "line-clamp-2")}>
            {post.title ? <span className="font-semibold">{post.title}</span> : null}
            {post.title && titles.length ? " · " : ""}
            {titles.length > 1 ? `${titles.length}: ` : ""}
            {titles.join(", ")}
          </span>
          {(who.length > 0 || post.progress !== "todo") && post.status === "planned" && (
            <span className="mt-0.5 flex items-center gap-1">
              {post.progress !== "todo" && <ProgressPill post={post} className="px-1 py-0 text-[10px]" />}
              {who.length > 0 && (
                <span className="ml-auto flex -space-x-1" aria-label={`By ${who.join(", ")}`}>
                  {who.map((n) => (
                    <span key={n} className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[8px] font-bold text-gray-700 ring-1 ring-gray-300">
                      {initials(n)}
                    </span>
                  ))}
                </span>
              )}
            </span>
          )}
        </button>
      </Draggable>
    </div>
  );
}

/** The month's events (as the roster lists its volunteers): a chip per channel to drag onto the calendar, and the pretix tick. */
function EventList({
  month,
  events,
  setHover,
  today,
  channels,
  coverage,
  pretix,
  days,
  posts,
  editable,
  byId,
  focus,
  setFocus,
}: {
  month: string;
  events: BoardEvent[];
  setHover: (id: string | null) => void;
  today: string;
  channels: BoardChannel[];
  coverage: Coverage;
  pretix: PretixChecklist;
  days: string[];
  posts: BoardPost[];
  editable: boolean;
  byId: Map<string, BoardEvent>;
  focus: string | null;
  setFocus: (id: string | null) => void;
}) {
  const [todo, setTodo] = useState(false);
  const required = channels.filter((c) => c.required);
  const stateOn = (channel: string, eventId: string) => coverage[eventId]?.[channel] ?? null;
  const isDone = (ev: BoardEvent) => required.every((c) => stateOn(c.key, ev.id)) && (!pretix.enabled || !!pretix.done[ev.id]);
  // Drafts may be advertised early; they are not counted as still to do.
  const open = events.filter((ev) => !ev.draft && berlinDate(ev.startsAt) >= today && !isDone(ev));
  const [own, ...later] = trayGroups(events, month).map((g) => ({ ...g, events: todo ? g.events.filter((ev) => open.includes(ev)) : g.events }));
  // Round 2026-11-09: the event's colour as a stripe, the title first, when and how soon, the
  // description as a pill, the channel chips to drag, pretix and planning in the footer.
  const item = (e: BoardEvent) => {
    const past = berlinDate(e.startsAt) < today;
    const inDays = dayDiff(today, berlinDate(e.startsAt));
    const soon = inDays >= 0 && inDays <= 7;
    const desc = DESCRIPTION_STATUS[e.description];
    return (
      <li
        key={e.id}
        data-testid={`tray-${e.id}`}
        onMouseEnter={() => setHover(e.id)}
        onMouseLeave={() => setHover(null)}
        className={cn(
          "relative overflow-hidden rounded-xl border border-gray-200 bg-white text-xs shadow-sm transition-shadow hover:shadow-md",
          focus === e.id && "ring-2 ring-amber-400",
          past && "opacity-60"
        )}
      >
        <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", e.color ?? "bg-gray-300")} />
        <div className="space-y-2 py-2.5 pl-3.5 pr-2.5">
          <div className="flex items-start gap-2">
            <button type="button" className="group min-w-0 flex-1 text-left" onClick={() => setFocus(focus === e.id ? null : e.id)} aria-pressed={focus === e.id}>
              <span className="block break-words text-[13px] font-semibold leading-snug text-gray-900 group-hover:text-esn">{e.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-gray-500">
                <span className="tabular-nums">
                  📅 {formatShortDate(e.startsAt)}, {berlinTime(e.startsAt)}
                </span>
                <span aria-hidden="true">·</span>
                <span className={cn(soon && "font-semibold text-amber-700", past && "text-gray-400")}>
                  {past ? "past" : inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${plural(inDays, "day")}`}
                </span>
              </span>
            </button>
            {(isBigEvent(e.type) || e.draft) && (
              <span className="flex shrink-0 flex-col items-end gap-1">
                {isBigEvent(e.type) && <Badge tone="amber">big</Badge>}
                {e.draft && (
                  <Badge tone="gray" title="Its month is still being planned – the date may change until the Events team fixes it.">
                    draft
                  </Badge>
                )}
              </span>
            )}
          </div>
          <Badge tone={desc?.tone ?? "gray"} className="font-medium">
            {desc?.label ?? e.description}
          </Badge>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{editable ? "Channels · drag onto a day" : "Channels"}</p>
            <span className="flex flex-wrap gap-1" data-testid={`coverage-${e.id}`}>
              {channels.map((c) => {
                const p = stateOn(c.key, e.id);
                const mark = !p ? "–" : p.status === "published" ? "✓" : `⏰ ${formatShortDate(p.at)}`;
                return (
                  <Draggable
                    key={c.key}
                    id={`chan|${c.key}|${e.id}`}
                    disabled={!editable}
                    testId={`chip-${c.key}-${e.id}`}
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 font-medium shadow-sm",
                      chipOf(c.key),
                      !p && c.required && !past && "border-dashed border-red-300 bg-red-50 text-red-800",
                      p?.status === "published" && "border-emerald-400 bg-emerald-50 text-emerald-800"
                    )}
                  >
                    <span title={`${c.name}: ${!p ? "not planned" : p.status === "published" ? "posted" : p.status}`}>
                      {SHORT[c.key] ?? c.name} {mark}
                    </span>
                  </Draggable>
                );
              })}
            </span>
          </div>
          {(pretix.enabled || editable) && (
            <div className="space-y-1 border-t border-gray-100 pt-1.5">
              {/* pretix is a chore of its own (round 2026-11-09): its page, linked from here. */}
              {pretix.enabled && (
                <Link
                  href={`/team/comms/pretix?event=${e.id}#pretix-${e.id}`}
                  className={cn("inline-flex items-center gap-1 hover:underline", pretix.done[e.id] ? "text-emerald-700" : past ? "text-gray-400" : "font-medium text-red-700")}
                  data-testid={`pretix-${e.id}`}
                >
                  {pretix.done[e.id] ? "pretix page ✓" : "pretix page not set up →"}
                </Link>
              )}
              {editable && <PlanMenu event={e} channels={channels} days={days} today={today} posts={posts} byId={byId} />}
            </div>
          )}
        </div>
      </li>
    );
  };
  const big = (list: BoardEvent[]) => list.filter((e) => isBigEvent(e.type)).length;
  return (
    <Card className="h-fit p-4 lg:sticky lg:top-4" data-testid="tray">
      <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
        Events
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 text-xs font-bold tabular-nums text-gray-700">{events.length}</span>
      </h2>
      <p className={cn("mb-3 text-xs", open.length ? "font-medium text-amber-800" : "text-emerald-700")}>{open.length ? `${open.length} upcoming still to plan or tick off` : "Every upcoming event is planned and ticked off"}</p>
      <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
        <input type="checkbox" className="accent-esn" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> only the ones still to do
      </label>
      <div className="space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1">
        {!own.events.length ? <p className="text-xs text-gray-500">Nothing to do this month.</p> : <ul className="space-y-2">{own.events.map(item)}</ul>}
        {/* Later months (round 2026-11-02): big ones first, the next month open. */}
        {later.map((g, i) =>
          g.events.length ? (
            <details key={g.month} open={i === 0 || g.events.some((e) => e.id === focus)} data-testid={`tray-later-${g.month.slice(0, 7)}`}>
              <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                Coming up: {monthLabel(g.month)} ({g.events.length}
                {big(g.events) ? `, ${big(g.events)} big` : ""}
                {g.events.some((e) => e.draft) ? `, ${g.events.filter((e) => e.draft).length} draft` : ""})
              </summary>
              <ul className="mt-2 space-y-2">{g.events.map(item)}</ul>
            </details>
          ) : null
        )}
      </div>
    </Card>
  );
}

type PlanRow = { channel: string; day: string; time: string; title: string; format: PostFormat | "" };

/**
 * The keyboard way to plan – and to plan a campaign (round 2026-11-09):
 * one or more posts of the event, each with its channel, day, time and
 * optionally a title and format, planned in one go; or the event added to
 * an existing post (bundle).
 */
function PlanMenu({ event, channels, days, today, posts, byId }: { event: BoardEvent; channels: BoardChannel[]; days: string[]; today: string; posts: BoardPost[]; byId: Map<string, BoardEvent> }) {
  const { run, pending, error } = useAction();
  const eventDay = berlinDate(event.startsAt);
  const minDay = eventDay < today ? undefined : today;
  // Any day up to the event (round 2026-11-02), in this month or a later one.
  const first: PlanRow = { channel: channels[0]?.key ?? "", day: defaultPostDay(days, today, eventDay), time: "10:00", title: "", format: "" };
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
  const candidates = posts.filter((p) => p.status !== "skipped" && !p.events.includes(event.id));
  const label = (what: string, i: number) => `${what} for ${event.title}${i ? ` (post ${i + 1})` : ""}`;
  const plan = () =>
    run(
      planEventPosts,
      { event_id: event.id, posts: rows.map((r) => ({ channel: r.channel, day: r.day, time: r.time, title: r.title.trim(), format: r.channel === "telegram" ? "" : r.format })) },
      () => setRows([first]),
      (r) => (r.made === 1 ? "Post planned." : `${r.made} posts planned for ${event.title}.`)
    );
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-esn">Plan…</summary>
      <div className="mt-1 grid min-w-0 gap-1.5 rounded-md border border-gray-200 bg-white p-2 shadow-sm" data-testid={`plan-${event.id}`}>
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
              {r.day && !days.includes(r.day) && <span className="text-gray-500">That day is on the {monthLabel(monthOf(`${r.day}T12:00:00Z`))} board.</span>}
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
                  {SHORT[p.channel] ?? p.channel} {formatShortDate(p.scheduledFor)}: {[p.title, ...p.events.map((id) => byId.get(id)?.title ?? "…")].filter(Boolean).join(", ")}
                </option>
              ))}
            </Select>
            {into && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(addToPost, { post_id: into, event_id: event.id }, () => setInto(""))}>
                Add to the post
              </Button>
            )}
          </span>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </details>
  );
}

/** A modal <dialog> for one post: Escape or the button closes it. */
function PostDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-gray-900/40"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
      data-testid="post-dialog"
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" className="ml-auto px-1 text-gray-500 hover:text-gray-900" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/**
 * A Telegram post as the channel will show it (round 2026-11-03): open by
 * default, one bubble per message (one per event, after the heading of a
 * post of several), each with its picture – its own, else the default of
 * its format or type – and a button to add, replace or remove it (saved at
 * once); then confirmed or posted from the same panel.
 */
function TelegramPanel({ post, postName, editable, byId }: { post: BoardPost; postName: string; editable: boolean; byId: Map<string, BoardEvent> }) {
  const { run, pending, error, setError, confirm } = useAction();
  const [uploading, setUploading] = useState<number | null>(null);
  const [note, setNote] = useState(post.note);
  const messages = post.preview ?? [];
  const canEdit = editable && post.status !== "skipped";

  async function upload(i: number, file: File) {
    setError(null);
    const problem = pictureProblem(file);
    if (problem) return setError(problem);
    setUploading(i);
    const path = `${post.id}/${crypto.randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const { error: e } = await supabase.storage.from("post-pictures").upload(path, file, { contentType: file.type });
    setUploading(null);
    if (e) return setError(`Upload failed: ${e.message}`);
    setPicture(messages[i], `upload:${path}`);
  }
  // The heading's picture is the post's; an event's is its own in this post.
  const setPicture = (m: PreviewMessage, picture: string) =>
    m.eventId ? run(setPostEventPicture, { post_id: post.id, event_id: m.eventId, picture }) : run(editPost, { post_id: post.id, picture, note: post.note });

  return (
    <div className="space-y-2 rounded border border-esn/30 bg-esn/5 p-2" data-testid="telegram-preview">
      <p className="font-medium text-esn-dark">
        This goes to the Telegram channel{messages.length > 1 ? ` as ${messages.length} messages` : ""}:
      </p>
      <ol className="max-h-[55vh] space-y-2 overflow-auto">
        {messages.map((m, i) => (
          <li key={i} className="space-y-1.5 rounded bg-white p-1.5 shadow-sm" data-testid="telegram-message">
            {messages.length > 1 && (
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-gray-400">
                {m.eventId && <EventDot color={byId.get(m.eventId)?.color} />}
                Message {i + 1}
                {m.eventId ? ` · ${byId.get(m.eventId)?.title ?? "Event"}` : " · heading"}
              </p>
            )}
            {m.picture && <UploadedPicture picture={m.picture} />}
            {m.picture && m.isDefault && <p className="text-xs text-gray-500">Default picture (Pictures tab)</p>}
            <pre className="whitespace-pre-wrap break-words font-sans text-xs text-gray-800">{m.text}</pre>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1.5" data-testid="telegram-picture">
                <PictureButton label={m.picture && !m.isDefault ? "Replace the picture" : "Add a picture"} disabled={uploading !== null || pending} onFile={(f) => upload(i, f)} />
                {m.picture && !m.isDefault && (
                  <button type="button" className="text-xs text-gray-600 hover:underline" disabled={pending} onClick={() => setPicture(m, "")}>
                    Remove the picture
                  </button>
                )}
                {uploading === i && <span className="text-xs text-gray-500">Uploading…</span>}
              </div>
            )}
          </li>
        ))}
        {!messages.length && <li className="text-gray-500">–</li>}
      </ol>
      {canEdit && post.events.length > 1 && (
        <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), run(editPost, { post_id: post.id, picture: post.picture ?? "", note }))}>
          <Input aria-label="Heading of the bundle" placeholder="Heading message, e.g. This week at ESN MESA (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {note.trim() !== post.note && (
            <Button size="sm" variant="outline" disabled={pending}>
              Save
            </Button>
          )}
        </form>
      )}
      {post.refusal && (
        <p className="text-amber-800" data-testid="telegram-refusal">
          {post.refusal} It can stay planned; confirm it once that is sorted – until then it does not go out.
        </p>
      )}
      {canEdit && !post.refusal && (
        <div className="flex flex-wrap gap-2">
          {post.status === "planned" && !post.confirmed && (
            <Button size="sm" disabled={pending || uploading !== null} onClick={() => run(confirmPost, { post_id: post.id })}>
              Confirm for {formatDateTime(post.scheduledFor)}
            </Button>
          )}
          <Button
            size="sm"
            variant={post.status === "published" ? "default" : "outline"}
            disabled={pending || uploading !== null}
            onClick={async () => {
              const again = post.status === "published";
              if (
                await confirm({
                  title: again ? "Edit the Telegram post now?" : "Post this to the Telegram channel now?",
                  body: again ? `The channel's messages for ${postName} are replaced with the preview.` : `${postName} goes out to everyone in the channel at once, not at its planned time.`,
                  confirmLabel: again ? "Edit the post" : "Post now",
                })
              )
                run(publishPostNow, { post_id: post.id }, undefined, again ? "Telegram post updated." : "Posted to the Telegram channel.");
            }}
          >
            {post.status === "published" ? "Post again (edits the messages)" : "Confirm and post now"}
          </Button>
        </div>
      )}
      {post.confirmed && post.status === "planned" && <p className="text-xs text-gray-500">Confirmed – it goes out by itself at its time. Any change takes the confirmation back.</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

function PostDetails({
  post,
  channel,
  byId,
  editable,
  team,
  viewerEmail,
}: {
  post: BoardPost;
  channel: BoardChannel;
  byId: Map<string, BoardEvent>;
  editable: boolean;
  team: TeamMember[];
  viewerEmail: string;
}) {
  const { run, pending, error, confirm } = useAction();
  // What a confirm dialog names (usability review #8).
  const postName = `the ${channel.name} post of ${formatDateTime(post.scheduledFor)} (${[post.title, ...post.events.map((id) => byId.get(id)?.title ?? "?")].filter(Boolean).join(", ")})`;
  const [mode, setMode] = useState<"" | "move" | "publish" | "skip">("");
  const [day, setDay] = useState(berlinDate(post.scheduledFor));
  const [time, setTime] = useState(berlinTime(post.scheduledFor));
  const [text, setText] = useState("");
  const telegram = channel.key === "telegram";
  const postDay = berlinDate(post.scheduledFor);
  const move = (i: number, by: number) => {
    const ids = [...post.events];
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    run(reorderPost, { post_id: post.id, event_ids: ids });
  };

  const badge =
    post.status === "published"
      ? { tone: "green" as const, text: "✓ posted" }
      : post.status === "skipped"
        ? { tone: "gray" as const, text: "⨯ skipped" }
        : telegram && !post.confirmed
          ? { tone: "amber" as const, text: `⏸ ${berlinTime(post.scheduledFor)} · not confirmed` }
          : { tone: "blue" as const, text: `⏰ ${berlinTime(post.scheduledFor)}${telegram ? " · confirmed" : ""}` };

  return (
    <div className="space-y-2 text-sm" data-testid={`post-details-${post.id}`}>
      <div className="flex items-center gap-2">
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {post.events.length > 1 && <span className="text-xs text-gray-500">{post.events.length} events</span>}
        {post.assignees.length > 0 && <span className="ml-auto truncate text-xs text-gray-500">By {namesOf(post.assignees, team)}</span>}
      </div>
      <ol className="space-y-1">
        {post.events.map((id, i) => {
          const ev = byId.get(id);
          const lead = ev ? leadTime(postDay, ev.startsAt) : null;
          return (
            <li key={id} className="flex items-center gap-1">
              <span className="min-w-0 grow">
                <span className="block truncate">{ev?.title ?? "Event"}</span>
                {lead && <span className={cn("block text-xs", lead.late ? "text-red-700" : "text-amber-800")}>📅 {formatShortDate(ev!.startsAt)} · {lead.text}</span>}
              </span>
              {editable && post.status !== "skipped" && (
                <span className="flex shrink-0 gap-0.5">
                  {i > 0 && (
                    <button type="button" aria-label="Move up" className="px-1 text-gray-500 hover:text-esn" onClick={() => move(i, -1)}>
                      ↑
                    </button>
                  )}
                  {i < post.events.length - 1 && (
                    <button type="button" aria-label="Move down" className="px-1 text-gray-500 hover:text-esn" onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  )}
                  <button type="button" aria-label={`Remove ${ev?.title ?? "event"}`} className="px-1 text-gray-500 hover:text-red-600" onClick={() => run(removeFromPost, { post_id: post.id, event_id: id })}>
                    ✕
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {post.status === "published" && post.link && (
        <a href={post.link} target="_blank" rel="noopener noreferrer" className="block truncate text-esn hover:underline">
          Open the post
        </a>
      )}
      {post.status === "skipped" && post.skipReason && <p className="text-gray-500">{post.skipReason}</p>}
      {post.lastError && (
        <p className="text-red-700" data-testid="post-error">
          {post.lastError}
        </p>
      )}
      {post.warnings.map((w) => (
        <p key={w} className="text-amber-800" data-testid="post-warning">
          ⚠ {w}
        </p>
      ))}
      {/* What Comms kept in their sheet (round 2026-11-09); Telegram's text comes from the descriptions. */}
      <ContentEditor key={`${post.id}:${post.progress}:${post.assignees.join()}`} post={post} team={team} editable={editable} viewerEmail={viewerEmail} />
      {/* Telegram: the preview first, with the picture and the buttons to post (round 2026-11-03). */}
      {telegram && post.status !== "skipped" && <TelegramPanel key={`${post.id}:${post.note}`} post={post} postName={postName} editable={editable} byId={byId} />}
      {editable && post.status !== "skipped" && (channel.kind === "manual" || post.status === "planned") && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-gray-100 pt-2">
          {channel.kind === "manual" && post.status === "planned" && (
            <button type="button" className="text-esn hover:underline" onClick={() => setMode(mode === "publish" ? "" : "publish")}>
              Mark posted
            </button>
          )}
          {post.status === "planned" && (
            <>
              <button type="button" className="text-esn hover:underline" onClick={() => setMode(mode === "move" ? "" : "move")}>
                Change day
              </button>
              <button type="button" className="text-gray-600 hover:underline" onClick={() => setMode(mode === "skip" ? "" : "skip")}>
                Skip
              </button>
              <button
                type="button"
                className="text-gray-600 hover:underline"
                onClick={async () => {
                  if (await confirm({ title: "Delete this post?", body: `Deletes ${postName}. An uploaded picture is removed too.`, confirmLabel: "Delete", danger: true }))
                    run(deletePost, { post_id: post.id }, undefined, "Post deleted.");
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {mode === "move" && (
        <form className="flex flex-wrap gap-1" onSubmit={(e) => (e.preventDefault(), run(movePost, { post_id: post.id, day, time }, () => setMode("")))}>
          <Input aria-label="New day" type="date" className="w-40" value={day} onChange={(e) => setDay(e.target.value)} />
          <Input aria-label="New time" type="time" className="w-28" value={time} onChange={(e) => setTime(e.target.value)} />
          <Button size="sm" disabled={pending}>
            Move
          </Button>
        </form>
      )}
      {mode === "publish" && (
        <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), run(markPostPublished, { post_id: post.id, link: text }, () => setMode("")))}>
          <Input aria-label="Link of the published post" placeholder="https://…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" disabled={pending}>
            Save link
          </Button>
        </form>
      )}
      {mode === "skip" && (
        <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), run(skipPost, { post_id: post.id, reason: text }, () => setMode("")))}>
          <Input aria-label="Why skip it" placeholder="e.g. the event is full" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" variant="outline" disabled={pending}>
            Skip
          </Button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

/**
 * An event on the calendar (round 2026-11-09): a label, not a card – its
 * dot, 📅 time and title, and a mark per required channel (✓ posted, the
 * channel planned, – missing while it is ahead). Click: only its posts.
 */
function EventLabel({
  event,
  color,
  required,
  coverage,
  today,
  active,
  muted,
  phone,
  onClick,
  onEnter,
  onLeave,
}: {
  event: BoardEvent;
  color?: string;
  required: BoardChannel[];
  coverage: Coverage;
  today: string;
  active: boolean;
  muted: boolean;
  phone: boolean;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const ahead = berlinDate(event.startsAt) >= today;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-pressed={active}
      title={`${event.title}${event.draft ? " (draft – the date may still change)" : ""} – click to see only its posts`}
      className={cn(
        "flex w-full min-w-0 items-start gap-1 rounded px-0.5 py-0.5 text-left text-[11px] leading-tight text-gray-600 hover:bg-amber-50 hover:text-gray-900",
        active && "bg-amber-100 text-gray-900 ring-1 ring-amber-400",
        muted && "opacity-60"
      )}
      data-testid={`cal-event-${event.id}`}
    >
      <EventDot color={color} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold tabular-nums text-gray-700">📅 {berlinTime(event.startsAt)}</span>
        {event.draft && <span className="ml-1 rounded bg-gray-100 px-0.5 text-[10px] uppercase tracking-wide text-gray-600">draft</span>}
        <span className={cn("block break-words", !phone && "line-clamp-2")}>{event.title}</span>
        {required.length > 0 && !muted && (
          <span className="mt-0.5 flex flex-wrap gap-0.5" data-testid={`cal-coverage-${event.id}`}>
            {required.map((c) => {
              const st = coverage[event.id]?.[c.key];
              return (
                <span
                  key={c.key}
                  className={cn(
                    "rounded px-0.5 text-[9px] font-semibold leading-3",
                    st?.status === "published" ? "bg-emerald-100 text-emerald-800" : st ? "bg-esn/10 text-esn" : ahead ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-500"
                  )}
                  title={`${c.name}: ${st?.status === "published" ? "posted" : st ? `planned ${formatShortDate(st.at)}` : "not planned"}`}
                >
                  {SHORT[c.key] ?? c.name}
                  {st?.status === "published" ? " ✓" : st ? "" : " –"}
                </span>
              );
            })}
          </span>
        )}
      </span>
    </button>
  );
}

const COL = 26;
const LABEL = 184;

/** A day column of the "By event" view: the drop target for chips and posts. */
function TimelineColumn({ day, index, today, editable }: { day: string; index: number; today: string; editable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `tday|${day}`, disabled: !editable });
  const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      className={cn("absolute bottom-0 top-0 border-l", day.endsWith("-01") ? "border-gray-300" : "border-gray-100", isOver ? "bg-esn/10" : day === today ? "bg-esn/5" : weekend ? "bg-gray-50" : "")}
      style={{ left: LABEL + index * COL, width: COL }}
    />
  );
}

/** A post on the "By event" view: square = post / reel, round = story; solid = posted, light = planned. */
function TimelineMarker({ post, eventId, editable, onOpen, dim, stack }: { post: BoardPost; eventId: string; editable: boolean; onOpen: () => void; dim: boolean; stack: number }) {
  const c = dotOf(post.channel);
  const unconfirmed = post.channel === "telegram" && post.status === "planned" && !post.confirmed;
  return (
    <Draggable id={`tpost|${post.id}|${eventId}`} disabled={!editable || post.status !== "planned"} className="absolute" testId={`tl-post-${post.id}-${eventId}`}>
      <button
        type="button"
        onClick={onOpen}
        title={`${post.title ? `${post.title} · ` : ""}${SHORT[post.channel] ?? post.channel} ${post.format ? FORMAT_LABEL[post.format].toLowerCase() : "post"} ${formatDateTime(post.scheduledFor)} – ${post.status === "published" ? "posted" : post.status === "skipped" ? "skipped" : unconfirmed ? "not confirmed" : "planned"}`}
        className={cn(
          "block h-3.5 w-3.5 border",
          post.format === "story" ? "rounded-full" : "rounded-[3px]",
          post.status === "published" ? c.solid : post.status === "skipped" ? "border-gray-300 bg-gray-100 opacity-60" : c.light,
          unconfirmed && "border-dashed",
          post.format === "reel" && "ring-1 ring-offset-1 ring-gray-400",
          dim && "opacity-30"
        )}
        style={{ transform: `translate(${(COL - 14) / 2}px, ${stack * 5}px)` }}
      />
    </Draggable>
  );
}

/**
 * "By event" (round 2026-11-09): one row per event, the days from the
 * month's first on; each post a marker on its day, the event a 📅 on its
 * own, a line from the first post to the event. Gaps and events without
 * posts stand out, and next month's events sit next to this month's posts.
 * Drop a channel chip on a day to plan, drag a marker to move the post.
 */
function Timeline({
  month,
  events,
  posts,
  today,
  editable,
  focus,
  setFocus,
  onOpen,
  dimmed,
}: {
  month: string;
  events: BoardEvent[];
  posts: BoardPost[];
  today: string;
  editable: boolean;
  focus: string | null;
  setFocus: (id: string | null) => void;
  onOpen: (id: string) => void;
  dimmed: (p: BoardPost) => boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Past events only while they have posts on the view.
  const rows = [...events]
    .filter((e) => berlinDate(e.startsAt) >= today || posts.some((p) => p.events.includes(e.id)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const lastMonthDay = calendarWeeks(month).flat().filter((d): d is string => !!d).pop()!;
  const lastEvent = rows.map((e) => berlinDate(e.startsAt)).sort().pop() ?? lastMonthDay;
  const end = [lastEvent, lastMonthDay].sort().pop()!;
  const count = Math.min(dayDiff(month, end) + 1, 120);
  const days = Array.from({ length: count }, (_, i) => addDays(month, i));
  const col = (d: string) => days.indexOf(d);
  const loose = posts.filter((p) => !p.events.length);
  useEffect(() => {
    // Open on today when it is on the view.
    const i = days.indexOf(today);
    if (i > 7 && scroller.current) scroller.current.scrollLeft = (i - 3) * COL;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, today]);

  const row = (key: string, label: React.ReactNode, own: BoardPost[], ev: BoardEvent | null) => {
    const evCol = ev ? col(berlinDate(ev.startsAt)) : -1;
    const cols = own.map((p) => col(berlinDate(p.scheduledFor))).filter((i) => i >= 0);
    const from = cols.length ? Math.min(...cols) : -1;
    const perDay = new Map<string, number>();
    const faded = !!focus && ev?.id !== focus;
    return (
      <div key={key} className={cn("relative flex h-9 items-center border-t border-gray-100", faded && "opacity-40")} data-testid={`tl-row-${key}`}>
        <div className="sticky left-0 z-20 flex h-full shrink-0 items-center border-r border-gray-200 bg-white pr-2" style={{ width: LABEL }}>
          {label}
        </div>
        <div className="relative h-full" style={{ width: days.length * COL }}>
          {ev && from >= 0 && evCol >= 0 && from < evCol && (
            <span aria-hidden="true" className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded-full opacity-30", ev.color ?? "bg-gray-300")} style={{ left: from * COL + COL / 2, width: (evCol - from) * COL }} />
          )}
          {ev && evCol >= 0 && (
            <span className="absolute top-1/2 z-10 -translate-y-1/2 text-[13px] leading-none" style={{ left: evCol * COL + 5 }} title={`${ev.title}: ${formatDateTime(ev.startsAt)}`} aria-hidden="true">
              📅
            </span>
          )}
          {own.map((p) => {
            const d = berlinDate(p.scheduledFor);
            const i = col(d);
            if (i < 0) return null;
            const stack = perDay.get(d) ?? 0;
            perDay.set(d, stack + 1);
            return (
              <div key={p.id} className="absolute top-1/2 z-10 -translate-y-1/2" style={{ left: i * COL }}>
                <TimelineMarker post={p} eventId={ev?.id ?? "none"} editable={editable} onOpen={() => onOpen(p.id)} dim={dimmed(p)} stack={stack} />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2" data-testid="timeline">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-[3px] border border-pink-500 bg-pink-100" /> post
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-full border border-pink-500 bg-pink-100" /> story
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-[3px] border border-pink-600 bg-pink-500" /> posted
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded-[3px] border border-sky-500 bg-sky-100" /> Telegram
        </span>
        <span>📅 the event · drop a channel chip on a day to plan, drag a marker to move it</span>
      </p>
      <div ref={scroller} className="overflow-x-auto rounded-lg border border-gray-200">
        <div className="relative" style={{ width: LABEL + days.length * COL }}>
          {days.map((d, i) => (
            <TimelineColumn key={d} day={d} index={i} today={today} editable={editable} />
          ))}
          <div className="relative flex h-8 items-end text-[10px] text-gray-500">
            <div className="sticky left-0 z-20 h-full shrink-0 border-r border-gray-200 bg-white" style={{ width: LABEL }} />
            {days.map((d) => (
              <span key={d} className={cn("relative shrink-0 pb-0.5 text-center tabular-nums", d === today && "font-bold text-esn")} style={{ width: COL }}>
                {(d.endsWith("-01") || d === days[0]) && (
                  <span className="absolute -top-0.5 left-0.5 whitespace-nowrap font-semibold uppercase text-gray-700">{monthLabel(`${d.slice(0, 7)}-01`).split(" ")[0]}</span>
                )}
                {Number(d.slice(8))}
              </span>
            ))}
          </div>
          {rows.map((e) =>
            row(
              e.id,
              <button
                type="button"
                onClick={() => setFocus(focus === e.id ? null : e.id)}
                className={cn("flex min-w-0 items-center gap-1.5 pl-2 text-left text-xs hover:text-esn", focus === e.id && "font-semibold text-esn")}
                title={e.title}
              >
                <EventDot color={e.color} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900">{e.title}</span>
                  <span className="block text-[10px] text-gray-500">
                    {formatShortDate(e.startsAt)}
                    {e.draft ? " · draft" : ""}
                    {!posts.some((p) => p.events.includes(e.id) && p.status !== "skipped") && berlinDate(e.startsAt) >= today ? <span className="font-semibold text-red-700"> · no posts</span> : null}
                  </span>
                </span>
              </button>,
              posts.filter((p) => p.events.includes(e.id)),
              e
            )
          )}
          {loose.length > 0 &&
            row(
              "none",
              <span className="pl-2 text-xs font-medium text-gray-600">Without an event</span>,
              loose,
              null
            )}
          {!rows.length && !loose.length && <p className="p-4 text-xs text-gray-500">No events or posts to show.</p>}
        </div>
      </div>
    </div>
  );
}
