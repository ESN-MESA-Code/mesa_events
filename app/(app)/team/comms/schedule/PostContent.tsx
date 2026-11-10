"use client";

// Content planning on the schedule (round 2026-11-09) – what Comms kept in
// their planning sheet: what a post is (post / story / reel), who makes it,
// how far it is, its caption and design link; posts without an event (the
// month's calendar, "This week", a recap …) and the regular ones planned in
// one go.
import { useState } from "react";
import { CalendarPlus, Repeat } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createPost, planRegularPosts } from "@/app/actions/publishing";
import { FORMAT_LABEL, POST_FORMATS, PROGRESS_LABEL, regularPosts, type PostFormat, type Progress } from "@/lib/publishing";
import { formatShortDate, monthLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { BoardChannel, BoardPost } from "./boardModel";

export interface TeamMember {
  email: string;
  name: string;
}

/** "AM" – a member's initials on a post chip. */
export const initials = (name: string) =>
  name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const PROGRESS_STYLE: Record<Progress, string> = {
  todo: "bg-gray-100 text-gray-600",
  in_progress: "bg-amber-100 text-amber-900",
  ready: "bg-emerald-100 text-emerald-800",
};

/** The post's progress as a small pill; posted and skipped posts say so instead. */
export function ProgressPill({ post, className }: { post: Pick<BoardPost, "status" | "progress">; className?: string }) {
  if (post.status === "published") return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", "bg-emerald-600 text-white", className)}>Posted</span>;
  if (post.status === "skipped") return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", "bg-gray-100 text-gray-500", className)}>Skipped</span>;
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", PROGRESS_STYLE[post.progress], className)}>{PROGRESS_LABEL[post.progress]}</span>;
}

/** A post with no event: the month's calendar, an awareness post, a recap … (not on Telegram: its messages are made from events). */
export function NewPostForm({ channels, days, today, onDone }: { channels: BoardChannel[]; days: string[]; today: string; onDone: () => void }) {
  const { run, pending, error } = useAction();
  const usable = channels.filter((c) => c.key !== "telegram");
  const [ch, setCh] = useState(usable[0]?.key ?? "");
  const [format, setFormat] = useState<PostFormat>("post");
  const [day, setDay] = useState(days.find((d) => d >= today) ?? days[0] ?? today);
  const [time, setTime] = useState("10:00");
  const [title, setTitle] = useState("");
  if (!usable.length) return <p className="text-xs text-gray-500">Posts without an event go on Instagram or another manual channel – none is switched on.</p>;
  return (
    <form
      className="grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_9rem_8rem]"
      onSubmit={(e) => (e.preventDefault(), run(createPost, { channel: ch, day, time, event_ids: [], title: title.trim(), format }, () => (setTitle(""), onDone()), "Post planned."))}
      data-testid="new-post-form"
    >
      <Input aria-label="Title of the new post" placeholder="Title, e.g. Awareness post, October recap" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className="sm:col-span-3" />
      <Select aria-label="Channel of the new post" value={ch} onChange={(e) => setCh(e.target.value)}>
        {usable.map((c) => (
          <option key={c.key} value={c.key}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Format of the new post" value={format} onChange={(e) => setFormat(e.target.value as PostFormat)}>
        {POST_FORMATS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABEL[f]}
          </option>
        ))}
      </Select>
      <span />
      <Input aria-label="Day of the new post" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      <Input aria-label="Time of the new post" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <Button size="sm" disabled={pending || !title.trim()}>
        <CalendarPlus className="mr-1 h-4 w-4" aria-hidden="true" />
        Plan it
      </Button>
      {error && <p className="text-xs text-red-600 sm:col-span-3">{error}</p>}
    </form>
  );
}

/** A month's regular posts in one go: "This week" every Sunday, the next month's calendar. `months`: the ones to pick from ("2026-11-01"). */
export function RegularPostsForm({ channels, months, today, onDone }: { channels: BoardChannel[]; months: string[]; today: string; onDone: () => void }) {
  const { run, pending, error } = useAction();
  const [month, setMonth] = useState(months[0] ?? `${today.slice(0, 7)}-01`);
  const usable = channels.filter((c) => c.key !== "telegram");
  const [ch, setCh] = useState(usable.find((c) => c.key === "instagram")?.key ?? usable[0]?.key ?? "");
  const [weekly, setWeekly] = useState(true);
  const [calendar, setCalendar] = useState(true);
  const list = regularPosts(month, today).filter((p) => (p.kind === "weekly" ? weekly : calendar));
  if (!usable.length) return null;
  return (
    <form
      className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm"
      onSubmit={(e) => (e.preventDefault(), run(planRegularPosts, { channel: ch, month, weekly, calendar }, () => onDone(), (r) => (r.made ? `${r.made} posts planned.` : "They were all planned already.")))}
      data-testid="regular-posts-form"
    >
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-esn" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> &ldquo;This week&rdquo; story every Sunday
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-esn" checked={calendar} onChange={(e) => setCalendar(e.target.checked)} /> Next month&apos;s calendar post
        </label>
        {months.length > 1 && (
          <Select aria-label="Month of the regular posts" value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto py-1 text-xs">
            {months.map((m) => (
              <option key={m} value={m}>
                in {monthLabel(m)}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Channel of the regular posts" value={ch} onChange={(e) => setCh(e.target.value)} className="w-auto py-1 text-xs">
          {usable.map((c) => (
            <option key={c.key} value={c.key}>
              on {c.name}
            </option>
          ))}
        </Select>
      </div>
      <ul className="flex flex-wrap gap-1 text-xs text-gray-600">
        {list.map((p) => (
          <li key={p.day + p.title} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-gray-200">
            {formatShortDate(`${p.day}T12:00:00Z`)}: {p.title}
          </li>
        ))}
        {!list.length && <li>Nothing left to plan this month.</li>}
      </ul>
      <Button size="sm" disabled={pending || !list.length}>
        <Repeat className="mr-1 h-4 w-4" aria-hidden="true" />
        Plan {list.length} posts
      </Button>
      <p className="text-xs text-gray-500">Already planned ones (same channel, day and title) are left as they are.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
