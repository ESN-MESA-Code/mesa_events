"use client";

import { useEffect, useRef, useState } from "react";
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
  publishPostNow,
  removeFromPost,
  reorderPost,
  setPostEventPicture,
  setPretixReady,
  skipPost,
} from "@/app/actions/publishing";
import { DESCRIPTION_STATUS } from "@/components/status";
import { berlinDate, berlinTime, formatDateTime, formatShortDate, monthLabel, monthOf } from "@/lib/dates";
import { calendarWeeks, dayDiff } from "@/lib/month";
import { defaultPostDay, isBigEvent, trayGroups } from "@/lib/publishing";
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
 * pretix is not scheduled: a tick per event once its page is up.
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
  editable,
  viewer,
  today,
  coverage,
  pretix,
  initialFocus = null,
}: {
  month: string;
  channels: BoardChannel[];
  events: BoardEvent[];
  posts: BoardPost[];
  editable: boolean;
  viewer: { email: string; name: string };
  /** Berlin date; events before it are no longer advertised. */
  today: string;
  coverage: Coverage;
  pretix: PretixChecklist;
  /** An event to highlight (?event=… from the Comms page). */
  initialFocus?: string | null;
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [open, setOpen] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const [hover, setHover] = useState<string | null>(null);
  const colored = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((e, i) => ({ ...e, color: EVENT_COLORS[i % EVENT_COLORS.length] }));
  const byId = new Map(colored.map((e) => [e.id, e]));
  const channelOf = new Map(channels.map((c) => [c.key, c]));
  const weeks = calendarWeeks(month);
  const days = weeks.flat().filter((d): d is string => !!d);
  const focusDay = focus ? berlinDate(byId.get(focus)?.startsAt ?? "") : null;
  const opened = posts.find((p) => p.id === open) ?? null;

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
    const [kind, a, b] = String(e.active.id).replace(/^mpost\|/, "post|").split("|");
    const [target, x] = String(e.over.id).replace(/^mpost\|/, "post|").split("|");
    const postOf = (id: string) => posts.find((p) => p.id === id);
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

  const dayContent = (d: string, phone = false) => (
    <>
      {eventsOn(d).map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => setFocus(focus === e.id ? null : e.id)}
          onMouseEnter={() => setHover(e.id)}
          onMouseLeave={() => setHover(null)}
          className={cn("block w-full rounded bg-amber-100 px-1 py-0.5 text-left text-[11px] leading-tight text-amber-950 hover:bg-amber-200", focus === e.id && "ring-2 ring-amber-500")}
          aria-pressed={focus === e.id}
          data-testid={`cal-event-${e.id}`}
        >
          <EventDot color={byId.get(e.id)?.color} className="mr-1 align-middle" />
          📅 <span className="tabular-nums font-semibold">{berlinTime(e.startsAt)}</span> <span className="break-words">{e.title}</span>
        </button>
      ))}
      {postsOn(d).map((p) => (
        <PostChip key={p.id} post={p} byId={byId} editable={editable} focus={hover ?? focus} onOpen={() => setOpen(p.id)} phone={phone} />
      ))}
    </>
  );

  return (
    <DndContext id="publishing-board" sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="space-y-3">
        {others.length > 0 && <p className="text-xs text-gray-500">Also on the board: {others.join(", ")}</p>}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <EventList month={month} events={colored} setHover={setHover} today={today} channels={channels} coverage={coverage} pretix={pretix} days={days} posts={posts} editable={editable} byId={byId} focus={focus} setFocus={setFocus} />

          <Card className="p-3">
            <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600" data-testid="board-legend">
              <span>
                <span className="rounded bg-amber-100 px-1 text-amber-900">📅 Event</span> = when it takes place
              </span>
              <span>
                <EventDot color="bg-rose-500" className="align-middle" /> = one event: its dot is on its date and on every post advertising it (point at an event to see its posts)
              </span>
              {channels.map((c) => (
                <span key={c.key}>
                  <span className={cn("rounded border px-1", chipOf(c.key))}>{SHORT[c.key] ?? c.name}</span> = {c.name} post
                </span>
              ))}
              <span>⏸ = not confirmed yet (will not go out)</span>
              {pending && <span className="ml-auto text-gray-500">Saving…</span>}
            </p>
            {/* Desktop and tablet: the whole month at once. */}
            <div className="hidden sm:block" data-testid="schedule-board">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-gray-500">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {weeks.flat().map((d, i) =>
                  d ? (
                    <Day key={d} id={`day|${d}`} day={d} today={today} highlight={d === focusDay} disabled={!editable}>
                      {dayContent(d)}
                    </Day>
                  ) : (
                    <div key={`blank-${i}`} aria-hidden="true" />
                  )
                )}
              </div>
            </div>
            {/* Phones: the days with something on them, plus drop targets while dragging (their own ids). */}
            <ol className="space-y-1 sm:hidden">
              {days
                .filter((d) => eventsOn(d).length > 0 || postsOn(d).length > 0 || (!!dragging && d >= today))
                .map((d) => (
                  <li key={d}>
                    <Day id={`mday|${d}`} day={d} today={today} highlight={d === focusDay} disabled={!editable} wide>
                      {dayContent(d, true)}
                    </Day>
                  </li>
                ))}
            </ol>
            {editable && (
              <p className="mt-2 text-xs text-gray-500">
                Drag a channel chip of an event from the list onto a day to plan that post (10:00), or onto a post of the same channel to bundle them. Drag a post to another day to move it; click it for the preview, publishing and the rest. Keyboard: focus a chip, Space, arrow keys, Space – or “Plan…”.
              </p>
            )}
          </Card>
        </div>
      </div>
      {opened && (
        <PostDialog onClose={() => setOpen(null)} title={`${channelOf.get(opened.channel)?.name ?? opened.channel} post, ${formatDateTime(opened.scheduledFor)}`}>
          <PostDetails post={opened} channel={channelOf.get(opened.channel) ?? { key: opened.channel, name: opened.channel, kind: "manual", required: false }} byId={byId} editable={editable} />
        </PostDialog>
      )}
      <DragOverlay>{overlayText ? <div className="rounded-md border border-esn bg-white px-2 py-1 text-xs shadow-md">{overlayText}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function Day({ id, day, today, highlight, disabled, wide, children }: { id: string; day: string; today: string; highlight: boolean; disabled: boolean; wide?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      aria-label={formatShortDate(`${day}T12:00:00Z`)}
      data-testid={`${wide ? "mday" : "day"}-${day}`}
      className={cn(
        "min-w-0 rounded-md border p-1 space-y-1",
        wide ? "flex gap-2 space-y-0" : "min-h-20",
        isOver ? "border-esn bg-esn/10" : highlight ? "border-amber-400 bg-amber-50" : day < today ? "border-gray-100 bg-gray-50" : "border-gray-200 bg-white"
      )}
    >
      <p className={cn("text-[11px] font-semibold tabular-nums", wide && "w-14 shrink-0", day === today ? "text-esn" : "text-gray-500")}>{wide ? `${day.slice(8)}.${day.slice(5, 7)}.` : Number(day.slice(8))}</p>
      <div className={cn("space-y-1", wide && "min-w-0 flex-1")}>{children}</div>
    </div>
  );
}

/** A post on the calendar: drop a chip of its channel on it to bundle, drag it to move it, click it for the details. */
function PostChip({ post, byId, editable, focus, onOpen, phone }: { post: BoardPost; byId: Map<string, BoardEvent>; editable: boolean; focus: string | null; onOpen: () => void; phone: boolean }) {
  const id = `${phone ? "mpost" : "post"}|${post.id}`;
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !editable || post.status === "skipped" });
  const unconfirmed = post.channel === "telegram" && post.status === "planned" && !post.confirmed;
  const mark = post.status === "published" ? "✓" : post.status === "skipped" ? "⨯" : unconfirmed ? "⏸" : "⏰";
  const titles = post.events.map((id) => byId.get(id)?.title ?? "Event");
  const focused = !!focus && post.events.includes(focus);
  return (
    <div ref={setNodeRef} data-testid={`post-${post.id}`} className={cn("rounded", isOver && "ring-2 ring-esn", focused && "ring-2 ring-amber-500")}>
      <Draggable id={id} disabled={!editable || post.status !== "planned"}>
        <button
          type="button"
          onClick={onOpen}
          title={`${titles.join(", ")}${post.warnings.length ? `\n⚠ ${post.warnings.join("\n⚠ ")}` : ""}`}
          className={cn(
            "block w-full rounded border px-1 py-0.5 text-left text-[11px] leading-tight hover:brightness-95",
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
          <span className="font-semibold">{SHORT[post.channel] ?? post.channel}</span> <span className="tabular-nums">{berlinTime(post.scheduledFor)}</span> {mark}
          {post.warnings.length > 0 && (
            <span className="text-amber-700" aria-label="Has warnings">
              {" "}
              ⚠
            </span>
          )}
          <span className="block break-words">
            {titles.length > 1 ? `${titles.length}: ` : ""}
            {titles.join(", ")}
          </span>
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
  const open = events.filter((ev) => berlinDate(ev.startsAt) >= today && !isDone(ev));
  const [own, ...later] = trayGroups(events, month).map((g) => ({ ...g, events: todo ? g.events.filter((ev) => open.includes(ev)) : g.events }));
  const item = (e: BoardEvent) => {
    const past = berlinDate(e.startsAt) < today;
    return (
      <li
        key={e.id}
        data-testid={`tray-${e.id}`}
        onMouseEnter={() => setHover(e.id)}
        onMouseLeave={() => setHover(null)}
        className={cn("rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs shadow-sm", focus === e.id && "ring-2 ring-amber-500", past && "opacity-70")}
      >
        <button type="button" className="flex items-center gap-1.5 text-left font-medium text-gray-900 hover:text-esn" onClick={() => setFocus(focus === e.id ? null : e.id)}>
          <EventDot color={e.color} />
          {e.title}
          {isBigEvent(e.type) && (
            <Badge tone="amber" className="ml-1 align-middle">
              big
            </Badge>
          )}
        </button>
        <span className="block text-amber-800">
          📅 {formatShortDate(e.startsAt)}, {berlinTime(e.startsAt)}
        </span>
        <span className="block text-gray-500">{DESCRIPTION_STATUS[e.description]?.label ?? e.description}</span>
        <span className="mt-1 flex flex-wrap gap-1" data-testid={`coverage-${e.id}`}>
          {channels.map((c) => {
            const p = stateOn(c.key, e.id);
            const mark = !p ? "–" : p.status === "published" ? "✓" : `⏰ ${formatShortDate(p.at)}`;
            return (
              <Draggable
                key={c.key}
                id={`chan|${c.key}|${e.id}`}
                disabled={!editable}
                testId={`chip-${c.key}-${e.id}`}
                className={cn("rounded border px-1.5 py-0.5", chipOf(c.key), !p && c.required && "border-red-300 bg-red-50 text-red-800", p?.status === "published" && "border-emerald-400")}
              >
                <span title={`${c.name}: ${!p ? "not planned" : p.status === "published" ? "posted" : p.status}`}>
                  {SHORT[c.key] ?? c.name} {mark}
                </span>
              </Draggable>
            );
          })}
        </span>
        {pretix.enabled && <PretixTick event={e} state={pretix.done[e.id] ?? null} editable={editable} />}
        {editable && <PlanMenu event={e} channels={channels} days={days} today={today} posts={posts} byId={byId} />}
      </li>
    );
  };
  const big = (list: BoardEvent[]) => list.filter((e) => isBigEvent(e.type)).length;
  return (
    <Card className="h-fit p-3 lg:sticky lg:top-4" data-testid="tray">
      <h2 className="mb-1 text-sm font-semibold">Events ({events.length})</h2>
      <p className="mb-2 text-xs text-gray-600">{open.length ? `${open.length} upcoming still to plan or tick off` : "Every upcoming event is planned and ticked off"}</p>
      <label className="mb-2 flex items-center gap-1 text-xs text-gray-600">
        <input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> only the ones still to do
      </label>
      <div className="space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1">
        {!own.events.length ? <p className="text-xs text-gray-500">Nothing to do this month.</p> : <ul className="space-y-2">{own.events.map(item)}</ul>}
        {/* Later months (round 2026-11-02): big ones first, the next month open. */}
        {later.map((g, i) =>
          g.events.length ? (
            <details key={g.month} open={i === 0 || g.events.some((e) => e.id === focus)} data-testid={`tray-later-${g.month.slice(0, 7)}`}>
              <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                Coming up: {monthLabel(g.month)} ({g.events.length}
                {big(g.events) ? `, ${big(g.events)} big` : ""})
              </summary>
              <ul className="mt-2 space-y-2">{g.events.map(item)}</ul>
            </details>
          ) : null
        )}
      </div>
    </Card>
  );
}

/** pretix: ticked once the event's pretix page is up; the link (optional) goes under the event's Telegram message ("Sign up"). */
function PretixTick({ event, state, editable }: { event: BoardEvent; state: { link: string | null } | null; editable: boolean }) {
  const { run, pending, error } = useAction();
  const [link, setLink] = useState(state?.link ?? "");
  // The tick shows at once; it goes back if saving fails.
  const [ticked, setTicked] = useState<boolean | null>(null);
  const done = error ? !!state : (ticked ?? !!state);
  return (
    <div className="mt-1 space-y-1" data-testid={`pretix-${event.id}`}>
      <label className="flex items-center gap-1.5 text-gray-700">
        <input type="checkbox" checked={done} disabled={!editable || pending} aria-label={`pretix page of ${event.title} is up`} onChange={(e) => {
            const ready = e.target.checked;
            setTicked(ready);
            run(setPretixReady, { event_id: event.id, ready, link: ready ? link.trim() : "" }, () => setTicked(null));
          }}
        />
        <span className={cn(done && "text-emerald-800")}>pretix page is up{done && " ✓"}</span>
        {done && state?.link && (
          <a href={state.link} target="_blank" rel="noopener noreferrer" className="ml-auto text-esn hover:underline">
            open
          </a>
        )}
      </label>
      {done && editable && (
        <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), run(setPretixReady, { event_id: event.id, ready: true, link: link.trim() }))}>
          <Input aria-label={`pretix link of ${event.title}`} placeholder="https://pretix.eu/… (optional)" className="h-7 text-xs" value={link} onChange={(e) => setLink(e.target.value)} />
          {link.trim() !== (state?.link ?? "") && (
            <Button size="sm" variant="outline" disabled={pending} className="h-7">
              Save
            </Button>
          )}
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

/** The keyboard way to plan: a channel, day and time – or into an existing post (bundle). */
function PlanMenu({ event, channels, days, today, posts, byId }: { event: BoardEvent; channels: BoardChannel[]; days: string[]; today: string; posts: BoardPost[]; byId: Map<string, BoardEvent> }) {
  const { run, pending, error } = useAction();
  const [ch, setCh] = useState(channels[0]?.key ?? "");
  const eventDay = berlinDate(event.startsAt);
  // Any day up to the event (round 2026-11-02), in this month or a later one.
  const [day, setDay] = useState(defaultPostDay(days, today, eventDay));
  const [time, setTime] = useState("10:00");
  const [into, setInto] = useState("");
  const candidates = posts.filter((p) => p.channel === ch && p.status !== "skipped" && !p.events.includes(event.id));
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-esn">Plan…</summary>
      <div className="mt-1 grid gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">
        <Select aria-label={`Channel for ${event.title}`} value={ch} onChange={(e) => (setCh(e.target.value), setInto(""))}>
          {channels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label={`Post for ${event.title}`} value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">A new post</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              Add to {formatDateTime(p.scheduledFor)}: {p.events.map((id) => byId.get(id)?.title ?? "…").join(", ")}
            </option>
          ))}
        </Select>
        {!into && (
          <div className="flex gap-1">
            <Input aria-label={`Day for ${event.title}`} type="date" min={eventDay < today ? undefined : today} max={eventDay} value={day} onChange={(e) => setDay(e.target.value)} />
            <Input aria-label={`Time for ${event.title}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-24" />
          </div>
        )}
        {!into && day && !days.includes(day) && <span className="text-gray-500">That day is on the {monthLabel(monthOf(`${day}T12:00:00Z`))} board.</span>}
        <Button type="button" size="sm" disabled={pending} onClick={() => (into ? run(addToPost, { post_id: into, event_id: event.id }) : run(createPost, { channel: ch, day, time, event_ids: [event.id] }))}>
          {into ? "Add to the post" : "Plan the post"}
        </Button>
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

function PostDetails({ post, channel, byId, editable }: { post: BoardPost; channel: BoardChannel; byId: Map<string, BoardEvent>; editable: boolean }) {
  const { run, pending, error, confirm } = useAction();
  // What a confirm dialog names (usability review #8).
  const postName = `the ${channel.name} post of ${formatDateTime(post.scheduledFor)} (${post.events.map((id) => byId.get(id)?.title ?? "?").join(", ")})`;
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
