"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { addToPost, createPost, deletePost, editPost, markPostPublished, movePost, publishPostNow, removeFromPost, reorderPost, skipPost } from "@/app/actions/publishing";
import { DESCRIPTION_STATUS } from "@/components/status";
import { berlinDate, berlinTime, formatDateTime, formatShortDate } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface BoardChannel {
  key: string;
  name: string;
  kind: "auto" | "manual";
}

export interface BoardEvent {
  id: string;
  title: string;
  startsAt: string;
  /** Description status ("missing" when none). */
  description: string;
}

export interface BoardPost {
  id: string;
  channel: string;
  scheduledFor: string;
  status: "planned" | "published" | "skipped";
  link: string | null;
  picture: string | null;
  note: string;
  skipReason: string | null;
  lastError: string | null;
  publishedAt: string | null;
  /** Event ids in the post's order. */
  events: string[];
  warnings: string[];
}

const WEEKDAY = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

/**
 * The publishing schedule (brief 2026-10-29, E3): one lane per channel, the
 * month's days across (scrolling sideways inside the board on phones), the
 * month's events in a tray. Drag an event onto a day to plan a post, onto a
 * post to bundle it, a post to another day to move it, an event of a post
 * back to the tray to take it out. Every move also has a button ("Plan…",
 * "Move to…", ↑ ↓, Remove) for keyboards and phones.
 */
export function ScheduleBoard({
  days,
  channels,
  events,
  posts,
  editable,
  viewer,
}: {
  days: string[];
  channels: BoardChannel[];
  events: BoardEvent[];
  posts: BoardPost[];
  editable: boolean;
  viewer: { email: string; name: string };
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useAction();
  const [trayChannel, setTrayChannel] = useState(channels[0]?.key ?? "");
  const [dragging, setDragging] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const byId = new Map(events.map((e) => [e.id, e]));
  const planned = (channel: string, eventId: string) => posts.some((p) => p.channel === channel && p.status !== "skipped" && p.events.includes(eventId));
  const tray = events.filter((e) => !planned(trayChannel, e.id));

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
    const [kind, a, b] = String(e.active.id).split("|");
    const [target, x, y] = String(e.over.id).split("|");
    const postOf = (id: string) => posts.find((p) => p.id === id)!;
    if (kind === "event") {
      if (target === "cell") run(createPost, { channel: x, day: y, event_ids: [a] });
      else if (target === "post") run(addToPost, { post_id: x, event_id: a });
    } else if (kind === "post" && target === "cell") {
      const p = postOf(a);
      if (p.channel !== x) return setError("A post stays on its channel – plan a new one on the other lane.");
      if (berlinDate(p.scheduledFor) !== y) run(movePost, { post_id: a, day: y, time: berlinTime(p.scheduledFor) });
    } else if (kind === "item") {
      if (target === "tray") run(removeFromPost, { post_id: a, event_id: b });
      else if (target === "post" && x !== a) run(addToPost, { post_id: x, event_id: b }, () => run(removeFromPost, { post_id: a, event_id: b }));
      else if (target === "cell") run(createPost, { channel: x, day: y, event_ids: [b] }, () => run(removeFromPost, { post_id: a, event_id: b }));
    }
  }

  const overlay = dragging ? dragging.split("|") : null;
  const overlayText = overlay ? (overlay[0] === "event" ? byId.get(overlay[1])?.title : overlay[0] === "item" ? byId.get(overlay[2])?.title : "Post") : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="space-y-4">
        {others.length > 0 && <p className="text-xs text-gray-500">Also on the board: {others.join(", ")}</p>}
        {error && <Alert tone="error">{error}</Alert>}
        {pending && <p className="text-xs text-gray-500">Saving…</p>}

        <Tray events={tray} channels={channels} channel={trayChannel} setChannel={setTrayChannel} days={days} posts={posts} editable={editable} byId={byId} />

        <div className="overflow-x-auto rounded-md border border-gray-200" data-testid="schedule-board">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-gray-500">Channel</th>
                {days.map((d) => (
                  <th key={d} className="min-w-[8.5rem] border-l border-gray-100 px-2 py-1 text-left font-medium text-gray-600">
                    {WEEKDAY(d)} {Number(d.slice(8))}.
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.key} data-testid={`lane-${c.key}`}>
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left align-top font-medium text-gray-700">{c.name}</th>
                  {days.map((d) => (
                    <Cell key={d} id={`cell|${c.key}|${d}`} label={`${c.name}, ${formatShortDate(`${d}T12:00:00Z`)}`} disabled={!editable}>
                      {posts
                        .filter((p) => p.channel === c.key && berlinDate(p.scheduledFor) === d)
                        .map((p) => (
                          <PostCard key={p.id} post={p} channel={c} byId={byId} editable={editable} />
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

function Cell({ id, label, children, disabled }: { id: string; label: string; children: React.ReactNode; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <td ref={setNodeRef} aria-label={label} data-testid={`cell-${id.split("|").slice(1).join("-")}`} className={cn("h-16 border-l border-t border-gray-100 p-1 align-top", isOver && "bg-esn/10")}>
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

function Tray({
  events,
  channels,
  channel,
  setChannel,
  days,
  posts,
  editable,
  byId,
}: {
  events: BoardEvent[];
  channels: BoardChannel[];
  channel: string;
  setChannel: (c: string) => void;
  days: string[];
  posts: BoardPost[];
  editable: boolean;
  byId: Map<string, BoardEvent>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray", disabled: !editable });
  return (
    <section ref={setNodeRef} aria-label="Events not planned yet" className={cn("rounded-md border border-dashed p-3 space-y-2", isOver ? "border-esn bg-esn/5" : "border-gray-300")} data-testid="tray">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-900">Not planned yet on</span>
        <Select aria-label="Tray channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="w-auto">
          {channels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </Select>
        <span className="text-xs text-gray-500">Drag an event onto a day, or use “Plan…”. Drop an event of a post here to take it out.</span>
      </div>
      {!events.length ? (
        <p className="text-xs text-gray-500">Every event of the month is planned on this channel.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {events.map((e) => (
            <li key={e.id}>
              <Draggable id={`event|${e.id}`} disabled={!editable} testId={`tray-${e.id}`} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm">
                <span className="font-medium text-gray-900">{e.title}</span>
                <span className="block text-gray-500">
                  {formatShortDate(e.startsAt)} · {DESCRIPTION_STATUS[e.description]?.label ?? e.description}
                </span>
              </Draggable>
              {editable && <PlanMenu event={e} channels={channels} channel={channel} days={days} posts={posts} byId={byId} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The keyboard way to plan: channel, day and time – or into an existing post (bundle). */
function PlanMenu({ event, channels, channel, days, posts, byId }: { event: BoardEvent; channels: BoardChannel[]; channel: string; days: string[]; posts: BoardPost[]; byId: Map<string, BoardEvent> }) {
  const { run, pending, error } = useAction();
  const [ch, setCh] = useState(channel);
  const [day, setDay] = useState(days.find((d) => d <= berlinDate(event.startsAt) && d >= days[0]) ?? days[0]);
  const [time, setTime] = useState("10:00");
  const [into, setInto] = useState("");
  const candidates = posts.filter((p) => p.channel === ch && p.status !== "skipped" && !p.events.includes(event.id));
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-esn">Plan…</summary>
      <div className="mt-1 grid gap-1 rounded-md border border-gray-200 bg-white p-2 shadow-sm">
        <Select aria-label={`Channel for ${event.title}`} value={ch} onChange={(e) => setCh(e.target.value)}>
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
            <Input aria-label={`Day for ${event.title}`} type="date" min={days[0]} max={days.at(-1)} value={day} onChange={(e) => setDay(e.target.value)} />
            <Input aria-label={`Time for ${event.title}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-24" />
          </div>
        )}
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => (into ? run(addToPost, { post_id: into, event_id: event.id }) : run(createPost, { channel: ch, day, time, event_ids: [event.id] }))}
        >
          {into ? "Add to the post" : "Plan the post"}
        </Button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </details>
  );
}

function PostCard({ post, channel, byId, editable }: { post: BoardPost; channel: BoardChannel; byId: Map<string, BoardEvent>; editable: boolean }) {
  const { run, pending, error } = useAction();
  const { setNodeRef, isOver } = useDroppable({ id: `post|${post.id}`, disabled: !editable || post.status === "skipped" });
  const [mode, setMode] = useState<"" | "move" | "edit" | "publish" | "skip">("");
  const [day, setDay] = useState(berlinDate(post.scheduledFor));
  const [time, setTime] = useState(berlinTime(post.scheduledFor));
  const [text, setText] = useState("");
  const [picture, setPicture] = useState(post.picture ?? "");
  const [note, setNote] = useState(post.note);
  const move = (i: number, by: number) => {
    const ids = [...post.events];
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    run(reorderPost, { post_id: post.id, event_ids: ids });
  };
  const tone = post.status === "published" ? "green" : post.status === "skipped" ? "gray" : "blue";
  return (
    <div ref={setNodeRef} className={cn("rounded-md border bg-white p-1.5 shadow-sm space-y-1", isOver ? "border-esn" : "border-gray-200", post.status === "skipped" && "opacity-70")} data-testid={`post-${post.id}`}>
      <Draggable id={`post|${post.id}`} disabled={!editable || post.status !== "planned"} className="flex items-center gap-1">
        <Badge tone={tone}>{post.status === "planned" ? `⏰ ${berlinTime(post.scheduledFor)}` : post.status === "published" ? "✓ published" : "⨯ skipped"}</Badge>
        {post.events.length > 1 && <span className="text-gray-500">{post.events.length} events</span>}
      </Draggable>
      <ol className="space-y-0.5">
        {post.events.map((id, i) => (
          <li key={id} className="flex items-center gap-1">
            <Draggable id={`item|${post.id}|${id}`} disabled={!editable || post.status === "skipped"} className="min-w-0 grow truncate" testId={`item-${post.id}-${id}`}>
              {byId.get(id)?.title ?? "Event"}
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
                <button type="button" aria-label={`Remove ${byId.get(id)?.title ?? "event"}`} className="px-0.5 text-gray-500 hover:text-red-600" onClick={() => run(removeFromPost, { post_id: post.id, event_id: id })}>
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
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
          {channel.key === "telegram" && (
            <>
              <button type="button" className="text-esn hover:underline" disabled={pending} onClick={() => run(publishPostNow, { post_id: post.id })}>
                {post.status === "published" ? "Publish again" : "Publish now"}
              </button>
              <button type="button" className="text-esn hover:underline" onClick={() => setMode(mode === "edit" ? "" : "edit")}>
                Edit
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
                Move to…
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
          <Input aria-label="Picture (Drive link or image URL)" placeholder="Picture: Drive link or https://…" value={picture} onChange={(e) => setPicture(e.target.value)} />
          {post.events.length > 1 && <Input aria-label="Heading of the bundle" placeholder="e.g. This week at ESN MESA" value={note} onChange={(e) => setNote(e.target.value)} />}
          <Button size="sm" disabled={pending}>
            Save
          </Button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
