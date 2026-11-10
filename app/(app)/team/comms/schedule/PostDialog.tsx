"use client";

// One post's dialog on the board (redesign round 2026-11-10). It was a narrow
// column with everything stacked – the content form, a preview that scrolled
// inside the scrolling dialog, and the actions as text links at the very end.
// Now: a header that says what the post is (channel, title, when, state), two
// columns – on the left what it advertises and who makes it, on the right the
// thing that goes out (the Telegram messages as the channel will show them,
// or the Instagram caption and design) – and a foot that stays in view with
// the next step as the one filled button.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Ban, CalendarClock, CalendarDays, Check, Copy, ExternalLink, Trash2, X } from "lucide-react";
import { PictureButton, UploadedPicture, pictureProblem } from "@/components/PostPicture";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { useAction } from "@/components/ActionButton";
import { confirmPost, deletePost, editPost, markPostPublished, movePost, publishPostNow, removeFromPost, reorderPost, setPostEventPicture, skipPost, updatePostContent } from "@/app/actions/publishing";
import { berlinDate, berlinTime, formatDateTime, formatShortDate } from "@/lib/dates";
import { CAPTION_MAX, FORMAT_LABEL, PROGRESS, PROGRESS_LABEL, type PostFormat, type Progress } from "@/lib/publishing";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PROGRESS_STYLE, ProgressPill, type TeamMember } from "./PostContent";
import { ChannelTile, FieldLabel, FormatPicker } from "./fields";
import { leadTime, type BoardChannel, type BoardEvent, type BoardPost, type PreviewMessage } from "./boardModel";

interface Props {
  post: BoardPost;
  channel: BoardChannel;
  byId: Map<string, BoardEvent>;
  editable: boolean;
  team: TeamMember[];
  viewerEmail: string;
  onClose: () => void;
}

/** A modal <dialog> for one post: Escape, the ✕ or a click beside it closes it. */
export function PostDialog(props: Props) {
  const { post, channel, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const label = `${post.title ? `${post.title} – ` : ""}${channel.name} ${post.format ? FORMAT_LABEL[post.format].toLowerCase() : "post"}, ${formatDateTime(post.scheduledFor)}`;
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="m-auto w-[min(60rem,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-2xl border border-gray-200 bg-white p-0 shadow-2xl backdrop:bg-gray-900/50"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
      data-testid="post-dialog"
    >
      <PostBody key={post.id} {...props} />
    </dialog>
  );
}

function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {aside && <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const ICON_BUTTON = "flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40";

function PostBody({ post, channel, byId, editable, team, viewerEmail, onClose }: Props) {
  const { run, pending, error, setError, confirm } = useAction();
  const telegram = channel.key === "telegram";
  const planned = post.status === "planned";
  const canEdit = editable && post.status !== "skipped";
  const postDay = berlinDate(post.scheduledFor);
  const titles = post.events.map((id) => byId.get(id)?.title ?? "Event");
  // What a confirm dialog names (usability review #8).
  const postName = `the ${channel.name} post of ${formatDateTime(post.scheduledFor)} (${[post.title, ...post.events.map((id) => byId.get(id)?.title ?? "?")].filter(Boolean).join(", ")})`;

  // What Comms kept in their sheet (round 2026-11-09): the texts are saved with the button in the
  // foot, the choices (format, who, how far) at once.
  const [title, setTitle] = useState(post.title ?? "");
  const [caption, setCaption] = useState(post.caption);
  const [link, setLink] = useState(post.designLink ?? "");
  const [format, setFormat] = useState<PostFormat | "">(post.format ?? "");
  const [who, setWho] = useState<string[]>(post.assignees);
  const [progress, setProgress] = useState<Progress>(post.progress);
  // The choices follow the post when it changes underneath (someone else, or the save coming back).
  const saved = `${post.format ?? ""}|${post.assignees.join()}|${post.progress}`;
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setFormat(post.format ?? "");
    setWho(post.assignees);
    setProgress(post.progress);
  }
  const [copied, setCopied] = useState(false);
  const dirty = title.trim() !== (post.title ?? "") || caption.trim() !== post.caption || link.trim() !== (post.designLink ?? "");
  const save = (patch: Partial<{ format: PostFormat | ""; assignees: string[]; progress: Progress }> = {}, done?: string) =>
    run(
      updatePostContent,
      {
        post_id: post.id,
        title: title.trim(),
        format: patch.format ?? format,
        assignees: patch.assignees ?? who,
        progress: patch.progress ?? progress,
        caption: caption.trim(),
        design_link: link.trim(),
      },
      undefined,
      done
    );
  const toggleWho = (email: string) => {
    const next = who.includes(email) ? who.filter((x) => x !== email) : who.length < 3 ? [...who, email] : who;
    if (next === who) return;
    setWho(next);
    save({ assignees: next });
  };

  // Move, skip, mark posted: one small form at a time, above the buttons.
  const [mode, setMode] = useState<"" | "move" | "publish" | "skip">("");
  const [day, setDay] = useState(postDay);
  const [time, setTime] = useState(berlinTime(post.scheduledFor));
  const [text, setText] = useState("");
  const flip = (m: typeof mode) => (setText(""), setMode(mode === m ? "" : m));
  const [uploading, setUploading] = useState<number | null>(null);
  const busy = pending || uploading !== null;

  const moveEvent = (i: number, by: number) => {
    const ids = [...post.events];
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    run(reorderPost, { post_id: post.id, event_ids: ids });
  };
  const postNow = async () => {
    const again = post.status === "published";
    if (
      await confirm({
        title: again ? "Edit the Telegram post now?" : "Post this to the Telegram channel now?",
        body: again ? `The channel's messages for ${postName} are replaced with the preview.` : `${postName} goes out to everyone in the channel at once, not at its planned time.`,
        confirmLabel: again ? "Edit the post" : "Post now",
      })
    )
      run(publishPostNow, { post_id: post.id }, undefined, again ? "Telegram post updated." : "Posted to the Telegram channel.");
  };

  const badge =
    post.status === "published"
      ? { tone: "green" as const, text: "✓ posted" }
      : post.status === "skipped"
        ? { tone: "gray" as const, text: "⨯ skipped" }
        : telegram && !post.confirmed
          ? { tone: "amber" as const, text: `⏸ ${berlinTime(post.scheduledFor)} · not confirmed` }
          : { tone: "blue" as const, text: `⏰ ${berlinTime(post.scheduledFor)}${telegram ? " · confirmed" : ""}` };
  const kind = telegram ? "message" : post.format ? FORMAT_LABEL[post.format].toLowerCase() : "post";

  return (
    <div className="flex max-h-[calc(100dvh-3rem)] flex-col text-sm" data-testid={`post-details-${post.id}`}>
      {/* What the post is. */}
      <header className="flex items-start gap-3 border-b border-gray-200 px-4 py-3.5 sm:px-5">
        <ChannelTile channel={channel.key} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {channel.name} {kind}
            {post.events.length > 1 && ` · ${post.events.length} events together`}
          </p>
          <h2 className="break-words text-base font-bold leading-snug text-gray-900 sm:text-lg">{post.title || titles.join(" + ") || "Post"}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CalendarDays className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              {formatDateTime(post.scheduledFor)}
            </span>
            <Badge tone={badge.tone}>{badge.text}</Badge>
            {post.status === "published" && post.link && (
              <a href={post.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-esn hover:underline">
                Open the post
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </p>
        </div>
        <button type="button" className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Close" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {/* Left: what it advertises, who makes it, how far it is. */}
        <div className="space-y-5 p-4 sm:p-5 lg:overflow-y-auto lg:border-r lg:border-gray-200">
          {post.lastError && (
            <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid="post-error">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">It did not go out:</strong> {post.lastError}
              </span>
            </p>
          )}
          {post.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {post.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2" data-testid="post-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {post.status === "skipped" && <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">Skipped{post.skipReason ? `: ${post.skipReason}` : "."}</p>}

          <Section title={post.events.length > 1 ? "Advertises – in this order" : "Advertises"}>
            {post.events.length ? (
              <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {post.events.map((id, i) => {
                  const ev = byId.get(id);
                  const lead = ev ? leadTime(postDay, ev.startsAt) : null;
                  return (
                    <li key={id} className="flex items-center gap-2 px-3 py-2">
                      {post.events.length > 1 && (
                        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold tabular-nums text-gray-600">
                          {i + 1}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-gray-900">{ev?.title ?? "Event"}</span>
                        {lead && (
                          <span className={cn("block text-xs", lead.late ? "font-medium text-red-700" : "text-gray-500")}>
                            {formatShortDate(ev!.startsAt)} · {lead.text}
                          </span>
                        )}
                      </span>
                      {canEdit && (
                        <span className="flex shrink-0">
                          {i > 0 && (
                            <button type="button" aria-label="Move up" title="Move up" className={ICON_BUTTON} disabled={pending} onClick={() => moveEvent(i, -1)}>
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {i < post.events.length - 1 && (
                            <button type="button" aria-label="Move down" title="Move down" className={ICON_BUTTON} disabled={pending} onClick={() => moveEvent(i, 1)}>
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove ${ev?.title ?? "event"}`}
                            title="Take this event out of the post"
                            className={cn(ICON_BUTTON, "hover:bg-red-50 hover:text-red-600")}
                            disabled={pending}
                            onClick={() => run(removeFromPost, { post_id: post.id, event_id: id })}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">No event – a post of its own (the month&apos;s calendar, “This week”, a recap …).</p>
            )}
          </Section>

          <Section title="Planning" aside={<ProgressPill post={{ status: post.status, progress }} />}>
            <div className="space-y-1">
              <FieldLabel htmlFor={`post-title-${post.id}`} className="normal-case tracking-normal text-gray-600">
                Title{post.events.length > 0 && <span className="font-normal text-gray-400"> – optional</span>}
              </FieldLabel>
              <Input id={`post-title-${post.id}`} aria-label="Title" placeholder={post.events.length ? "e.g. Sales NOW" : "e.g. December calendar"} value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            {!telegram && (
              <div className="space-y-1">
                <FieldLabel className="normal-case tracking-normal text-gray-600">Format</FieldLabel>
                <FormatPicker value={format} disabled={!canEdit || pending} label="Format" onChange={(f) => (setFormat(f), save({ format: f }))} />
              </div>
            )}
            <fieldset className="space-y-1">
              <legend className="text-[11px] font-semibold text-gray-600">Who makes it{canEdit && <span className="font-normal text-gray-400"> – up to three</span>}</legend>
              <div className="flex flex-wrap gap-1.5" data-testid="post-assignees">
                {team.map((m) => {
                  const on = who.includes(m.email);
                  return (
                    <button
                      key={m.email}
                      type="button"
                      disabled={!canEdit || pending || (!on && who.length >= 3)}
                      aria-pressed={on}
                      onClick={() => toggleWho(m.email)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                        on ? "border-esn bg-esn text-white" : "border-gray-200 text-gray-700 hover:border-esn hover:text-esn disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:text-gray-700"
                      )}
                    >
                      {on && <Check className="h-3 w-3" aria-hidden="true" />}
                      {m.name}
                      {m.email === viewerEmail ? " (you)" : ""}
                    </button>
                  );
                })}
                {!team.length && <span className="text-xs text-gray-500">Nobody is in the Comms team yet.</span>}
              </div>
            </fieldset>
            {planned && (
              <div className="space-y-1">
                <FieldLabel className="normal-case tracking-normal text-gray-600">How far it is</FieldLabel>
                <div className="flex gap-1.5" role="radiogroup" aria-label="Progress">
                  {PROGRESS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={progress === p}
                      disabled={!canEdit || pending}
                      onClick={() => progress !== p && (setProgress(p), save({ progress: p }))}
                      className={cn(
                        "inline-flex h-8 flex-1 items-center justify-center rounded-lg border px-2 text-xs transition-colors disabled:cursor-not-allowed",
                        progress === p ? cn("border-transparent font-semibold ring-1 ring-inset ring-black/10", PROGRESS_STYLE[p]) : "border-gray-200 text-gray-600 hover:border-gray-400"
                      )}
                    >
                      {PROGRESS_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right: the thing that goes out. */}
        <div className="space-y-4 border-t border-gray-200 bg-gray-50 p-4 sm:p-5 lg:overflow-y-auto lg:border-t-0">
          {telegram ? (
            post.status === "skipped" ? (
              <p className="text-xs text-gray-500">Skipped – nothing goes to the Telegram channel.</p>
            ) : (
              <TelegramPreview post={post} byId={byId} canEdit={canEdit} busy={busy} uploading={uploading} setUploading={setUploading} run={run} setError={setError} />
            )
          ) : (
            <>
              <Section
                title="Caption"
                aside={
                  <>
                    <span className={cn("tabular-nums", caption.length > CAPTION_MAX && "font-semibold text-red-700")}>
                      {caption.length} / {CAPTION_MAX}
                    </span>
                    {caption.trim() && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium text-esn hover:underline"
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
                  </>
                }
              >
                <Textarea aria-label="Caption" rows={9} value={caption} disabled={!canEdit} onChange={(e) => setCaption(e.target.value)} placeholder={`The text that goes with the post – written here, copied into ${channel.name}.`} className="bg-white" />
              </Section>
              <Section title="Design">
                <div className="flex items-center gap-2">
                  <Input aria-label="Design link" placeholder="Link to the design (Canva, Drive …)" value={link} disabled={!canEdit} onChange={(e) => setLink(e.target.value)} className="bg-white" />
                  {post.designLink && (
                    <a href={post.designLink} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-esn hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open
                    </a>
                  )}
                </div>
              </Section>
              {channel.kind === "manual" && planned && <p className="text-xs text-gray-500">{channel.name} is posted by hand: copy the caption, post it, then mark it posted here with the link.</p>}
            </>
          )}
        </div>
      </div>

      {/* The next step, always in view. */}
      <footer className="space-y-2 border-t border-gray-200 bg-white px-4 py-3 sm:px-5">
        {mode === "move" && (
          <form className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2.5" onSubmit={(e) => (e.preventDefault(), run(movePost, { post_id: post.id, day, time }, () => setMode(""), "Post moved."))}>
            <label className="space-y-1">
              <FieldLabel>New day</FieldLabel>
              <Input aria-label="New day" type="date" className="h-8 w-40 text-xs" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="space-y-1">
              <FieldLabel>Time</FieldLabel>
              <Input aria-label="New time" type="time" className="h-8 w-28 text-xs" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <Button size="sm" disabled={pending || !day}>
              Move
            </Button>
            {telegram && post.confirmed && <span className="pb-1.5 text-xs text-gray-500">Moving it takes the confirmation back.</span>}
          </form>
        )}
        {mode === "publish" && (
          <form className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2.5" onSubmit={(e) => (e.preventDefault(), run(markPostPublished, { post_id: post.id, link: text }, () => setMode(""), "Marked as posted."))}>
            <label className="min-w-0 flex-1 space-y-1">
              <FieldLabel>Link of the published post</FieldLabel>
              <Input aria-label="Link of the published post" placeholder="https://…" className="h-8 text-xs" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
            </label>
            <Button size="sm" disabled={pending}>
              Save link
            </Button>
          </form>
        )}
        {mode === "skip" && (
          <form className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2.5" onSubmit={(e) => (e.preventDefault(), run(skipPost, { post_id: post.id, reason: text }, () => setMode(""), "Post skipped."))}>
            <label className="min-w-0 flex-1 space-y-1">
              <FieldLabel>Why skip it</FieldLabel>
              <Input aria-label="Why skip it" placeholder="e.g. the event is full" className="h-8 text-xs" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
            </label>
            <Button size="sm" variant="outline" disabled={pending}>
              Skip the post
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {canEdit && planned && (
            <>
              <Button type="button" size="sm" variant="ghost" aria-expanded={mode === "move"} className={cn("gap-1.5 px-2", mode === "move" && "bg-gray-100")} onClick={() => flip("move")}>
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Change day
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-expanded={mode === "skip"} className={cn("gap-1.5 px-2", mode === "skip" && "bg-gray-100")} onClick={() => flip("skip")}>
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Skip
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 px-2 hover:bg-red-50 hover:text-red-700"
                onClick={async () => {
                  if (await confirm({ title: "Delete this post?", body: `Deletes ${postName}. An uploaded picture is removed too.`, confirmLabel: "Delete", danger: true })) run(deletePost, { post_id: post.id }, undefined, "Post deleted.");
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete
              </Button>
            </>
          )}
          {!editable && <span className="text-xs text-gray-500">Only the Comms team changes posts.</span>}
          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {telegram && planned && post.confirmed && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700" title="Any change takes the confirmation back.">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Confirmed – goes out by itself at {berlinTime(post.scheduledFor)}
              </span>
            )}
            {canEdit && dirty && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => save({}, "Saved.")} data-testid="post-save">
                Save changes
              </Button>
            )}
            {canEdit && !telegram && planned && !who.includes(viewerEmail) && team.some((m) => m.email === viewerEmail) && who.length < 3 && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => toggleWho(viewerEmail)}>
                I&apos;ll do it
              </Button>
            )}
            {canEdit && telegram && !post.refusal && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={postNow}>
                {post.status === "published" ? "Post again (edits the messages)" : post.confirmed ? "Post now" : "Confirm and post now"}
              </Button>
            )}
            {canEdit && telegram && planned && !post.confirmed && !post.refusal && (
              <Button type="button" size="sm" disabled={busy} onClick={() => run(confirmPost, { post_id: post.id }, undefined, "Confirmed – it goes out at its time.")}>
                Confirm for {formatDateTime(post.scheduledFor)}
              </Button>
            )}
            {canEdit && channel.kind === "manual" && planned && (
              <Button type="button" size="sm" aria-expanded={mode === "publish"} disabled={pending} onClick={() => flip("publish")}>
                Mark posted
              </Button>
            )}
            {(!canEdit || !planned) && (
              <Button type="button" size="sm" variant="outline" onClick={onClose}>
                Done
              </Button>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * A Telegram post as the channel will show it (round 2026-11-03): one bubble
 * per message (one per event, after the heading of a post of several), each
 * with its picture – its own, else the default of its format, category or
 * type – and a button to add, replace or remove it (saved at once).
 */
function TelegramPreview({
  post,
  byId,
  canEdit,
  busy,
  uploading,
  setUploading,
  run,
  setError,
}: {
  post: BoardPost;
  byId: Map<string, BoardEvent>;
  canEdit: boolean;
  busy: boolean;
  uploading: number | null;
  setUploading: (i: number | null) => void;
  run: ReturnType<typeof useAction>["run"];
  setError: (message: string | null) => void;
}) {
  const [note, setNote] = useState(post.note);
  const messages = post.preview ?? [];

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
    <div className="space-y-3" data-testid="telegram-preview">
      {post.refusal && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="telegram-refusal">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{post.refusal} It can stay planned; confirm it once that is sorted – until then it does not go out.</span>
        </p>
      )}
      <Section title="Preview">
        <p className="text-xs text-gray-600">This goes to the Telegram channel{messages.length > 1 ? ` as ${messages.length} messages` : ""}:</p>
        <ol className="space-y-3 rounded-xl bg-sky-100/70 p-3">
          {messages.map((m, i) => (
            <li key={i} className="space-y-1.5" data-testid="telegram-message">
              {messages.length > 1 && (
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-sky-900/70">
                  Message {i + 1}
                  {m.eventId ? ` · ${byId.get(m.eventId)?.title ?? "Event"}` : " · heading"}
                </p>
              )}
              <div className="overflow-hidden rounded-2xl rounded-tl-md bg-white shadow-sm ring-1 ring-black/5">
                {m.picture && (
                  <div className="relative bg-gray-100">
                    <UploadedPicture picture={m.picture} className="max-h-72 w-full rounded-none border-0" />
                    {m.isDefault && <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Default picture (Pictures tab)</span>}
                  </div>
                )}
                <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-[13px] leading-5 text-gray-800">{m.text}</pre>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2 px-1" data-testid="telegram-picture">
                  <PictureButton label={m.picture && !m.isDefault ? "Replace the picture" : m.picture ? "Use another picture" : "Add a picture"} disabled={busy} onFile={(f) => upload(i, f)} />
                  {m.picture && !m.isDefault && (
                    <button type="button" className="text-xs text-gray-600 hover:underline" disabled={busy} onClick={() => setPicture(m, "")}>
                      Remove the picture
                    </button>
                  )}
                  {uploading === i && <span className="text-xs text-gray-500">Uploading…</span>}
                </div>
              )}
            </li>
          ))}
          {!messages.length && <li className="text-xs text-gray-500">Nothing to preview yet.</li>}
        </ol>
      </Section>
      {canEdit && post.events.length > 1 && (
        <form className="space-y-1" onSubmit={(e) => (e.preventDefault(), run(editPost, { post_id: post.id, picture: post.picture ?? "", note }, undefined, "Heading saved."))}>
          <FieldLabel htmlFor={`post-heading-${post.id}`}>
            Heading message<span className="font-normal normal-case tracking-normal text-gray-400"> – optional, goes first</span>
          </FieldLabel>
          <div className="flex gap-2">
            <Input id={`post-heading-${post.id}`} aria-label="Heading of the bundle" placeholder="e.g. This week at ESN MESA" value={note} onChange={(e) => setNote(e.target.value)} className="bg-white" />
            {note.trim() !== post.note && (
              <Button size="sm" variant="outline" className="h-auto shrink-0" disabled={busy}>
                Save
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
