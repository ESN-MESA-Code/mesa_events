"use client";

// Content planning on the schedule (round 2026-11-09) – what Comms kept in
// their planning sheet: what a post is (post / story / reel), who makes it,
// how far it is, its caption and design link; posts without an event (the
// month's calendar, "This week", a recap …) and the regular ones planned in
// one go.
import { useState } from "react";
import { CalendarPlus, Check, Copy, ExternalLink, Repeat } from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { createPost, planRegularPosts, updatePostContent } from "@/app/actions/publishing";
import { CAPTION_MAX, FORMAT_LABEL, POST_FORMATS, PROGRESS, PROGRESS_LABEL, regularPosts, type PostFormat, type Progress } from "@/lib/publishing";
import { formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { BoardChannel, BoardPost } from "./ScheduleBoard";

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

/** What, who, how far, the caption and the design – the spreadsheet's row of a post. */
export function ContentEditor({ post, team, editable, viewerEmail }: { post: BoardPost; team: TeamMember[]; editable: boolean; viewerEmail: string }) {
  const { run, pending, error } = useAction();
  const [title, setTitle] = useState(post.title ?? "");
  const [format, setFormat] = useState<PostFormat | "">(post.format ?? "");
  const [who, setWho] = useState<string[]>(post.assignees);
  const [progress, setProgress] = useState<Progress>(post.progress);
  const [caption, setCaption] = useState(post.caption);
  const [link, setLink] = useState(post.designLink ?? "");
  const [copied, setCopied] = useState(false);
  const canEdit = editable && post.status !== "skipped";
  const dirty =
    title.trim() !== (post.title ?? "") ||
    format !== (post.format ?? "") ||
    who.join() !== post.assignees.join() ||
    progress !== post.progress ||
    caption.trim() !== post.caption ||
    link.trim() !== (post.designLink ?? "");
  const save = (patch: Partial<{ progress: Progress; assignees: string[] }> = {}) =>
    run(updatePostContent, {
      post_id: post.id,
      title: title.trim(),
      format,
      assignees: patch.assignees ?? who,
      progress: patch.progress ?? progress,
      caption: caption.trim(),
      design_link: link.trim(),
    });
  const toggle = (email: string) => setWho((w) => (w.includes(email) ? w.filter((x) => x !== email) : w.length < 3 ? [...w, email] : w));

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 p-2.5" data-testid="post-content">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Content</h3>
        <ProgressPill post={{ status: post.status, progress }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Input aria-label="Title" placeholder={post.events.length ? "Title (optional), e.g. Sales NOW" : "Title, e.g. December calendar"} value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <Select aria-label="Format" value={format} disabled={!canEdit} onChange={(e) => setFormat(e.target.value as PostFormat | "")}>
          <option value="">Format…</option>
          {POST_FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </Select>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600">Who makes it (up to three)</legend>
        <div className="flex flex-wrap gap-1" data-testid="post-assignees">
          {team.map((m) => {
            const on = who.includes(m.email);
            return (
              <button
                key={m.email}
                type="button"
                disabled={!canEdit || (!on && who.length >= 3)}
                aria-pressed={on}
                onClick={() => toggle(m.email)}
                className={cn("rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50", on ? "border-esn bg-esn text-white" : "border-gray-200 text-gray-700 hover:border-esn")}
              >
                {m.name}
                {m.email === viewerEmail ? " (you)" : ""}
              </button>
            );
          })}
          {!team.length && <span className="text-xs text-gray-500">Nobody is in the Comms team yet.</span>}
        </div>
      </fieldset>

      {post.status === "planned" && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Progress">
          {PROGRESS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={progress === p}
              disabled={!canEdit}
              onClick={() => setProgress(p)}
              className={cn("rounded-md border px-2 py-0.5 text-xs", progress === p ? cn("border-transparent font-semibold", PROGRESS_STYLE[p]) : "border-gray-200 text-gray-600 hover:border-esn")}
            >
              {PROGRESS_LABEL[p]}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <label htmlFor={`caption-${post.id}`} className="font-medium">
            Caption
          </label>
          <span className={cn("ml-auto tabular-nums", caption.length > CAPTION_MAX && "font-semibold text-red-700")}>
            {caption.length}/{CAPTION_MAX}
          </span>
          {caption.trim() && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-esn hover:underline"
              onClick={async () => {
                await navigator.clipboard?.writeText(caption.trim());
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        <Textarea id={`caption-${post.id}`} rows={4} value={caption} disabled={!canEdit} onChange={(e) => setCaption(e.target.value)} placeholder="The text that goes with the post – written here, copied into Instagram." />
      </div>
      <div className="flex gap-1">
        <Input aria-label="Design link" placeholder="Design link (Canva, Drive …)" value={link} disabled={!canEdit} onChange={(e) => setLink(e.target.value)} />
        {post.designLink && (
          <a href={post.designLink} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 px-1 text-xs text-esn hover:underline">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
          </a>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending || !dirty} onClick={() => save()}>
            Save
          </Button>
          {!who.includes(viewerEmail) && team.some((m) => m.email === viewerEmail) && who.length < 3 && (
            <button type="button" className="text-xs text-esn hover:underline" disabled={pending} onClick={() => (setWho([...who, viewerEmail]), save({ assignees: [...who, viewerEmail] }))}>
              I&apos;ll do it
            </button>
          )}
          {post.status === "planned" && progress !== "ready" && !dirty && (
            <button type="button" className="text-xs text-esn hover:underline" disabled={pending} onClick={() => (setProgress("ready"), save({ progress: "ready" }))}>
              Mark ready
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
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

/** The month's regular posts in one go: "This week" every Sunday, the next month's calendar. */
export function RegularPostsForm({ channels, month, today, onDone }: { channels: BoardChannel[]; month: string; today: string; onDone: () => void }) {
  const { run, pending, error } = useAction();
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
