// The advertisement schedule (brief 2026-10-29, E3): posts on a channel and
// day, bundles of events, moving, publishing (Telegram by the platform,
// the manual channels marked with a link), skipping. Comms only; the
// database checks again. Admins switch channels on and off.
import { z } from "zod";
import { ActionError, dbError, defineAction, PAGES, requireRole, uuid } from "@/lib/actions/core";
import { berlinInputToIso } from "@/lib/dates";
import { DEFAULT_POST_HOUR } from "@/lib/publishing";
import { libraryPath, uploadPath } from "@/lib/telegram/picture";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const channel = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);
const at = (d: string, t?: string) => berlinInputToIso(`${d}T${t ?? DEFAULT_POST_HOUR}`);
const BOARD = [PAGES.schedule, PAGES.comms, PAGES.home, PAGES.event];

export const createPost = defineAction(z.object({ channel, day, time: time.optional(), event_ids: z.array(uuid).min(1).max(20) }), async (ctx, i) => {
  requireRole(ctx, "comms");
  const { data, error } = await ctx.supabase.rpc("create_post", { channel: i.channel, scheduled_for: at(i.day, i.time), events: i.event_ids });
  dbError(error);
  return { id: data as string };
}, { revalidate: BOARD });

/** One event on every required channel on the schedule (Telegram, Instagram) it is not on yet, on one day. */
export const planEverywhere = defineAction(z.object({ event_id: uuid, day, time: time.optional() }), async (ctx, i) => {
  requireRole(ctx, "comms");
  const { data, error } = await ctx.supabase.rpc("plan_everywhere", { event: i.event_id, scheduled_for: at(i.day, i.time) });
  dbError(error);
  return { posts: (data ?? []).length };
}, { revalidate: BOARD });

export const addToPost = defineAction(z.object({ post_id: uuid, event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("add_to_post", { post: i.post_id, event: i.event_id })).error);
}, { revalidate: BOARD });

export const removeFromPost = defineAction(z.object({ post_id: uuid, event_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("remove_from_post", { post: i.post_id, event: i.event_id })).error);
}, { revalidate: BOARD });

export const reorderPost = defineAction(z.object({ post_id: uuid, event_ids: z.array(uuid).min(1).max(20) }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("reorder_post", { post: i.post_id, events: i.event_ids })).error);
}, { revalidate: [PAGES.schedule] });

export const movePost = defineAction(z.object({ post_id: uuid, day, time }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("move_post", { post: i.post_id, scheduled_for: at(i.day, i.time) })).error);
}, { revalidate: BOARD });

/** The picture is uploaded first (post-pictures/<post id>/…); a replaced upload is removed. */
export const editPost = defineAction(
  z.object({
    post_id: uuid,
    picture: z
      .string()
      .trim()
      .max(500)
      .refine((p) => !p || /^upload:[0-9a-f-]{36}\/[\w.-]+$/.test(p), "Upload the picture again.")
      .default(""),
    note: z.string().trim().max(500).default(""),
  }),
  async (ctx, i) => {
    requireRole(ctx, "comms");
    const { data: before } = await ctx.supabase.from("publication_posts").select("picture").eq("id", i.post_id).maybeSingle();
    if (i.picture && !i.picture.startsWith(`upload:${i.post_id}/`)) throw new ActionError("failed", "Upload the picture for this post.");
    dbError((await ctx.supabase.rpc("edit_post", { post: i.post_id, picture: i.picture, note: i.note })).error);
    const old = uploadPath(before?.picture);
    if (old && before?.picture !== i.picture) await ctx.supabase.storage.from("post-pictures").remove([old]);
  },
  { revalidate: [PAGES.schedule] }
);

/** Telegram: Comms looked at the preview – the post goes out at its time. */
export const confirmPost = defineAction(z.object({ post_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("confirm_post", { post: i.post_id })).error);
}, { revalidate: BOARD });

export const publishPostNow = defineAction(z.object({ post_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("publish_post_now", { post: i.post_id })).error);
}, { revalidate: BOARD });

export const markPostPublished = defineAction(z.object({ post_id: uuid, link: z.url({ protocol: /^https?$/, error: "Paste the link of the published post" }).max(500) }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("mark_post_published", { post: i.post_id, link: i.link })).error);
}, { revalidate: BOARD });

export const skipPost = defineAction(z.object({ post_id: uuid, reason: z.string().trim().min(1, "Give a reason").max(300) }), async (ctx, i) => {
  requireRole(ctx, "comms");
  dbError((await ctx.supabase.rpc("skip_post", { post: i.post_id, reason: i.reason })).error);
}, { revalidate: BOARD });

/** pretix is a checklist (round 2026-10-31): the event's pretix page is up (with its link, optionally) – or not after all. */
export const setPretixReady = defineAction(
  z.object({ event_id: uuid, ready: z.boolean(), link: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "Paste the link of the pretix page" }).max(500)]).default("") }),
  async (ctx, i) => {
    requireRole(ctx, "comms");
    dbError((await ctx.supabase.rpc("set_pretix_ready", { event: i.event_id, ready: i.ready, link: i.link })).error);
  },
  { revalidate: BOARD }
);

export const deletePost = defineAction(z.object({ post_id: uuid }), async (ctx, i) => {
  requireRole(ctx, "comms");
  const { data: before } = await ctx.supabase.from("publication_posts").select("picture").eq("id", i.post_id).maybeSingle();
  dbError((await ctx.supabase.rpc("delete_post", { post: i.post_id })).error);
  const old = uploadPath(before?.picture);
  if (old) await ctx.supabase.storage.from("post-pictures").remove([old]);
}, { revalidate: BOARD });

export const setChannelEnabled = defineAction(z.object({ channel, enabled: z.boolean() }), async (ctx, i) => {
  requireRole(ctx, "admin");
  dbError((await ctx.supabase.rpc("set_channel_enabled", { channel: i.channel, enabled: i.enabled })).error);
}, { revalidate: [PAGES.admin, PAGES.schedule, PAGES.comms] });

const uploaded = (postId: string) =>
  z
    .string()
    .trim()
    .max(500)
    .refine((p) => !p || p.startsWith(`upload:${postId}/`), "Upload the picture for this post.");

/** One event's own picture in a post (round 2026-11-03): uploaded first (post-pictures/<post id>/…); a replaced upload is removed. */
export const setPostEventPicture = defineAction(z.object({ post_id: uuid, event_id: uuid, picture: z.string().trim().max(500).default("") }), async (ctx, i) => {
  requireRole(ctx, "comms");
  if (i.picture && !uploaded(i.post_id).safeParse(i.picture).success) throw new ActionError("failed", "Upload the picture for this post.");
  const [{ data: before }, { data: post }] = await Promise.all([
    ctx.supabase.from("publication_post_events").select("picture").eq("post_id", i.post_id).eq("event_id", i.event_id).maybeSingle(),
    ctx.supabase.from("publication_posts").select("picture").eq("id", i.post_id).maybeSingle(),
  ]);
  dbError((await ctx.supabase.rpc("set_post_event_picture", { post: i.post_id, event: i.event_id, picture: i.picture })).error);
  const { data: after } = await ctx.supabase.from("publication_posts").select("picture").eq("id", i.post_id).maybeSingle();
  // The replaced picture of the event – and the post's own when the event's took its place.
  const gone = [before?.picture !== i.picture ? before?.picture : null, post?.picture && !after?.picture ? post.picture : null].map((p) => uploadPath(p)).filter((p): p is string => !!p);
  if (gone.length) await ctx.supabase.storage.from("post-pictures").remove(gone);
}, { revalidate: [PAGES.schedule] });

/** The default picture of a format or an event type (the Pictures tab, round 2026-11-03); an empty picture removes it. */
export const setDefaultPicture = defineAction(
  z
    .object({
      format_id: uuid.optional(),
      event_type: z.enum(["standard", "special", "day_trip", "weekend_trip"]).optional(),
      picture: z
        .string()
        .trim()
        .max(500)
        .refine((p) => !p || /^library:[\w/.-]+$/.test(p), "Upload the picture again.")
        .default(""),
    })
    .refine((i) => !!i.format_id !== !!i.event_type, "A default picture is for a format or for a type."),
  async (ctx, i) => {
    requireRole(ctx, "comms");
    const q = ctx.supabase.from("advertising_pictures").select("picture");
    const { data: before } = await (i.format_id ? q.eq("format_id", i.format_id) : q.eq("event_type", i.event_type!)).maybeSingle();
    dbError((await ctx.supabase.rpc("set_default_picture", { format: (i.format_id ?? null) as unknown as string, type: (i.event_type ?? null) as unknown as string, picture: i.picture })).error);
    const old = libraryPath(before?.picture);
    if (old && before?.picture !== i.picture) await ctx.supabase.storage.from("advertising-pictures").remove([old]);
  },
  { revalidate: [PAGES.pictures, PAGES.schedule] }
);
