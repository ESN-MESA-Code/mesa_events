"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import {
  addToPost,
  confirmPost,
  createPost,
  deletePost,
  editPost,
  markPostPublished,
  movePost,
  planEverywhere,
  publishPostNow,
  removeFromPost,
  reorderPost,
  skipPost,
} from "@/app/actions/publishing";
import { DESCRIPTION_STATUS } from "@/components/status";
import { berlinDate, berlinTime, formatDateTime, formatShortDate } from "@/lib/dates";
import { dayDiff } from "@/lib/month";
import { uploadPath } from "@/lib/telegram/picture";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { isAre, plural } from "@/lib/plural";

export interface BoardChannel {
  key: string;
  name: string;
  kind: "auto" | "manual";
  /** Every event is published here (Telegram, Instagram, pretix). */
  required: boolean;
}

export interface BoardEvent {
  id: string;
  title: string;
  startsAt: string;
  /** Description status ("missing" when none). */
  description: string;
}

/** An event's best post per channel, from every month (published wins over planned). */
export type Coverage = Record<string, Record<string, { status: "planned" | "published"; at: string }>>;

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
  /** Telegram: the text as it will be posted (plain). */
  preview: string | null;
}

const WEEKDAY = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const ALL = "__all";
const SHORT: Record<string, string> = { telegram: "TG", instagram: "IG", pretix: "pretix" };

/** "in 3 days", "on the day", "2 days after!" – a post's day relative to its event. */
function leadTime(postDay: string, eventStart: string): { text: string; late: boolean } {
  const d = dayDiff(postDay, berlinDate(eventStart));
  if (d === 0) return { text: "on the event day", late: false };
  if (d < 0) return { text: `${-d} d after the event`, late: true };
  return { text: `${d} d before`, late: false };
}

/**
 * The publishing schedule (brief 2026-10-29, E3; round 2026-10-30): the
 * month's days across, a row with the events on their dates (📅), an "All
 * channels" lane and one lane per channel. Every event belongs on the
 * required channels (Telegram, Instagram, pretix): dropping it on "All
 * channels" plans it on each of them it is missing from, on one day; a lane
 * plans just that channel. Drag a post to another day to move it, an event
 * of a post back to the tray to take it out. Click an event to highlight
 * its date and all its posts. Telegram posts go out only after Comms
 * confirmed them in the preview.
 */
export function ScheduleBoard({
  days,
  channels,
  events,
  posts,
  editable,
  viewer,
  today,
  coverage,
}: {
  days: string[];
  channels: BoardChannel[];
  events: BoardEvent[];
  posts: BoardPost[];
  editable: boolean;
  viewer: { email: string; name: string };
  /** Berlin date; events before it are no longer advertised. */
  today: string;
  coverage: Coverage;
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const byId = new Map(events.map((e) => [e.id, e]));
  const required = channels.filter((c) => c.required);
  const stateOn = (channel: string, eventId: string) => coverage[eventId]?.[channel] ?? null;
  const focusDay = focus ? berlinDate(byId.get(focus)?.startsAt ?? "") : null;

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

  function plan(channel: string, day: string, eventId: string, after?: () => void) {
    if (channel === ALL) run(planEverywhere, { event_id: eventId, day }, after);
    else run(createPost, { channel, day, event_ids: [eventId] }, after);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (!e.over || !editable) return;
    const [kind, a, b] = String(e.active.id).split("|");
    const [target, x, y] = String(e.over.id).split("|");
    const postOf = (id: string) => posts.find((p) => p.id === id)!;
    if (kind === "event") {
      if (target === "cell") plan(x, y, a);
      else if (target === "post") run(addToPost, { post_id: x, event_id: a });
    } else if (kind === "post" && target === "cell") {
      const p = postOf(a);
      if (p.channel !== x) return setError("A post stays on its channel – plan a new one on the other lane.");
      if (berlinDate(p.scheduledFor) !== y) run(movePost, { post_id: a, day: y, time: berlinTime(p.scheduledFor) });
    } else if (kind === "item") {
      if (target === "tray") run(removeFromPost, { post_id: a, event_id: b });
      else if (target === "post" && x !== a) run(addToPost, { post_id: x, event_id: b }, () => run(removeFromPost, { post_id: a, event_id: b }));
      else if (target === "cell" && x !== ALL) run(createPost, { channel: x, day: y, event_ids: [b] }, () => run(removeFromPost, { post_id: a, event_id: b }));
    }
  }

  const overlay = dragging ? dragging.split("|") : null;
  const overlayText = overlay ? (overlay[0] === "event" ? byId.get(overlay[1])?.title : overlay[0] === "item" ? byId.get(overlay[2])?.title : "Post") : null;
  const eventsOn = (d: string) => events.filter((e) => berlinDate(e.startsAt) === d);

  return (
    <DndContext id="publishing-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="space-y-4">
        {others.length > 0 && <p className="text-xs text-gray-500">Also on the board: {others.join(", ")}</p>}
        {error && <Alert tone="error">{error}</Alert>}
        {pending && <p className="text-xs text-gray-500">Saving…</p>}

        <Tray events={events} today={today} required={required} channels={channels} stateOn={stateOn} days={days} posts={posts} editable={editable} byId={byId} focus={focus} setFocus={setFocus} />

        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600" data-testid="board-legend">
          <span>
            <span className="rounded bg-amber-100 px-1 text-amber-900">📅 Event</span> = when it takes place
          </span>
          <span>
            <span className="rounded bg-esn/10 px-1 text-esn-dark">⏰ Post</span> = when it is advertised
          </span>
          <span>⏸ = Telegram post not confirmed yet (it will not go out)</span>
          <span>Click an event to highlight its date and posts.</span>
        </p>

        <div className="overflow-x-auto rounded-md border border-gray-200" data-testid="schedule-board">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-gray-500">Day</th>
                {days.map((d) => (
                  <th key={d} className={cn("min-w-[8.5rem] border-l border-gray-100 px-2 py-1 text-left font-medium text-gray-600", d === focusDay && "bg-amber-100 text-amber-900")}>
                    {WEEKDAY(d)} {Number(d.slice(8))}.
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr data-testid="lane-events">
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left align-top font-medium text-amber-900">📅 Events</th>
                {days.map((d) => (
                  <td key={d} className={cn("border-l border-t border-gray-100 p-1 align-top", d === focusDay && "bg-amber-50")}>
                    <div className="space-y-1">
                      {eventsOn(d).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setFocus(focus === e.id ? null : e.id)}
                          className={cn("block w-full rounded bg-amber-100 px-1.5 py-0.5 text-left text-amber-950 hover:bg-amber-200", focus === e.id && "ring-2 ring-amber-500")}
                          aria-pressed={focus === e.id}
                        >
                          <span className="tabular-nums">{berlinTime(e.startsAt)}</span> {e.title}
                        </button>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
              {required.length > 0 && (
                <tr data-testid={`lane-${ALL}`}>
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left align-top font-medium text-esn-dark">
                    All {required.length} channels
                    <span className="block font-normal text-gray-500">{required.map((c) => c.name).join(", ")}</span>
                  </th>
                  {days.map((d) => (
                    <Cell key={d} id={`cell|${ALL}|${d}`} label={`All channels, ${formatShortDate(`${d}T12:00:00Z`)}`} disabled={!editable} highlight={d === focusDay}>
                      <span className="block min-h-6 text-[10px] text-gray-400">{editable ? "drop: plan everywhere" : ""}</span>
                    </Cell>
                  ))}
                </tr>
              )}
              {channels.map((c) => (
                <tr key={c.key} data-testid={`lane-${c.key}`}>
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left align-top font-medium text-gray-700">
                    {c.name}
                    {!c.required && <span className="block font-normal text-gray-500">optional</span>}
                  </th>
                  {days.map((d) => (
                    <Cell key={d} id={`cell|${c.key}|${d}`} label={`${c.name}, ${formatShortDate(`${d}T12:00:00Z`)}`} disabled={!editable} highlight={d === focusDay}>
                      {posts
                        .filter((p) => p.channel === c.key && berlinDate(p.scheduledFor) === d)
                        .map((p) => (
                          <PostCard key={p.id} post={p} channel={c} byId={byId} editable={editable} focus={focus} setFocus={setFocus} />
                        ))}
                    </Cell>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <DragOverlay>{overlayText ? <div className="rounded-md border border-esn bg-white px-2 py-1 text-xs shadow-md">{overlayText}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function Cell({ id, label, children, disabled, highlight }: { id: string; label: string; children: React.ReactNode; disabled: boolean; highlight?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <td
      ref={setNodeRef}
      aria-label={label}
      data-testid={`cell-${id.split("|").slice(1).join("-")}`}
      className={cn("h-16 border-l border-t border-gray-100 p-1 align-top", highlight && "bg-amber-50", isOver && "bg-esn/10")}
    >
      <div className="space-y-1">{children}</div>
    </td>
  );
}

function Draggable({ id, disabled, className, children, testId }: { id: string; disabled: boolean; className?: string; children: React.ReactNode; testId?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} data-testid={testId} className={cn(className, !disabled && "cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}>
      {children}
    </div>
  );
}

/** The month's events with their coverage on the required channels; the ones not on all of them first. */
function Tray({
  events,
  today,
  required,
  channels,
  stateOn,
  days,
  posts,
  editable,
  byId,
  focus,
  setFocus,
}: {
  events: BoardEvent[];
  today: string;
  required: BoardChannel[];
  channels: BoardChannel[];
  stateOn: (channel: string, eventId: string) => { status: "planned" | "published"; at: string } | null;
  days: string[];
  posts: BoardPost[];
  editable: boolean;
  byId: Map<string, BoardEvent>;
  focus: string | null;
  setFocus: (id: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray", disabled: !editable });
  const [showAll, setShowAll] = useState(false);
  const isCovered = (ev: BoardEvent) => required.every((c) => stateOn(c.key, ev.id));
  // Events that already took place are not advertised any more.
  const open = events.filter((ev) => berlinDate(ev.startsAt) >= today && !isCovered(ev));
  const shown = showAll ? events : open;
  return (
    <section ref={setNodeRef} aria-label="Events and their channels" className={cn("rounded-md border border-dashed p-3 space-y-2", isOver ? "border-esn bg-esn/5" : "border-gray-300")} data-testid="tray">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-900">
          {open.length ? `${plural(open.length, "upcoming event")} ${isAre(open.length)} not on all channels yet` : "Every upcoming event is planned on all channels"}
        </span>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show all
        </label>
        <span className="text-xs text-gray-500">Drag an event onto “All channels” (or one lane), or use “Plan…”. Drop an event of a post here to take it out.</span>
      </div>
      {!shown.length ? (
        <p className="text-xs text-gray-500">Nothing left to plan this month.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {shown.map((e) => (
            <li key={e.id} className={cn("rounded-md", focus === e.id && "ring-2 ring-amber-500")}>
              <Draggable id={`event|${e.id}`} disabled={!editable} testId={`tray-${e.id}`} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm">
                <button type="button" className="text-left font-medium text-gray-900 hover:text-esn" onClick={() => setFocus(focus === e.id ? null : e.id)}>
                  {e.title}
                </button>
                <span className="block text-amber-800">📅 {formatShortDate(e.startsAt)}</span>
                <span className="block text-gray-500">{DESCRIPTION_STATUS[e.description]?.label ?? e.description}</span>
                <span className="mt-0.5 flex flex-wrap gap-1" data-testid={`coverage-${e.id}`}>
                  {required.map((c) => {
                    const p = stateOn(c.key, e.id);
                    const mark = !p ? "–" : p.status === "published" ? "✓" : `⏰ ${formatShortDate(p.at)}`;
                    return (
                      <span key={c.key} className={cn("rounded px-1", !p ? "bg-red-50 text-red-700" : p.status === "published" ? "bg-emerald-50 text-emerald-800" : "bg-esn/10 text-esn-dark")} title={c.name}>
                        {SHORT[c.key] ?? c.name} {mark}
                      </span>
                    );
                  })}
                </span>
              </Draggable>
              {editable && <PlanMenu event={e} channels={channels} hasRequired={required.length > 0} days={days} posts={posts} byId={byId} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The keyboard way to plan: all channels or one, day and time – or into an existing post (bundle). */
function PlanMenu({ event, channels, hasRequired, days, posts, byId }: { event: BoardEvent; channels: BoardChannel[]; hasRequired: boolean; days: string[]; posts: BoardPost[]; byId: Map<string, BoardEvent> }) {
  const { run, pending, error } = useAction();
  const [ch, setCh] = useState(hasRequired ? ALL : (channels[0]?.key ?? ""));
  const eventDay = berlinDate(event.startsAt);
  const [day, setDay] = useState([...days].reverse().find((d) => d <= eventDay && dayDiff(d, eventDay) >= 3) ?? days[0]);
  const [time, setTime] = useState("10:00");
  const [into, setInto] = useState("");
  const candidates = ch === ALL ? [] : posts.filter((p) => p.channel === ch && p.status !== "skipped" && !p.events.includes(event.id));
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-esn">Plan…</summary>
      <div className="mt-1 grid gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">
        <Select aria-label={`Channel for ${event.title}`} value={ch} onChange={(e) => (setCh(e.target.value), setInto(""))}>
          {hasRequired && <option value={ALL}>All required channels</option>}
          {channels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </Select>
        {ch !== ALL && (
          <Select aria-label={`Post for ${event.title}`} value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">A new post</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                Add to {formatDateTime(p.scheduledFor)}: {p.events.map((id) => byId.get(id)?.title ?? "…").join(", ")}
              </option>
            ))}
          </Select>
        )}
        {!into && (
          <div className="flex gap-1">
            <Input aria-label={`Day for ${event.title}`} type="date" min={days[0]} max={days.at(-1)} value={day} onChange={(e) => setDay(e.target.value)} />
            <Input aria-label={`Time for ${event.title}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-24" />
          </div>
        )}
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            into
              ? run(addToPost, { post_id: into, event_id: event.id })
              : ch === ALL
                ? run(planEverywhere, { event_id: event.id, day, time })
                : run(createPost, { channel: ch, day, time, event_ids: [event.id] })
          }
        >
          {into ? "Add to the post" : ch === ALL ? "Plan on every channel" : "Plan the post"}
        </Button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </details>
  );
}

/** A picture uploaded for a Telegram post, shown from the private bucket. */
function UploadedPicture({ picture }: { picture: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const path = uploadPath(picture);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    supabase.storage
      .from("post-pictures")
      .createSignedUrl(path, 600)
      .then(({ data }) => alive && setUrl(data?.signedUrl ?? null));
    return () => {
      alive = false;
    };
  }, [path]);
  if (!path) return picture ? <p className="truncate text-gray-500">🖼 {picture}</p> : null;
  // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL of a private file
  return url ? <img src={url} alt="Picture of the post" className="max-h-40 rounded border border-gray-200 object-contain" /> : <p className="text-gray-500">🖼 Loading the picture…</p>;
}

function PostCard({
  post,
  channel,
  byId,
  editable,
  focus,
  setFocus,
}: {
  post: BoardPost;
  channel: BoardChannel;
  byId: Map<string, BoardEvent>;
  editable: boolean;
  focus: string | null;
  setFocus: (id: string | null) => void;
}) {
  const { run, pending, error, setError } = useAction();
  const { setNodeRef, isOver } = useDroppable({ id: `post|${post.id}`, disabled: !editable || post.status === "skipped" });
  const [mode, setMode] = useState<"" | "move" | "edit" | "publish" | "skip" | "preview">("");
  const [day, setDay] = useState(berlinDate(post.scheduledFor));
  const [time, setTime] = useState(berlinTime(post.scheduledFor));
  const [text, setText] = useState("");
  const [picture, setPicture] = useState(post.picture ?? "");
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState(post.note);
  const telegram = channel.key === "telegram";
  const postDay = berlinDate(post.scheduledFor);
  const move = (i: number, by: number) => {
    const ids = [...post.events];
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    run(reorderPost, { post_id: post.id, event_ids: ids });
  };

  async function upload(file: File) {
    setError(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError("Telegram takes JPG, PNG or WebP pictures (no HEIC).");
    if (file.size > 10 * 1024 * 1024) return setError("The picture is larger than 10 MB – use a smaller copy.");
    setUploading(true);
    const path = `${post.id}/${crypto.randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const { error: e } = await supabase.storage.from("post-pictures").upload(path, file, { contentType: file.type });
    setUploading(false);
    if (e) return setError(`Upload failed: ${e.message}`);
    setPicture(`upload:${path}`);
  }

  const badge =
    post.status === "published"
      ? { tone: "green" as const, text: "✓ published" }
      : post.status === "skipped"
        ? { tone: "gray" as const, text: "⨯ skipped" }
        : telegram && !post.confirmed
          ? { tone: "amber" as const, text: `⏸ ${berlinTime(post.scheduledFor)} · not confirmed` }
          : { tone: "blue" as const, text: `⏰ ${berlinTime(post.scheduledFor)}${telegram ? " · confirmed" : ""}` };
  const focused = !!focus && post.events.includes(focus);

  return (
    <div
      ref={setNodeRef}
      className={cn("rounded-md border bg-white p-1.5 shadow-sm space-y-1", isOver ? "border-esn" : "border-gray-200", post.status === "skipped" && "opacity-70", focused && "ring-2 ring-amber-500")}
      data-testid={`post-${post.id}`}
    >
      <Draggable id={`post|${post.id}`} disabled={!editable || post.status !== "planned"} className="flex items-center gap-1">
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {post.events.length > 1 && <span className="text-gray-500">{post.events.length} events</span>}
      </Draggable>
      <ol className="space-y-0.5">
        {post.events.map((id, i) => {
          const ev = byId.get(id);
          const lead = ev ? leadTime(postDay, ev.startsAt) : null;
          return (
            <li key={id} className="flex items-center gap-1">
              <Draggable id={`item|${post.id}|${id}`} disabled={!editable || post.status === "skipped"} className="min-w-0 grow" testId={`item-${post.id}-${id}`}>
                <button type="button" className="block w-full truncate text-left hover:text-esn" onClick={() => setFocus(focus === id ? null : id)}>
                  {ev?.title ?? "Event"}
                </button>
                {lead && <span className={cn("block text-[10px]", lead.late ? "text-red-700" : "text-amber-800")}>📅 {formatShortDate(ev!.startsAt)} · {lead.text}</span>}
              </Draggable>
              {editable && post.status !== "skipped" && (
                <span className="flex shrink-0 gap-0.5">
                  {i > 0 && (
                    <button type="button" aria-label="Move up" className="px-0.5 text-gray-500 hover:text-esn" onClick={() => move(i, -1)}>
                      ↑
                    </button>
                  )}
                  {i < post.events.length - 1 && (
                    <button type="button" aria-label="Move down" className="px-0.5 text-gray-500 hover:text-esn" onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  )}
                  <button type="button" aria-label={`Remove ${ev?.title ?? "event"}`} className="px-0.5 text-gray-500 hover:text-red-600" onClick={() => run(removeFromPost, { post_id: post.id, event_id: id })}>
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
      {post.lastError && <p className="text-red-700" data-testid="post-error">{post.lastError}</p>}
      {post.warnings.map((w) => (
        <p key={w} className="text-amber-800" data-testid="post-warning">
          ⚠ {w}
        </p>
      ))}
      {editable && post.status !== "skipped" && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {telegram && (
            <>
              <button type="button" className="font-medium text-esn hover:underline" onClick={() => setMode(mode === "preview" ? "" : "preview")}>
                {post.status === "published" ? "Preview & publish again" : post.confirmed ? "Preview" : "Preview & confirm"}
              </button>
              <button type="button" className="text-esn hover:underline" onClick={() => setMode(mode === "edit" ? "" : "edit")}>
                Picture & heading
              </button>
            </>
          )}
          {channel.kind === "manual" && post.status === "planned" && (
            <button type="button" className="text-esn hover:underline" onClick={() => setMode(mode === "publish" ? "" : "publish")}>
              Mark published
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
              <button type="button" className="text-gray-600 hover:underline" onClick={() => window.confirm("Delete this post?") && run(deletePost, { post_id: post.id })}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {mode === "preview" && (
        <div className="space-y-1.5 rounded border border-esn/30 bg-esn/5 p-1.5" data-testid="telegram-preview">
          <p className="font-medium text-esn-dark">This goes to the Telegram channel:</p>
          <UploadedPicture picture={post.picture} />
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-1.5 font-sans text-[11px] text-gray-800">{post.preview ?? "–"}</pre>
          {post.status === "planned" && !post.confirmed && (
            <Button size="sm" disabled={pending} onClick={() => run(confirmPost, { post_id: post.id }, () => setMode(""))}>
              Confirm for {formatDateTime(post.scheduledFor)}
            </Button>
          )}
          <Button
            size="sm"
            variant={post.status === "published" ? "default" : "outline"}
            disabled={pending}
            onClick={() =>
              window.confirm(post.status === "published" ? "Edit the published Telegram post now?" : "Post this to the Telegram channel now?") && run(publishPostNow, { post_id: post.id }, () => setMode(""))
            }
          >
            {post.status === "published" ? "Publish again (edits the post)" : "Confirm and publish now"}
          </Button>
          {post.confirmed && post.status === "planned" && <p className="text-[10px] text-gray-500">Confirmed – it goes out by itself at its time. Any change takes the confirmation back.</p>}
        </div>
      )}
      {mode === "move" && (
        <form className="grid gap-1" onSubmit={(e) => (e.preventDefault(), run(movePost, { post_id: post.id, day, time }, () => setMode("")))}>
          <Input aria-label="New day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <Input aria-label="New time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Button size="sm" disabled={pending}>
            Move
          </Button>
        </form>
      )}
      {mode === "publish" && (
        <form className="grid gap-1" onSubmit={(e) => (e.preventDefault(), run(markPostPublished, { post_id: post.id, link: text }, () => setMode("")))}>
          <Input aria-label="Link of the published post" placeholder="https://…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" disabled={pending}>
            Save link
          </Button>
        </form>
      )}
      {mode === "skip" && (
        <form className="grid gap-1" onSubmit={(e) => (e.preventDefault(), run(skipPost, { post_id: post.id, reason: text }, () => setMode("")))}>
          <Input aria-label="Why skip it" placeholder="e.g. no pretix for free events" value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" variant="outline" disabled={pending}>
            Skip
          </Button>
        </form>
      )}
      {mode === "edit" && (
        <form className="grid gap-1" onSubmit={(e) => (e.preventDefault(), run(editPost, { post_id: post.id, picture, note }, () => setMode("")))}>
          <label className="text-gray-600">
            Picture (JPG, PNG or WebP, up to 10 MB – kept until the post is out)
            <input
              aria-label="Upload a picture"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="mt-0.5 block w-full text-[11px]"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
          {uploading && <p className="text-gray-500">Uploading…</p>}
          {picture && <UploadedPicture picture={picture} />}
          {picture && (
            <button type="button" className="justify-self-start text-gray-600 hover:underline" onClick={() => setPicture("")}>
              Remove the picture
            </button>
          )}
          {post.events.length > 1 && <Input aria-label="Heading of the bundle" placeholder="e.g. This week at ESN MESA" value={note} onChange={(e) => setNote(e.target.value)} />}
          <Button size="sm" disabled={pending || uploading}>
            Save
          </Button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
