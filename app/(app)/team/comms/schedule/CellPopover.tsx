"use client";

// Planning on the board (round 2026-11-09 (5)): a day on an event's row opens
// this – pre-filled with the event and the day – for one post or several at
// once (each its channel, format, time and an optional title). When the day
// already has a post on the chosen channel, the event can go into it instead
// (a bundle: one Telegram post with several events). On the "Without an
// event" row it plans posts with a title (the calendar, a recap …).
// Round 2026-11-10: laid out as a small form – a header saying what and
// when, the channel and format as buttons, labelled fields, the day and the
// button in a foot that stays in view.
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus, Trash2, X } from "lucide-react";
import { addToPost, createPost, planEventPosts } from "@/app/actions/publishing";
import { describeError } from "@/components/ActionButton";
import { useFeedback } from "@/components/Feedback";
import { Button, Input } from "@/components/ui";
import { berlinDate, berlinTime } from "@/lib/dates";
import { FORMAT_LABEL, type PostFormat } from "@/lib/publishing";
import { cn } from "@/lib/utils";
import { STATE_TEXT, dayLabel, leadTime, stateOf, type BoardChannel, type BoardEvent, type BoardPost, type Coverage } from "./boardModel";
import { MarkerShape } from "./Board";
import { ChannelPicker, FieldLabel, FormatPicker } from "./fields";

/** The cell the popover hangs on, in viewport pixels. */
export type Anchor = { x: number; y: number; w: number; h: number };

type Row = { channel: string; format: PostFormat | ""; time: string; title: string; into: string };

const WIDTH = 400;
/** The room the popover wants below its cell before it opens above instead. */
const ROOM = 420;

/** Phones get a sheet at the bottom instead of a popover. */
const NARROW = "(max-width: 639px)";
function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false
  );
}

export function CellPopover({
  event,
  day: cellDay,
  anchor,
  channels,
  posts,
  byId,
  coverage,
  today,
  editable,
  onClose,
  onOpenPost,
}: {
  /** The row's event; null on "Without an event". */
  event: BoardEvent | null;
  day: string;
  anchor: Anchor;
  channels: BoardChannel[];
  posts: BoardPost[];
  byId: Map<string, BoardEvent>;
  coverage: Coverage;
  today: string;
  editable: boolean;
  onClose: () => void;
  onOpenPost: (id: string) => void;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLButtonElement>(null);
  const usable = event ? channels : channels.filter((c) => c.key !== "telegram");
  // The first required channel the event is not on yet, else the first.
  const missing = event ? channels.filter((c) => c.required && !coverage[event.id]?.[c.key]) : [];
  const fresh = (channel: string): Row => ({ channel, format: "", time: "10:00", title: "", into: "" });
  const [day, setDay] = useState(cellDay);
  const [rows, setRows] = useState<Row[]>(() => [fresh((missing[0] ?? usable[0])?.key ?? "")]);
  const phone = useNarrow();
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    firstField.current?.focus({ preventScroll: true });
    // A press outside closes it (not one in a confirm dialog or on a toast).
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !(t instanceof Element && t.closest("dialog, [data-testid=toasts]"))) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const here = posts.filter((p) => berlinDate(p.scheduledFor) === day && (event ? p.events.includes(event.id) : !p.events.length)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  // Posts of the day on a channel the event could go into (planned, with events, not this one's yet).
  const intoOf = (channel: string) => (event ? posts.filter((p) => p.channel === channel && p.status === "planned" && p.events.length > 0 && !p.events.includes(event.id) && berlinDate(p.scheduledFor) === day) : []);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addRow = () =>
    setRows((r) => {
      // The next post on a channel not in the list yet – a required one first.
      const used = new Set(r.map((x) => x.channel));
      const next = [...missing, ...usable].find((c) => !used.has(c.key)) ?? usable[0];
      return [...r, fresh(next?.key ?? "")];
    });
  const lead = event ? leadTime(day, event.startsAt) : null;
  const channelName = (key: string) => channels.find((c) => c.key === key)?.name ?? key;
  const titlesOf = (p: BoardPost) => [p.title, ...p.events.map((id) => byId.get(id)?.title ?? "Event")].filter(Boolean).join(", ");
  const invalid = !day || rows.some((r) => !r.channel || (!r.into && !event && !r.title.trim()) || !/^\d{2}:\d{2}$/.test(r.time));

  function submit() {
    setError(null);
    start(async () => {
      const bundled = rows.filter((r) => r.into);
      const created = rows.filter((r) => !r.into);
      for (const r of bundled) {
        const res = await addToPost({ post_id: r.into, event_id: event!.id });
        if (!res.ok) return setError(describeError(res));
      }
      if (created.length && event) {
        const res = await planEventPosts({
          event_id: event.id,
          posts: created.map((r) => ({ channel: r.channel, day, time: r.time, title: r.title.trim(), format: r.channel === "telegram" ? "" : r.format })),
        });
        if (!res.ok) return setError(describeError(res));
      } else {
        for (const r of created) {
          const res = await createPost({ channel: r.channel, day, time: r.time, event_ids: [], title: r.title.trim(), format: r.format || "post" });
          if (!res.ok) return setError(describeError(res));
        }
      }
      const parts = [created.length ? `${created.length === 1 ? "Post" : `${created.length} posts`} planned` : null, bundled.length ? `added to ${bundled.length === 1 ? "a post" : `${bundled.length} posts`}` : null].filter(Boolean);
      const said = parts.join(", ");
      toast(`${said[0].toUpperCase()}${said.slice(1)} – ${dayLabel(day)}.`);
      router.refresh();
      onClose();
    });
  }

  // Below the cell when there is room, else above; a sheet at the bottom on phones.
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const below = vh - (anchor.y + anchor.h) > ROOM || anchor.y < ROOM;
  const style: React.CSSProperties = phone
    ? {}
    : {
        left: Math.max(8, Math.min(vw - WIDTH - 8, anchor.x + anchor.w / 2 - WIDTH / 2)),
        width: WIDTH,
        ...(below ? { top: anchor.y + anchor.h + 4, maxHeight: vh - anchor.y - anchor.h - 12 } : { bottom: vh - anchor.y + 4, maxHeight: anchor.y - 12 }),
      };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${event ? event.title : "Post without an event"}, ${dayLabel(day)}`}
      className={cn("fixed z-50 flex flex-col overflow-hidden border border-gray-200 bg-white text-xs shadow-2xl", phone ? "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl" : "rounded-2xl")}
      style={style}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      data-testid="cell-popover"
    >
      {/* What and when. */}
      <div className="flex items-start gap-2.5 border-b border-gray-100 px-4 pb-3 pt-3.5">
        <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-esn/5 text-esn">
          <CalendarDays className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {editable ? "Plan a post" : "Posts"} · {dayLabel(day)}
          </p>
          <p className="truncate text-sm font-semibold leading-5 text-gray-900" title={event?.title}>
            {event ? event.title : "Without an event"}
          </p>
          {(lead || day < today) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
              {lead && <span className={cn("font-medium", lead.late ? "text-red-700" : "text-amber-800")}>{lead.text}</span>}
              {day < today && <span className="text-gray-500">{lead ? "· " : ""}this day has passed</span>}
            </p>
          )}
        </div>
        <button type="button" aria-label="Close" className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-900" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {here.length > 0 && (
          <section data-testid="cell-posts">
            <FieldLabel className="mb-1">Already on this day</FieldLabel>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {here.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpenPost(p.id)} className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-50">
                    <MarkerShape post={p} />
                    <span className="shrink-0 tabular-nums text-gray-600">{berlinTime(p.scheduledFor)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                      {channelName(p.channel)}
                      <span className="font-normal text-gray-600"> · {p.title || (p.events.length > 1 ? titlesOf(p) : p.format ? FORMAT_LABEL[p.format] : p.channel === "telegram" ? "Message" : "Post")}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-500">{STATE_TEXT[stateOf(p)]} ›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!editable && !here.length && <p className="text-gray-500">No posts on this day.</p>}

        {editable && !usable.length && <p className="text-gray-500">Posts without an event go on Instagram or another manual channel – none is switched on.</p>}
        {editable && usable.length > 0 && (
          <form
            id="cell-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid && !pending) submit();
            }}
          >
            {here.length > 0 && <FieldLabel>{rows.length > 1 ? "Add posts" : "Add a post"}</FieldLabel>}
            <ol className="space-y-2.5">
              {rows.map((r, i) => {
                const into = intoOf(r.channel);
                const n = rows.length > 1 ? ` (post ${i + 1})` : "";
                const telegram = r.channel === "telegram";
                return (
                  <li key={i} className={cn("space-y-2.5", rows.length > 1 && "rounded-xl border border-gray-200 bg-gray-50/60 p-2.5")}>
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
                      <ChannelPicker channels={usable} value={r.channel} onChange={(key) => set(i, { channel: key, into: "" })} label={`Channel${n}`} firstRef={i === 0 ? firstField : undefined} />
                    </div>
                    {/* A bundle: the day has a post on this channel already. */}
                    {into.length > 0 && (
                      <fieldset className="space-y-1 rounded-lg border border-sky-200 bg-sky-50 p-2 text-sky-950" data-testid="bundle-options">
                        <legend className="sr-only">New post or add to an existing one{n}</legend>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input type="radio" className="mt-0.5 accent-esn" checked={!r.into} onChange={() => set(i, { into: "" })} />
                          <span>A new {channelName(r.channel)} post</span>
                        </label>
                        {into.map((p) => (
                          <label key={p.id} className="flex cursor-pointer items-start gap-2">
                            <input type="radio" className="mt-0.5 accent-esn" checked={r.into === p.id} onChange={() => set(i, { into: p.id })} />
                            <span className="min-w-0">
                              Add it to the {channelName(p.channel)} post at {berlinTime(p.scheduledFor)} <span className="text-sky-800">({titlesOf(p)})</span>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {!r.into && (
                      <>
                        <div className="space-y-1">
                          <FieldLabel>Format</FieldLabel>
                          {telegram ? (
                            <p className="rounded-lg bg-sky-50 px-2.5 py-2 leading-4 text-sky-900">A message made from the event’s description – you check the preview before it goes out.</p>
                          ) : (
                            <FormatPicker value={r.format || (event ? "" : "post")} onChange={(f) => set(i, { format: f })} label={`Format${n}`} optional={!!event} />
                          )}
                        </div>
                        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                          <div className="space-y-1">
                            <FieldLabel htmlFor={`cell-time-${i}`}>Time</FieldLabel>
                            <Input id={`cell-time-${i}`} aria-label={`Time${n}`} type="time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} className="h-8 min-w-0 px-2 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <FieldLabel htmlFor={`cell-title-${i}`}>
                              Title{event && <span className="font-normal normal-case tracking-normal text-gray-400"> – optional</span>}
                            </FieldLabel>
                            <Input
                              id={`cell-title-${i}`}
                              aria-label={`Title${n}`}
                              placeholder={event ? "e.g. Save the date" : "e.g. December calendar"}
                              value={r.title}
                              maxLength={120}
                              required={!event}
                              onChange={(e) => set(i, { title: e.target.value })}
                              className="h-8 min-w-0 px-2 text-xs"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
            {rows.length < 10 && (
              <button type="button" className="inline-flex items-center gap-1 font-medium text-esn hover:underline" onClick={addRow} data-testid="cell-add-row">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Another post on this day
              </button>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-red-700">
                {error}
              </p>
            )}
          </form>
        )}
      </div>

      {/* The day and the button stay in view however many posts are listed. */}
      {editable && usable.length > 0 && (
        <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/70 px-4 py-2.5">
          <label className="flex min-w-0 items-center gap-1.5 text-gray-600">
            <span className="shrink-0 font-medium">Day</span>
            <Input aria-label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-8 w-[8.75rem] px-1.5 text-xs" />
          </label>
          <Button type="submit" form="cell-form" size="sm" className="ml-auto shrink-0" disabled={pending || invalid} data-testid="cell-plan">
            {pending ? "Saving…" : rows.length === 1 ? (rows[0].into ? "Add to the post" : "Plan the post") : `Plan ${rows.length} posts`}
          </Button>
        </div>
      )}
    </div>
  );
}
