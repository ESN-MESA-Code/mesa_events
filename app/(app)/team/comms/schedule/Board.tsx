"use client";

// The board (round 2026-11-09 (5)): the schedule is one board – a row per
// event, the days left to right, each post a marker on its day, the event's
// day a 📅, a line from its first post to it. A row of how many posts go out
// each day on top, today marked through every row. Click (or tap, or
// right-click) a day on a row to plan posts there; arrow keys and Enter do
// the same. Drag a marker sideways to move the post; click it for the post.
import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Send, Ticket, type LucideIcon } from "lucide-react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { movePost } from "@/app/actions/publishing";
import type { ServerAction } from "@/components/ActionButton";
import { DESCRIPTION_STATUS } from "@/components/status";
import { berlinDate, berlinTime, formatDateTime, monthLabel } from "@/lib/dates";
import { addDays, dayDiff } from "@/lib/month";
import { FORMAT_LABEL, isBigEvent } from "@/lib/publishing";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { CellPopover, type Anchor } from "./CellPopover";
import {
  STATE_TEXT,
  channelMark,
  dayLabel,
  dotOf,
  isUnconfirmed,
  leadOf,
  lineOf,
  needsPosts,
  shortOf,
  stateOf,
  type BoardCategory,
  type BoardChannel,
  type BoardEvent,
  type BoardPost,
  type Coverage,
  type PretixChecklist,
} from "./boardModel";

/** A day's width and a row's height. */
export const COL = 28;
export const ROW_H = 50;
/** The "Later – big events" divider's height. */
const DIVIDER_H = 24;
/** Markers in a cell before "+n" (the 📅 takes a place on the event's day). */
const SLOTS = 3;


/** A post's shape: square post / reel (ringed), round story; light planned, solid posted, dashed not confirmed. */
export function MarkerShape({ post, className }: { post: Pick<BoardPost, "channel" | "status" | "format" | "confirmed">; className?: string }) {
  const c = dotOf(post.channel);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-3.5 w-3.5 shrink-0 border",
        post.format === "story" ? "rounded-full" : "rounded-[3px]",
        post.status === "published" ? c.solid : post.status === "skipped" ? "border-gray-300 bg-gray-100 opacity-60" : c.light,
        isUnconfirmed(post) && "border-dashed",
        post.format === "reel" && "ring-1 ring-gray-400 ring-offset-1",
        className
      )}
    />
  );
}

/** What a post is, in words (tooltips, the screen reader, the lists). */
export function postSummary(post: BoardPost, byId: Map<string, BoardEvent>, channelName: (key: string) => string): string {
  const lead = leadOf(post, byId);
  const titles = post.events.map((id) => byId.get(id)?.title ?? "Event");
  return [
    `${post.title ? `${post.title} – ` : ""}${channelName(post.channel)} ${post.format ? FORMAT_LABEL[post.format].toLowerCase() : "post"}, ${formatDateTime(post.scheduledFor)} (${STATE_TEXT[stateOf(post)]})`,
    titles.length > 1 ? `Bundled: ${titles.join(", ")}` : null,
    lead ? `Lead time: ${lead.text}` : null,
    ...post.warnings.map((w) => `⚠ ${w}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function Marker({
  post,
  rowKey,
  editable,
  onOpen,
  title,
  lit,
  onHover,
}: {
  post: BoardPost;
  rowKey: string;
  editable: boolean;
  onOpen: () => void;
  title: string;
  /** The pointer is on this post (here or on another row of the same bundle). */
  lit: boolean;
  onHover: (id: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `m|${post.id}|${rowKey}`, disabled: !editable || post.status !== "planned", data: { post } });
  const movable = editable && post.status === "planned";
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(movable ? listeners : {})}
      {...(movable ? { "aria-roledescription": attributes["aria-roledescription"], "aria-describedby": attributes["aria-describedby"] } : {})}
      onClick={(e) => (e.stopPropagation(), onOpen())}
      title={title}
      aria-label={title.split("\n")[0]}
      onMouseEnter={() => onHover(post.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(post.id)}
      onBlur={() => onHover(null)}
      data-marker=""
      data-testid={`tl-post-${post.id}-${rowKey}`}
      className={cn(
        "relative flex h-5 w-6 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-esn",
        movable && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-30",
        lit && "bg-white ring-2 ring-esn"
      )}
    >
      <MarkerShape post={post} />
      {post.warnings.length > 0 && post.status === "planned" && <span aria-hidden="true" className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-white" />}
      {post.events.length > 1 && (
        <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 rounded-full bg-gray-800 px-[3px] text-[8px] font-bold leading-[10px] text-white ring-1 ring-white">
          {post.events.length}
        </span>
      )}
    </button>
  );
}

/** A row's day strip (the cells' geometry comes from it). */
const trackIn = (root: Element | null, key: string) => root?.querySelector(`[data-track="${key}"]`) ?? null;

export type Cell = { key: string; day: string; anchor: Anchor; keyboard: boolean };

export function Board({
  days,
  today,
  rows,
  laterFrom,
  posts,
  allPosts,
  load,
  showLoose,
  channels,
  byId,
  coverage,
  pretix,
  categories,
  editable,
  focus,
  onLabel,
  onOpenPost,
  run,
}: {
  days: string[];
  today: string;
  /** The event rows in order. */
  rows: BoardEvent[];
  /** The first row after the window (big events ahead) – a divider goes above it. */
  laterFrom: string | null;
  /** The posts to draw (filtered). */
  posts: BoardPost[];
  /** Every post (bundling, the cell's list). */
  allPosts: BoardPost[];
  /** The posts going out per day (the load row). */
  load: Map<string, BoardPost[]>;
  showLoose: boolean;
  channels: BoardChannel[];
  byId: Map<string, BoardEvent>;
  coverage: Coverage;
  pretix: PretixChecklist;
  categories: BoardCategory[];
  editable: boolean;
  focus: string | null;
  onLabel: (id: string) => void;
  onOpenPost: (id: string) => void;
  run: <T>(action: ServerAction<T>, input: unknown, onDone?: (data: T) => void) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const [dragEnded, setDragEnded] = useState(0);
  const [cursor, setCursor] = useState<{ row: number; col: number } | null>(null);
  const [gridFocused, setGridFocused] = useState(false);
  const [hover, setHover] = useState<{ key: string; col: number } | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [drag, setDrag] = useState<{ post: BoardPost; to: string } | null>(null);
  // The post under the pointer: its markers on every row light up (bundles).
  const [litPost, setLitPost] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const channelName = (key: string) => channels.find((c) => c.key === key)?.name ?? key;
  const required = channels.filter((c) => c.required);
  const emoji = new Map(categories.map((c) => [c.id, c.emoji]));
  // "Without an event" on top (round 2026-11-09 (7)), then the events.
  const keys = [...(showLoose ? ["none"] : []), ...rows.map((e) => e.id)];
  const from = days[0];
  const to = days[days.length - 1];
  const col = (d: string) => dayDiff(from, d);
  const inView = (d: string) => d >= from && d <= to;
  const todayCol = inView(today) ? col(today) : -1;
  const postsOf = (key: string) => posts.filter((p) => (key === "none" ? !p.events.length : p.events.includes(key)));
  const width = days.length * COL;
  // Where each row sits in the grid (the divider above the later events counted), for the bundle lines.
  const laterIndex = laterFrom ? keys.indexOf(laterFrom) : -1;
  const rowMid = (i: number) => i * ROW_H + (laterIndex >= 0 && i >= laterIndex ? DIVIDER_H : 0) + ROW_H / 2;
  // Posts of several events: a line through their markers, row to row ("posted together").
  const bundles = posts
    .filter((p) => p.events.length > 1 && p.status !== "skipped" && inView(berlinDate(p.scheduledFor)))
    .map((p) => {
      const idx = p.events.map((id) => keys.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
      return { post: p, top: idx[0], bottom: idx[idx.length - 1], rows: idx, hidden: p.events.length - idx.length };
    })
    .filter((b) => b.rows.length > 0);

  // ?event=…: its row in view, from its first post on.
  useEffect(() => {
    if (!focus) return;
    const s = scroller.current;
    const track = trackIn(s, focus);
    if (!track || !s) return;
    track.scrollIntoView({ block: "center", inline: "nearest" });
    const ev = byId.get(focus);
    const first = posts.filter((p) => p.events.includes(focus)).map((p) => berlinDate(p.scheduledFor)).filter(inView).sort()[0];
    const c = first ? col(first) : ev ? col(berlinDate(ev.startsAt)) : 0;
    s.scrollLeft = Math.max(0, (c - 3) * COL);
    // Only when the page opens on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The keyboard's cell stays in view (the sticky labels and header left out).
  useEffect(() => {
    const s = scroller.current;
    const el = cursorEl.current;
    if (!cursor || !s || !el) return;
    const sr = s.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    const labelW = (trackIn(s, keys[cursor.row])?.getBoundingClientRect().left ?? sr.left) - sr.left + s.scrollLeft;
    const headH = header.current?.offsetHeight ?? 0;
    if (cr.left < sr.left + labelW) s.scrollLeft -= sr.left + labelW - cr.left + COL;
    else if (cr.right > sr.right) s.scrollLeft += cr.right - sr.right + COL;
    if (cr.top < sr.top + headH) s.scrollTop -= sr.top + headH - cr.top;
    else if (cr.bottom > sr.bottom) s.scrollTop += cr.bottom - sr.bottom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  // The popover follows its cell while the board or the page scrolls.
  useEffect(() => {
    if (!cell) return;
    const follow = () => {
      const track = trackIn(scroller.current, cell.key);
      if (!track) return;
      const r = track.getBoundingClientRect();
      setCell((c) => (c ? { ...c, anchor: { x: r.left + col(c.day) * COL, y: r.top, w: COL, h: ROW_H } } : c));
    };
    const s = scroller.current;
    s?.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      s?.removeEventListener("scroll", follow);
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell?.key, cell?.day]);

  function openCell(key: string, c: number, keyboard: boolean, track: Element | null) {
    if (!track || c < 0 || c >= days.length) return;
    const r = track.getBoundingClientRect();
    setCursor({ row: keys.indexOf(key), col: c });
    setCell({ key, day: days[c], anchor: { x: r.left + c * COL, y: r.top, w: COL, h: ROW_H }, keyboard });
  }

  function closeCell() {
    const wasKeyboard = cell?.keyboard;
    setCell(null);
    if (wasKeyboard) document.getElementById("schedule-grid")?.focus();
  }

  const colAt = (e: React.MouseEvent<HTMLDivElement>) => Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / COL);

  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const cur = cursor ?? { row: 0, col: Math.max(0, todayCol) };
    const move = (row: number, c: number) => {
      e.preventDefault();
      setCursor({ row: Math.max(0, Math.min(keys.length - 1, row)), col: Math.max(0, Math.min(days.length - 1, c)) });
    };
    if (e.key === "ArrowRight") move(cur.row, cur.col + (e.shiftKey ? 7 : 1));
    else if (e.key === "ArrowLeft") move(cur.row, cur.col - (e.shiftKey ? 7 : 1));
    else if (e.key === "ArrowDown") move(cur.row + 1, cur.col);
    else if (e.key === "ArrowUp") move(cur.row - 1, cur.col);
    else if (e.key === "Home") move(cur.row, 0);
    else if (e.key === "End") move(cur.row, days.length - 1);
    else if ((e.key === "Enter" || e.key === " ") && keys.length) {
      e.preventDefault();
      if (!cursor) return setCursor(cur);
      const key = keys[cur.row];
      const here = postsOf(key).filter((p) => berlinDate(p.scheduledFor) === days[cur.col]);
      // One post there and nothing to plan (read only): open it straight away.
      if (!editable && here.length === 1) return onOpenPost(here[0].id);
      if (editable || here.length) openCell(key, cur.col, true, trackIn(e.currentTarget, key));
    } else if (e.key === "Escape") setCursor(null);
  }

  function onDragStart(e: DragStartEvent) {
    const post = e.active.data.current?.post as BoardPost | undefined;
    if (post) setDrag({ post, to: berlinDate(post.scheduledFor) });
    setCell(null);
  }
  function onDragMove(e: DragMoveEvent) {
    if (!drag) return;
    const target = addDays(berlinDate(drag.post.scheduledFor), Math.round(e.delta.x / COL));
    if (target !== drag.to) setDrag({ ...drag, to: target });
  }
  function onDragEnd(e: DragEndEvent) {
    setDragEnded(Date.now());
    const post = e.active.data.current?.post as BoardPost | undefined;
    setDrag(null);
    if (!post || !editable) return;
    const day = addDays(berlinDate(post.scheduledFor), Math.round(e.delta.x / COL));
    if (day !== berlinDate(post.scheduledFor)) run(movePost, { post_id: post.id, day, time: berlinTime(post.scheduledFor) });
  }

  // Week lines, faint day lines and the weekend shaded (the window starts on a Monday).
  const grid: React.CSSProperties = {
    width,
    backgroundImage: `linear-gradient(to right, #d1d5db 0 1px, transparent 1px), linear-gradient(to right, #f1f2f4 0 1px, transparent 1px), linear-gradient(to right, transparent 0 ${5 * COL}px, #f5f6f8 ${5 * COL}px)`,
    backgroundSize: `${7 * COL}px 100%, ${COL}px 100%, ${7 * COL}px 100%`,
  };
  const at = (c: number): React.CSSProperties => ({ left: `calc(var(--label) + ${c * COL}px)` });

  // The event on the left (round 2026-11-09 (6)): a date tile, the title on top, below what it
  // needs – category, how soon, the description, the channels, pretix. A red edge: posts missing.
  const label = (e: BoardEvent) => {
    const d = berlinDate(e.startsAt);
    const inDays = dayDiff(today, d);
    const desc = DESCRIPTION_STATUS[e.description];
    const missing = needsPosts(e, required, coverage, today);
    const past = inDays < 0;
    const soon = inDays >= 0 && inDays <= 7;
    const [weekday, dayNo, month] = dayLabel(d).split(" ");
    const descDone = e.description === "approved" || e.description === "published";
    return (
      <div className={cn("relative flex h-full min-w-0", focus === e.id && "bg-amber-50")}>
        <span aria-hidden="true" className={cn("w-1 shrink-0", focus === e.id ? "bg-esn" : missing ? "bg-red-400" : "bg-transparent")} />
        <button
          type="button"
          onClick={() => onLabel(e.id)}
          aria-pressed={focus === e.id}
          aria-label={`${e.title}, ${dayLabel(d)}${missing ? ", still needs posts" : ""} – details and planning`}
          title={`${e.title}\n${formatDateTime(e.startsAt)}${e.draft ? "\nDraft – the date may still change" : ""}\nDescription: ${desc?.label ?? e.description}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-1.5 pr-1 text-left hover:bg-amber-50/70"
          data-testid={`row-label-${e.id}`}
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex w-8 shrink-0 flex-col items-center rounded-md py-0.5 leading-none",
              past ? "bg-gray-50 text-gray-400" : soon ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700"
            )}
          >
            <span className="text-[8px] font-semibold uppercase tracking-wide">{month}</span>
            <span className="text-sm font-bold tabular-nums">{dayNo}</span>
            <span className="text-[8px] uppercase">{weekday}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1">
              <span className={cn("truncate text-xs font-semibold leading-4 text-gray-900", focus === e.id && "text-esn", past && "text-gray-500")}>{e.title}</span>
              {isBigEvent(e.type) && <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-bold uppercase leading-3 text-amber-900">big</span>}
              {e.draft && <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] font-bold uppercase leading-3 text-gray-600">draft</span>}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-gray-500">
              {e.categoryId && emoji.get(e.categoryId) && <span aria-hidden="true">{emoji.get(e.categoryId)}</span>}
              <span className={cn("whitespace-nowrap", soon && "font-semibold text-amber-700")}>
                {past ? "past" : inDays === 0 ? "today" : inDays === 1 ? "tomorrow" : `in ${inDays} d`}
                {!inView(d) && (d > to ? " →" : " ←")}
              </span>
              {missing && (
                <span className="font-bold text-red-700 sm:hidden" title="Still needs posts">
                  !
                </span>
              )}
              {/* What it needs, in the order it is done: description, pretix, the channels. Green done, red missing. */}
              <span className="ml-1 hidden items-center gap-0.5 sm:flex" data-testid={`marks-${e.id}`}>
                <Mark
                  icon={FileText}
                  tone={descDone ? "done" : past ? "off" : "missing"}
                  label={`Description: ${desc?.label ?? e.description}`}
                  testId={`desc-${e.id}`}
                />
                {pretix.enabled && (
                  <Mark
                    icon={Ticket}
                    tone={pretix.done[e.id] ? "done" : past || e.draft ? "off" : "missing"}
                    label={pretix.done[e.id] ? "pretix page set up" : "pretix page not set up"}
                    testId={`pretix-${e.id}`}
                  />
                )}
                {channels.map((c) => {
                  const m = channelMark(coverage, e.id, c.key);
                  return (
                    <Mark
                      key={c.key}
                      icon={CHANNEL_ICON[c.key] ?? Send}
                      tone={m.state === "posted" ? "done" : m.state === "planned" ? "planned" : c.required && missing ? "missing" : "off"}
                      label={`${c.name}: ${m.state === "posted" ? "posted" : m.state === "planned" ? `planned ${dayLabel(berlinDate(m.at!))}` : "not planned"}`}
                      testId={`mark-${c.key}-${e.id}`}
                    />
                  );
                })}
              </span>
            </span>
          </span>
        </button>
      </div>
    );
  };

  const row = (key: string, rowIndex: number, ev: BoardEvent | null) => {
    const own = postsOf(key).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
    const evDay = ev ? berlinDate(ev.startsAt) : null;
    const evCol = evDay ? col(evDay) : null;
    const live = own.filter((p) => p.status !== "skipped").map((p) => col(berlinDate(p.scheduledFor)));
    const first = live.length ? Math.min(...live) : null;
    const faded = !!focus && ev?.id !== focus;
    const byDay = new Map<string, BoardPost[]>();
    for (const p of own) {
      const d = berlinDate(p.scheduledFor);
      if (inView(d)) byDay.set(d, [...(byDay.get(d) ?? []), p]);
    }
    // The campaign: from the first post to the event (to the edge when the event is beyond the window).
    const lineFrom = first !== null && evCol !== null && first < evCol ? Math.max(first, 0) : null;
    const lineTo = lineFrom !== null ? Math.min(evCol!, days.length) : null;
    const cellDays = new Set([...byDay.keys(), ...(evDay && inView(evDay) ? [evDay] : [])]);
    return (
      <div key={key} className="flex border-t border-gray-100" style={{ height: ROW_H }} data-testid={`tl-row-${key}`}>
        <div className={cn("sticky left-0 z-20 shrink-0 border-r border-gray-200 bg-white", faded && "[&>*]:opacity-60")} style={{ width: "var(--label)" }}>
          {ev ? (
            label(ev)
          ) : (
            <div className="flex h-full flex-col justify-center pl-3 pr-1.5">
              <span className="truncate text-xs font-semibold text-gray-700">Without an event</span>
              <span className="truncate text-[10px] text-gray-500">calendar, “This week”, recaps …</span>
            </div>
          )}
        </div>
        <div
          data-track={key}
          className={cn("relative shrink-0", editable && "cursor-cell", faded && "opacity-40")}
          style={grid}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-marker]") || Date.now() - dragEnded < 300) return;
            const c = colAt(e);
            const here = own.filter((p) => berlinDate(p.scheduledFor) === days[c]);
            if (editable || here.length) openCell(key, c, false, e.currentTarget);
          }}
          onContextMenu={(e) => {
            if (!editable || (e.target as HTMLElement).closest("[data-marker]")) return;
            e.preventDefault();
            openCell(key, colAt(e), false, e.currentTarget);
          }}
          onMouseMove={(e) => {
            if (!editable) return;
            const c = colAt(e);
            if (hover?.key !== key || hover.col !== c) setHover({ key, col: c });
          }}
          onMouseLeave={() => setHover(null)}
        >
          {lineFrom !== null && lineTo !== null && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-300/80"
              style={{ left: lineFrom * COL + COL / 2, width: (lineTo - lineFrom) * COL - (evCol! >= days.length ? COL / 2 : 0) }}
            />
          )}
          {ev && evCol !== null && evCol >= days.length && (
            <span aria-hidden="true" className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-500">
              → {dayLabel(evDay!)}
            </span>
          )}
          {ev && evCol !== null && evCol < 0 && (
            <span aria-hidden="true" className="absolute left-0.5 top-0.5 text-[10px] text-gray-400">
              ← 📅 {dayLabel(evDay!)}
            </span>
          )}
          {hover?.key === key && !cellDays.has(days[hover.col]) && hover.col >= 0 && hover.col < days.length && !drag && (
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 flex items-center justify-center rounded border border-dashed border-esn/50 text-sm font-bold text-esn/70" style={{ left: hover.col * COL + 1, width: COL - 2 }}>
              +
            </span>
          )}
          {[...cellDays].map((d) => {
            const c = col(d);
            const list = byDay.get(d) ?? [];
            const isEvent = d === evDay;
            const room = SLOTS - (isEvent ? 1 : 0);
            const shown = list.length > room ? list.slice(0, room - 1) : list;
            const more = list.length - shown.length;
            return (
              <div
                key={d}
                className={cn("absolute inset-y-0 z-[7] flex flex-col items-center justify-center gap-0.5", isEvent && "rounded-sm bg-amber-100/70 ring-1 ring-inset ring-amber-300")}
                style={{ left: c * COL, width: COL }}
              >
                {isEvent && (
                  <span className="text-[11px] leading-3" title={`${ev!.title}: ${formatDateTime(ev!.startsAt)}`} aria-hidden="true">
                    📅
                  </span>
                )}
                {shown.map((p) => (
                  <Marker key={p.id} post={p} rowKey={key} editable={editable} onOpen={() => onOpenPost(p.id)} title={postSummary(p, byId, channelName)} lit={litPost === p.id} onHover={setLitPost} />
                ))}
                {more > 0 && (
                  <button type="button" data-marker="" className="rounded bg-gray-700 px-0.5 text-[9px] font-bold leading-3 text-white" onClick={(e) => (e.stopPropagation(), openCell(key, c, false, e.currentTarget.closest("[data-track]")))} aria-label={`${more} more posts on ${dayLabel(d)}`}>
                    +{more}
                  </button>
                )}
              </div>
            );
          })}
          {cell?.key === key && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 rounded-sm bg-esn/10 ring-2 ring-inset ring-esn/70" style={{ left: col(cell.day) * COL, width: COL }} />
          )}
          {gridFocused && cursor?.row === rowIndex && (
            <div ref={cursorEl} aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-10 rounded-sm ring-2 ring-inset ring-esn" style={{ left: cursor.col * COL, width: COL }} />
          )}
        </div>
      </div>
    );
  };

  const cursorText = (() => {
    if (!cursor || !keys[cursor.row]) return "";
    const key = keys[cursor.row];
    const d = days[cursor.col];
    const n = postsOf(key).filter((p) => berlinDate(p.scheduledFor) === d).length;
    const ev = key === "none" ? null : byId.get(key);
    return `${ev ? ev.title : "Without an event"}, ${dayLabel(d)}${ev && berlinDate(ev.startsAt) === d ? ", the event's day" : ""}: ${n ? plural(n, "post") : "no posts"}${editable ? " – Enter to plan" : ""}`;
  })();
  const cellEvent = cell && cell.key !== "none" ? (byId.get(cell.key) ?? null) : null;

  return (
    <DndContext id="schedule-board" sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
      <div ref={scroller} className="relative max-h-[75vh] overflow-auto overscroll-x-contain rounded-lg border border-gray-200 [--label:9.5rem] sm:[--label:17rem]" data-testid="timeline">
        <div className="relative" style={{ width: `calc(var(--label) + ${width}px)` }}>
          {/* The header: months, days, and the posts per day. */}
          <div ref={header} className="sticky top-0 z-30 border-b border-gray-200 bg-white">
            <div className="flex h-5 text-[10px]">
              <div className="sticky left-0 z-40 shrink-0 border-r border-gray-200 bg-white" style={{ width: "var(--label)" }} />
              {/* Months as blocks, their names sticky – they stay readable when the board is scrolled. */}
              <div className="flex" style={{ width }}>
                {monthsIn(days).map((m) => (
                  <div key={m.month} className={cn("shrink-0", m.first > 0 && "border-l border-gray-300")} style={{ width: m.count * COL }}>
                    <span className="sticky inline-block whitespace-nowrap px-1 pt-0.5 font-bold uppercase tracking-wide text-gray-700" style={{ left: "var(--label)" }}>
                      {monthLabel(m.month)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex h-8">
              <div className="sticky left-0 z-40 flex shrink-0 items-end border-r border-gray-200 bg-white pb-1 pl-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400" style={{ width: "var(--label)" }}>
                {plural(rows.length, "event")}
              </div>
              <div className="flex" style={{ width }}>
                {days.map((d) => {
                  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
                  return (
                    <span
                      key={d}
                      className={cn("flex shrink-0 flex-col items-center justify-end pb-0.5 text-[10px] leading-3 tabular-nums", dow === 1 && "border-l border-gray-300", dow === 0 || dow === 6 ? "text-gray-400" : "text-gray-600", drag?.to === d && "bg-esn/15")}
                      style={{ width: COL }}
                    >
                      {d === today ? (
                        <span className="text-[8px] font-bold uppercase leading-3 tracking-tight text-esn" data-testid="today-marker">
                          Today
                        </span>
                      ) : (
                        <span className="text-[9px]">{"SMTWTFS"[dow]}</span>
                      )}
                      <span className={cn("mt-0.5 flex h-4 w-4 items-center justify-center rounded-full", d === today && "bg-esn font-bold text-white")}>{Number(d.slice(8))}</span>
                    </span>
                  );
                })}
              </div>
            </div>
            {/* Posts per day (round 2026-11-09 (5)): the busy days at a glance, without a calendar. */}
            <div className="flex h-6 border-t border-gray-100" data-testid="day-load">
              <div className="sticky left-0 z-40 flex shrink-0 items-center border-r border-gray-200 bg-white pl-2 text-[10px] font-medium text-gray-500" style={{ width: "var(--label)" }}>
                Posts per day
              </div>
              <div className="flex" style={{ width }}>
                {days.map((d) => {
                  const list = load.get(d) ?? [];
                  const n = list.length;
                  return (
                    <span
                      key={d}
                      title={n ? `${dayLabel(d)}: ${plural(n, "post")}\n${list.map((p) => `${shortOf(p.channel)} ${berlinTime(p.scheduledFor)} ${p.title ?? p.events.map((id) => byId.get(id)?.title ?? "Event").join(", ")}`).join("\n")}` : `${dayLabel(d)}: no posts`}
                      className={cn(
                        "flex shrink-0 items-center justify-center border-r border-white text-[10px] font-semibold tabular-nums",
                        n === 0 ? "text-transparent" : n === 1 ? "bg-esn/10 text-esn" : n === 2 ? "bg-esn/25 text-esn-dark" : n === 3 ? "bg-amber-300 text-amber-950" : "bg-red-400 text-white"
                      )}
                      style={{ width: COL }}
                      data-testid={`load-${d}`}
                    >
                      {n || "·"}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Today through every row, and the day a dragged post would land on. */}
          {todayCol >= 0 && <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 z-[15] w-0.5 -translate-x-1/2 bg-esn/50" style={{ left: `calc(var(--label) + ${todayCol * COL + COL / 2}px)` }} />}
          {drag && inView(drag.to) && <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 z-[5] bg-esn/10" style={{ ...at(col(drag.to)), width: COL }} />}

          <div
            id="schedule-grid"
            role="group"
            tabIndex={0}
            aria-label={editable ? "Advertisement board – arrow keys pick an event and a day, Enter plans a post there" : "Advertisement board"}
            className="relative outline-none"
            onKeyDown={onGridKey}
            onFocus={(e) => {
              if (e.target !== e.currentTarget) return;
              setGridFocused(true);
              if (!cursor) setCursor({ row: Math.max(0, focus ? keys.indexOf(focus) : 0), col: Math.max(0, todayCol) });
            }}
            onBlur={(e) => e.target === e.currentTarget && setGridFocused(false)}
          >
            {showLoose && row("none", 0, null)}
            {rows.map((e, i) => (
              <div key={e.id} className="contents">
                {laterFrom === e.id && (
                  <div className="relative z-[16] flex border-t border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-500" style={{ height: DIVIDER_H }}>
                    <span className="sticky left-0 flex items-center whitespace-nowrap bg-gray-50 px-2">Later – big events advertised weeks ahead</span>
                  </div>
                )}
                {row(e.id, i + (showLoose ? 1 : 0), e)}
              </div>
            ))}
            {/* Posted together (round 2026-11-09 (6)): one post of several events – a line through its markers. */}
            {bundles.map((b) => {
              const c = col(berlinDate(b.post.scheduledFor));
              const lit = litPost === b.post.id;
              return (
                <div key={b.post.id} aria-hidden="true" className="pointer-events-none absolute z-[6]" style={{ ...at(c), width: COL, top: rowMid(b.top), height: rowMid(b.bottom) - rowMid(b.top) }}>
                  {b.top !== b.bottom && (
                    <span className={cn("absolute right-[3px] top-0 h-full rounded-full", lineOf(b.post.channel), lit ? "w-[3px] opacity-100" : "w-0.5 opacity-50")} />
                  )}
                  {b.rows.map((r) => (
                    <span key={r} className={cn("absolute right-[1px] h-[7px] w-[7px] -translate-y-1/2 rounded-full ring-1 ring-white", lineOf(b.post.channel), !lit && "opacity-70")} style={{ top: rowMid(r) - rowMid(b.top) }} />
                  ))}
                  {b.hidden > 0 && (
                    <span className="absolute -bottom-3 right-0 whitespace-nowrap rounded bg-gray-700 px-0.5 text-[8px] font-bold leading-3 text-white" style={{ top: rowMid(b.bottom) - rowMid(b.top) + 6 }}>
                      +{b.hidden}
                    </span>
                  )}
                </div>
              );
            })}
            {!keys.length && <p className="p-4 text-xs text-gray-500">No events match the filters.</p>}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {gridFocused ? cursorText : ""}
      </p>
      {cell && (
        <CellPopover
          key={`${cell.key}|${cell.day}`}
          event={cellEvent}
          day={cell.day}
          anchor={cell.anchor}
          channels={channels}
          posts={allPosts}
          byId={byId}
          coverage={coverage}
          today={today}
          editable={editable}
          onClose={closeCell}
          onOpenPost={(id) => (setCell(null), onOpenPost(id))}
        />
      )}
      <DragOverlay dropAnimation={null}>
        {drag ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-esn bg-white px-1.5 py-1 text-[11px] font-semibold text-esn shadow-md">
            <MarkerShape post={drag.post} />→ {dayLabel(drag.to)}
            {drag.to !== berlinDate(drag.post.scheduledFor) && <span className="font-normal text-gray-500">({dayDiff(berlinDate(drag.post.scheduledFor), drag.to) > 0 ? "+" : ""}{dayDiff(berlinDate(drag.post.scheduledFor), drag.to)} d)</span>}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const CHANNEL_ICON: Record<string, LucideIcon> = { telegram: Send, instagram: Camera };

/** The months a run of days covers: each with where it starts and how many days it has. */
function monthsIn(days: string[]): Array<{ month: string; first: number; count: number }> {
  const out: Array<{ month: string; first: number; count: number }> = [];
  days.forEach((d, i) => {
    const m = `${d.slice(0, 7)}-01`;
    const last = out[out.length - 1];
    if (last?.month === m) last.count++;
    else out.push({ month: m, first: i, count: 1 });
  });
  return out;
}

export const MARK_TONE = {
  done: "bg-emerald-500 text-white",
  planned: "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-300",
  missing: "bg-red-100 text-red-600 ring-1 ring-inset ring-red-300",
  off: "bg-gray-100 text-gray-400",
} as const;

/**
 * One step an event needs, as a small icon (round 2026-11-09 (7)): green when done, light green
 * when planned (a channel), red when still missing, grey when it no longer matters. The words are
 * in the tooltip and for screen readers.
 */
export function Mark({ icon: Icon, tone, label, testId }: { icon: LucideIcon; tone: keyof typeof MARK_TONE; label: string; testId?: string }) {
  return (
    <span title={label} className={cn("flex h-4 w-4 items-center justify-center rounded", MARK_TONE[tone])} data-testid={testId}>
      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
