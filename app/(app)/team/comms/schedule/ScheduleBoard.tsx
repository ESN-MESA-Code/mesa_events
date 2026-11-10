"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ChevronLeft, ChevronRight, FileText, Search, Send, Ticket } from "lucide-react";
import { Alert, Button, Card, Input, Select, buttonVariants } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { berlinDate, formatShortDate, monthLabel } from "@/lib/dates";
import { addDays, dayDiff, monthParam } from "@/lib/month";
import { NewPostForm, RegularPostsForm, type TeamMember } from "./PostContent";
import { PostDialog } from "./PostDialog";
import { Board, Mark, MarkerShape } from "./Board";
import { EventPanel } from "./EventPanel";
import {
  BOARD_STEP_WEEKS,
  STATE_TEXT,
  needsPosts,
  stateOf,
  type BoardCategory,
  type BoardChannel,
  type BoardEvent,
  type BoardPost,
  type Coverage,
  type PostState,
  type PretixChecklist,
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
    if (f.big && !e.big) return false;
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
            <Toggle on={f.big} onClick={() => set({ big: !f.big })} testId="filter-big" title="The events the Events team marked as big – advertised weeks ahead">
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
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 border-l border-gray-200 pl-3" title="Per event, in this order: description, pretix page, Telegram, Instagram">
              <span className="text-gray-500">Per event:</span>
              <span className="inline-flex items-center gap-1">
                <Mark icon={FileText} tone="done" label="done" /> done
              </span>
              <span className="inline-flex items-center gap-1">
                <Mark icon={Send} tone="planned" label="planned" /> planned
              </span>
              <span className="inline-flex items-center gap-1">
                <Mark icon={Camera} tone="missing" label="missing" /> missing
              </span>
              <span className="inline-flex items-center gap-1">
                <Mark icon={Ticket} tone="off" label="not needed" /> not needed
              </span>
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
        <PostDialog
          post={opened}
          channel={channelOf.get(opened.channel) ?? { key: opened.channel, name: opened.channel, kind: "manual", required: false }}
          byId={byId}
          editable={editable}
          team={team}
          viewerEmail={viewer.email}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
