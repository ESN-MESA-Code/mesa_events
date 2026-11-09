"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PictureButton, UploadedPicture, pictureProblem } from "@/components/PostPicture";
import { Alert, Badge, Button, Card, Input, Select, buttonVariants } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { confirmPost, deletePost, editPost, markPostPublished, movePost, publishPostNow, removeFromPost, reorderPost, setPostEventPicture, skipPost } from "@/app/actions/publishing";
import { berlinDate, berlinTime, formatDateTime, formatShortDate, monthLabel } from "@/lib/dates";
import { addDays, dayDiff, monthParam } from "@/lib/month";
import { FORMAT_LABEL, isBigEvent, namesOf } from "@/lib/publishing";
import { ContentEditor, NewPostForm, RegularPostsForm, type TeamMember } from "./PostContent";
import { Board, MarkerShape } from "./Board";
import { EventPanel } from "./EventPanel";
import {
  BOARD_STEP_WEEKS,
  STATE_TEXT,
  leadTime,
  needsPosts,
  stateOf,
  type BoardCategory,
  type BoardChannel,
  type BoardEvent,
  type BoardPost,
  type Coverage,
  type PostState,
  type PretixChecklist,
  type PreviewMessage,
} from "./boardModel";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Filters {
  channel: string;
  state: PostState | "";
  mine: boolean;
  /** Upcoming events still missing a required channel. */
  needs: boolean;
  big: boolean;
  category: string;
  q: string;
  /** Past events without posts in view too. */
  past: boolean;
}
const FILTERS_KEY = "mesa:schedule:filters";
const NO_FILTERS: Filters = { channel: "", state: "", mine: false, needs: false, big: false, category: "", q: "", past: false };

/** A toggle in the filter bar. */
function Toggle({ on, onClick, children, testId, title }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={cn("inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition-colors", on ? "border-esn bg-esn text-white" : "border-gray-200 bg-white text-gray-700 hover:border-esn hover:text-esn")}
    >
      {children}
    </button>
  );
}

/**
 * The advertisement schedule (brief 2026-10-29, E3; one board since round
 * 2026-11-09 (5)): the board – a row per event, the days left to right – with
 * the filters above it, the event's panel beside it (below on phones) and
 * the post's dialog. Others' changes come in by Realtime; who else is on the
 * board shows on top.
 */
export function ScheduleBoard({
  range,
  months,
  channels,
  events,
  posts,
  categories,
  editable,
  viewer,
  today,
  coverage,
  pretix,
  team,
  initialFocus = null,
  initialPost = null,
}: {
  /** The window: from a Monday, eight weeks; `isDefault` while it is this week's. */
  range: { from: string; to: string; isDefault: boolean };
  /** The months to jump to ("2026-11-01"). */
  months: string[];
  channels: BoardChannel[];
  /** The listed events (rows) and the others on posts (for their titles). */
  events: BoardEvent[];
  /** The window's posts and every other post of a listed event. */
  posts: BoardPost[];
  categories: BoardCategory[];
  editable: boolean;
  viewer: { email: string; name: string };
  /** Berlin date. */
  today: string;
  coverage: Coverage;
  pretix: PretixChecklist;
  /** Who can make posts (the Comms team). */
  team: TeamMember[];
  /** An event to focus (?event=… from the Comms page). */
  initialFocus?: string | null;
  /** A post to open (?post=… from the content list). */
  initialPost?: string | null;
}) {
  const router = useRouter();
  const action = useAction();
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [open, setOpen] = useState<string | null>(initialPost);
  const [form, setForm] = useState<"" | "new" | "regular">("");
  const [f, setFilters] = useState<Filters>(NO_FILTERS);
  // The filters are remembered on this device (round 2026-11-09 (6)); storage may be blocked.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "null") as Partial<Filters> | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser's storage once
      if (saved) setFilters({ ...NO_FILTERS, ...saved, q: "" });
    } catch {
      // Nothing remembered.
    }
  }, []);
  // Saved when Comms change them – not from an effect, which would store the defaults before they are read.
  const update = (next: Filters) => {
    setFilters(next);
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...next, q: "" }));
    } catch {
      // Not remembered this time.
    }
  };
  const [others, setOthers] = useState<string[]>([]);
  // Phones: the filters folded away behind one button.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = (patch: Partial<Filters>) => update({ ...f, ...patch });

  const days = Array.from({ length: dayDiff(range.from, range.to) + 1 }, (_, i) => addDays(range.from, i));
  const inView = (iso: string) => {
    const d = berlinDate(iso);
    return d >= range.from && d <= range.to;
  };
  const listed = events.filter((e) => e.listed);
  const byId = new Map(events.map((e) => [e.id, e]));
  const channelOf = new Map(channels.map((c) => [c.key, c]));
  const required = channels.filter((c) => c.required);
  const q = f.q.trim().toLowerCase();

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

  // The posts drawn: the window's, through the post filters.
  const postShown = (p: BoardPost) =>
    inView(p.scheduledFor) &&
    (!f.channel || p.channel === f.channel) &&
    (!f.state || stateOf(p) === f.state) &&
    (!f.mine || p.assignees.includes(viewer.email)) &&
    (!q || p.events.length > 0 || (p.title ?? "").toLowerCase().includes(q));
  const shown = posts.filter(postShown);
  const hasPostsInView = (id: string) => posts.some((p) => p.events.includes(id) && p.status !== "skipped" && inView(p.scheduledFor));
  const needing = listed.filter((e) => needsPosts(e, required, coverage, today));
  const rows = events.filter((e) => {
    if (!e.listed) return false;
    if (e.id === focus) return true;
    if (berlinDate(e.startsAt) < today && !f.past && !hasPostsInView(e.id)) return false;
    if (f.needs && !needsPosts(e, required, coverage, today)) return false;
    if (f.big && !isBigEvent(e.type)) return false;
    if (f.category && e.categoryId !== f.category) return false;
    if (q && !e.title.toLowerCase().includes(q)) return false;
    return true;
  });
  const laterFrom = rows.find((e) => berlinDate(e.startsAt) > range.to)?.id ?? null;
  const loose = shown.filter((p) => !p.events.length);
  const showLoose = !f.needs && !f.big && !f.category && (editable || loose.length > 0);
  // The posts per day: every post going out (skipped ones not), of the chosen channel.
  const load = new Map<string, BoardPost[]>();
  for (const p of posts) {
    if (p.status === "skipped" || !inView(p.scheduledFor) || (f.channel && p.channel !== f.channel)) continue;
    const d = berlinDate(p.scheduledFor);
    load.set(d, [...(load.get(d) ?? []), p]);
  }
  const filtered = Object.entries(f).some(([k, v]) => v !== NO_FILTERS[k as keyof Filters]);
  const focused = focus ? (byId.get(focus) ?? null) : null;
  const opened = posts.find((p) => p.id === open) ?? null;
  const usedCategories = categories.filter((c) => listed.some((e) => e.categoryId === c.id));
  const href = (from: string) => `/team/comms/schedule?from=${from}`;
  const rangeLabel = `${formatShortDate(`${range.from}T12:00:00Z`).replace(/^\w+ /, "")} – ${formatShortDate(`${range.to}T12:00:00Z`).replace(/^\w+ /, "")} ${range.to.slice(0, 4)}`;
  const selectCls = "h-8 w-auto py-1 pl-2 pr-7 text-xs";

  return (
    <div className="space-y-3">
      {others.length > 0 && <p className="text-xs text-gray-500">Also on the board: {others.join(", ")}</p>}
      {action.error && <Alert tone="error">{action.error}</Alert>}
      <div className="grid gap-4">
        <Card className="min-w-0 p-3 sm:p-4">
          {/* The weeks shown: ← → by four weeks, back to this week, or a month. */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-1 text-base font-bold text-gray-900">Advertisement board</h2>
            <span className="inline-flex items-center gap-1" data-testid="board-range">
              <Link href={href(addDays(range.from, -7 * BOARD_STEP_WEEKS))} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`${BOARD_STEP_WEEKS} weeks earlier`}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Earlier</span>
              </Link>
              {!range.isDefault && (
                <Link href="/team/comms/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  This week
                </Link>
              )}
              <Link href={href(addDays(range.from, 7 * BOARD_STEP_WEEKS))} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`${BOARD_STEP_WEEKS} weeks later`}>
                <span className="hidden sm:inline">Later</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </span>
            <span className="text-sm font-semibold tabular-nums text-gray-700">{rangeLabel}</span>
            <Select
              aria-label="Jump to a month"
              className={selectCls}
              value=""
              onChange={(e) => e.target.value && router.push(`/team/comms/schedule?month=${e.target.value}`)}
              data-testid="board-jump"
            >
              <option value="">Jump to…</option>
              {months.map((m) => (
                <option key={m} value={monthParam(m)}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
            {action.pending && <span className="text-xs text-gray-500">Saving…</span>}
            {editable && (
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant={form === "new" ? "default" : "outline"} onClick={() => setForm(form === "new" ? "" : "new")} data-testid="new-post">
                  + Post without event
                </Button>
                <Button size="sm" variant={form === "regular" ? "default" : "outline"} onClick={() => setForm(form === "regular" ? "" : "regular")} data-testid="regular-posts">
                  Regular posts
                </Button>
              </span>
            )}
          </div>

          {/* Filters (round 2026-11-09 (5)); on phones behind a button. */}
          <Button size="sm" variant={filtersOpen || filtered ? "default" : "outline"} className="mb-2 sm:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters{filtered ? " (on)" : ""}
          </Button>
          <div className={cn("mb-3 flex-wrap items-center gap-1.5 sm:flex", filtersOpen ? "flex" : "hidden")} role="group" aria-label="Filters" data-testid="board-filters">
            <label className="relative">
              <span className="sr-only">Search events</span>
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-gray-400" aria-hidden="true" />
              <Input type="search" placeholder="Search" value={f.q} onChange={(e) => set({ q: e.target.value })} className="h-8 w-36 pl-7 text-xs" data-testid="filter-search" />
            </label>
            <Select aria-label="Channel" className={selectCls} value={f.channel} onChange={(e) => set({ channel: e.target.value })} data-testid="filter-channel">
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Status of the posts" className={selectCls} value={f.state} onChange={(e) => set({ state: e.target.value as PostState | "" })} data-testid="filter-state">
              <option value="">Any status</option>
              {(["planned", "unconfirmed", "posted", "skipped"] as const).map((s) => (
                <option key={s} value={s}>
                  {STATE_TEXT[s][0].toUpperCase() + STATE_TEXT[s].slice(1)}
                </option>
              ))}
            </Select>
            {usedCategories.length > 0 && (
              <Select aria-label="Category" className={selectCls} value={f.category} onChange={(e) => set({ category: e.target.value })} data-testid="filter-category">
                <option value="">All categories</option>
                {usedCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji ? `${c.emoji} ` : ""}
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            <Toggle on={f.needs} onClick={() => set({ needs: !f.needs })} testId="filter-needs" title="Upcoming events still missing a required channel">
              Needs posts
              <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", f.needs ? "bg-white/25" : needing.length ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500")}>{needing.length}</span>
            </Toggle>
            <Toggle on={f.big} onClick={() => set({ big: !f.big })} testId="filter-big" title="Parties and trips">
              Big events
            </Toggle>
            <Toggle on={f.mine} onClick={() => set({ mine: !f.mine })} testId="only-mine" title="Only the posts you make">
              Mine
            </Toggle>
            <Toggle on={f.past} onClick={() => set({ past: !f.past })} testId="filter-past" title="Events that have passed, also without posts on the board">
              Past events
            </Toggle>
            {filtered && (
              <button type="button" className="px-1 text-xs text-esn hover:underline" onClick={() => update(NO_FILTERS)}>
                Clear
              </button>
            )}
          </div>

          {form === "new" && (
            <div className="mb-3">
              <NewPostForm channels={channels} days={days} today={today} onDone={() => setForm("")} />
            </div>
          )}
          {form === "regular" && (
            <div className="mb-3">
              <RegularPostsForm channels={channels} months={months.filter((m) => m >= `${today.slice(0, 7)}-01`).slice(0, 3)} today={today} onDone={() => setForm("")} />
            </div>
          )}

          <Board
            days={days}
            today={today}
            rows={rows}
            laterFrom={laterFrom}
            posts={shown}
            allPosts={posts}
            load={load}
            showLoose={showLoose}
            channels={channels}
            byId={byId}
            coverage={coverage}
            pretix={pretix}
            categories={categories}
            editable={editable}
            focus={focus}
            onLabel={(id) => setFocus(focus === id ? null : id)}
            onOpenPost={setOpen}
            run={action.run}
          />

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600" data-testid="board-legend">
            <span className="inline-flex items-center gap-1">
              <MarkerShape post={{ channel: "instagram", status: "planned", format: "post", confirmed: false }} /> post
            </span>
            <span className="inline-flex items-center gap-1">
              <MarkerShape post={{ channel: "instagram", status: "planned", format: "story", confirmed: false }} /> story
            </span>
            <span className="inline-flex items-center gap-1">
              <MarkerShape post={{ channel: "instagram", status: "planned", format: "reel", confirmed: false }} /> reel
            </span>
            <span className="inline-flex items-center gap-1">
              <MarkerShape post={{ channel: "instagram", status: "published", format: "post", confirmed: false }} /> posted
            </span>
            <span className="inline-flex items-center gap-1">
              <MarkerShape post={{ channel: "telegram", status: "planned", format: null, confirmed: false }} /> Telegram, not confirmed
            </span>
            <span className="inline-flex items-center gap-1">
              <MarkerShape post={{ channel: "telegram", status: "planned", format: null, confirmed: true }} /> confirmed
            </span>
            <span>📅 the event</span>
            <span className="inline-flex items-center gap-1" title="One post advertising several events: a line joins its markers, the number says how many">
              <span className="relative inline-block h-4 w-1.5">
                <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-sky-500/60" />
                <span className="absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-sky-500" />
                <span className="absolute bottom-0 left-0 h-1.5 w-1.5 rounded-full bg-sky-500" />
              </span>
              posted together
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> warning
            </span>
            <span>
              <span className="rounded bg-red-50 px-0.5 font-semibold text-red-700 ring-1 ring-red-200">TG–</span> required channel missing
            </span>
          </div>
          {editable && (
            <details className="group mt-2 text-xs text-gray-500">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-gray-600 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                  ›
                </span>
                How the board works
              </summary>
              <p className="mt-1 pl-3">
                Click or tap a day on an event&apos;s row (or right-click it) to plan one or more posts there; when that day already has a post on the channel you pick, you can add the event to it instead. The “Without
                an event” row plans posts with a title. Drag a post sideways to move it; click it for the preview, publishing and the rest. Click an event&apos;s name for its details and to plan a whole campaign.
                Keyboard: Tab to the board, arrow keys (Shift for a week), Enter to plan.
              </p>
            </details>
          )}
        </Card>
        {focused && (
          <EventPanel
            event={focused}
            channels={channels}
            coverage={coverage}
            pretix={pretix}
            posts={posts.filter((p) => p.events.includes(focused.id))}
            allPosts={posts}
            byId={byId}
            categories={categories}
            days={days}
            today={today}
            editable={editable}
            onClose={() => setFocus(null)}
            onOpenPost={setOpen}
          />
        )}
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
    </div>
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
