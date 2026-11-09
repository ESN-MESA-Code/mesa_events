"use client";

// Planning on the board (round 2026-11-09 (5)): a day on an event's row opens
// this – pre-filled with the event and the day – for one post or several at
// once (each its channel, format, time and an optional title). When the day
// already has a post on the chosen channel, the event can go into it instead
// (a bundle: one Telegram post with several events). On the "Without an
// event" row it plans posts with a title (the calendar, a recap …).
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addToPost, createPost, planEventPosts } from "@/app/actions/publishing";
import { describeError } from "@/components/ActionButton";
import { useFeedback } from "@/components/Feedback";
import { Button, Input, Select } from "@/components/ui";
import { berlinDate, berlinTime } from "@/lib/dates";
import { FORMAT_LABEL, POST_FORMATS, type PostFormat } from "@/lib/publishing";
import { cn } from "@/lib/utils";
import { STATE_TEXT, dayLabel, leadTime, shortOf, stateOf, type BoardChannel, type BoardEvent, type BoardPost, type Coverage } from "./boardModel";
import { EventDot, MarkerShape } from "./Board";

/** The cell the popover hangs on, in viewport pixels. */
export type Anchor = { x: number; y: number; w: number; h: number };

type Row = { channel: string; format: PostFormat | ""; time: string; title: string; into: string };

const WIDTH = 352;

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
  const firstField = useRef<HTMLSelectElement>(null);
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
  const invalid = !day || rows.some((r) => !r.channel || (!event && !r.title.trim()) || !/^\d{2}:\d{2}$/.test(r.time));

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
  const below = vh - (anchor.y + anchor.h) > 360 || anchor.y < 360;
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
      className={cn("fixed z-50 overflow-y-auto border border-gray-200 bg-white p-3 text-xs shadow-xl", phone ? "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl" : "rounded-xl")}
      style={style}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      data-testid="cell-popover"
    >
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
            {event && <EventDot color={event.color} />}
            <span className="truncate">{event ? event.title : "Post without an event"}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-gray-500">
            {editable ? (
              <Input aria-label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-7 w-[8.5rem] px-1 text-xs" />
            ) : (
              <span>{dayLabel(day)}</span>
            )}
            {lead && <span className={cn("font-medium", lead.late ? "text-red-700" : "text-amber-800")}>{lead.text}</span>}
            {day < today && <span className="text-gray-500">· has passed</span>}
          </p>
        </div>
        <button type="button" aria-label="Close" className="px-1 text-gray-400 hover:text-gray-900" onClick={onClose}>
          ✕
        </button>
      </div>

      {here.length > 0 && (
        <div className="mb-2 space-y-1 rounded-lg bg-gray-50 p-1.5" data-testid="cell-posts">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">On this day</p>
          {here.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpenPost(p.id)} className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white">
              <MarkerShape post={p} />
              <span className="shrink-0 font-semibold">{shortOf(p.channel, channelName(p.channel))}</span>
              <span className="shrink-0 tabular-nums text-gray-500">{berlinTime(p.scheduledFor)}</span>
              <span className="min-w-0 truncate">{p.title || (p.events.length > 1 ? titlesOf(p) : p.format ? FORMAT_LABEL[p.format] : "Post")}</span>
              <span className="ml-auto shrink-0 text-[10px] text-gray-500">{STATE_TEXT[stateOf(p)]}</span>
            </button>
          ))}
        </div>
      )}

      {editable && !usable.length && <p className="text-gray-500">Posts without an event go on Instagram or another manual channel – none is switched on.</p>}
      {editable && usable.length > 0 && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && !pending) submit();
          }}
        >
          <ol className="space-y-2">
            {rows.map((r, i) => {
              const into = intoOf(r.channel);
              const n = rows.length > 1 ? ` (post ${i + 1})` : "";
              return (
                <li key={i} className={cn("space-y-1", rows.length > 1 && "rounded-lg border border-gray-100 p-1.5")}>
                  <span className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_auto] gap-1">
                    <Select ref={i === 0 ? firstField : undefined} aria-label={`Channel${n}`} value={r.channel} onChange={(e) => set(i, { channel: e.target.value, into: "" })} className="h-8 min-w-0 px-1.5 py-1 text-xs">
                      {usable.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`Format${n}`}
                      value={r.channel === "telegram" ? "" : r.format}
                      disabled={r.channel === "telegram" || !!r.into}
                      onChange={(e) => set(i, { format: e.target.value as PostFormat | "" })}
                      className="h-8 min-w-0 px-1.5 py-1 text-xs"
                    >
                      <option value="">{r.channel === "telegram" ? "Message" : event ? "Format…" : "Post"}</option>
                      {POST_FORMATS.filter((f) => event || f !== "post").map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABEL[f]}
                        </option>
                      ))}
                    </Select>
                    <Input aria-label={`Time${n}`} type="time" value={r.time} disabled={!!r.into} onChange={(e) => set(i, { time: e.target.value })} className="h-8 min-w-0 px-1 text-xs" />
                    {rows.length > 1 ? (
                      <button type="button" aria-label={`Remove post ${i + 1}`} className="px-1 text-gray-400 hover:text-red-600" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    ) : (
                      <span />
                    )}
                  </span>
                  {!r.into && (
                    <Input
                      aria-label={`Title${n}`}
                      placeholder={event ? "Title (optional), e.g. Save the date" : "Title, e.g. December calendar"}
                      value={r.title}
                      maxLength={120}
                      required={!event}
                      onChange={(e) => set(i, { title: e.target.value })}
                      className="h-8 min-w-0 px-1.5 text-xs"
                    />
                  )}
                  {/* A bundle: the day has a post on this channel already. */}
                  {into.length > 0 && (
                    <fieldset className="space-y-0.5 rounded-md bg-sky-50 p-1.5 text-sky-950" data-testid="bundle-options">
                      <legend className="sr-only">New post or add to an existing one{n}</legend>
                      <label className="flex cursor-pointer items-start gap-1.5">
                        <input type="radio" className="mt-0.5 accent-esn" checked={!r.into} onChange={() => set(i, { into: "" })} />A new {channelName(r.channel)} post
                      </label>
                      {into.map((p) => (
                        <label key={p.id} className="flex cursor-pointer items-start gap-1.5">
                          <input type="radio" className="mt-0.5 accent-esn" checked={r.into === p.id} onChange={() => set(i, { into: p.id })} />
                          <span className="min-w-0">
                            Add to the {channelName(p.channel)} post at {berlinTime(p.scheduledFor)} <span className="text-sky-800">({titlesOf(p)})</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {rows.length < 10 && (
              <button type="button" className="text-esn hover:underline" onClick={addRow} data-testid="cell-add-row">
                + Another post
              </button>
            )}
            <Button type="submit" size="sm" className="ml-auto" disabled={pending || invalid} data-testid="cell-plan">
              {pending ? "Saving…" : rows.length === 1 ? (rows[0].into ? "Add to the post" : "Plan the post") : `Plan ${rows.length} posts`}
            </Button>
          </div>
          {error && <p className="text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
}
