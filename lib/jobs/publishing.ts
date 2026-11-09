// Publishing (brief 2026-10-29, E2): a planned Telegram post publishes
// itself at its time (telegram.publish_post, run_after = the post's time,
// one job per post version); re-publishing edits the same messages (the
// bot's uploadTelegram_). Refused – no retry, the reason on the card – while
// a description is not approved or a price is TBA, or a text is too long.
// A post of several events goes out as one message per event (round
// 2026-11-03), each with its picture: its own, else its format's or type's
// default (the Pictures tab).
// The first publication of an event on a channel is told in its Chat space.
import type { Job, JobDeps, JobHandler } from "@/lib/jobs/runner";
import { coerceFields } from "@/lib/description/template";
import { telegramRefusal, type PostEventFacts } from "@/lib/publishing";
import { lengthProblem, messagePictures, postLayouts, postMessages, type TelegramLayout } from "@/lib/telegram/messages";
import { PictureError, resolvePicture, uploadPath, type UploadReader } from "@/lib/telegram/picture";
import { loadDefaultPictures } from "@/lib/publishingLoad";
import { telegramSetup } from "@/lib/telegram";
import { TelegramError, telegramLink, type TelegramMessage, type TelegramPhoto } from "@/lib/telegram/types";
import { channelPublishedMessage } from "@/lib/chatMessages";
import type { Json } from "@/types/database";

/** One sent message of a post: a photo, a text, or a photo followed by a text. */
interface SentMessage {
  layout: TelegramLayout;
  /** The picture it was sent with. */
  picture?: string | null;
  photoMessageId?: number;
  textMessageId?: number;
}

interface TelegramState {
  chatId: string;
  picture: string | null;
  messages: SentMessage[];
  /** The first message (the post's link). */
  messageId?: number;
}

/** The sent messages of a post, also as written before one message per event (a single layout at the top). */
function sentMessages(prev: Partial<TelegramState> & Partial<SentMessage>): SentMessage[] {
  if (prev.messages) return prev.messages;
  return prev.layout ? [{ layout: prev.layout, picture: prev.picture ?? null, photoMessageId: prev.photoMessageId, textMessageId: prev.textMessageId }] : [];
}

async function refuse(deps: JobDeps, postId: string, reason: string) {
  const { error } = await deps.admin.from("publication_posts").update({ last_error: reason.slice(0, 500) }).eq("id", postId);
  if (error) throw new Error(error.message);
  return { refused: reason };
}

export const publishTelegramPost: JobHandler = async (job: Job, deps: JobDeps) => {
  const p = job.payload as { post_id: string; version: number; by?: string };
  const { data: post, error } = await deps.admin.from("publication_posts").select("*").eq("id", p.post_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!post) return { skipped: "post gone" };
  if (post.version !== p.version) return { skipped: "a newer version is planned" };
  if (post.channel !== "telegram" || post.status === "skipped") return { skipped: `not a Telegram post to publish (${post.status})` };
  // Nothing goes to Telegram that Comms did not confirm (round 2026-10-30).
  if (!post.confirmed_at) return { skipped: "not confirmed" };

  const { data: rows, error: e2 } = await deps.admin.from("publication_post_events").select("position, picture, events(id, title, starts_at, status, format_id, category_id, type)").eq("post_id", post.id).order("position");
  if (e2) throw new Error(e2.message);
  const events = (rows ?? []).map((r) => r.events as { id: string; title: string; starts_at: string; status: string; format_id: string | null; category_id: string | null; type: string });
  const ownPicture = new Map((rows ?? []).map((r) => [(r.events as { id: string }).id, r.picture]));
  const { data: descriptions } = await deps.admin.from("descriptions").select("event_id, status, fields, approved_fields").in("event_id", events.map((e) => e.id));
  const byEvent = new Map((descriptions ?? []).map((d) => [d.event_id, d]));
  // What Comms approved is what goes out.
  const items = events.map((ev) => {
    const d = byEvent.get(ev.id);
    return { ev, status: d?.status ?? "missing", fields: coerceFields(d?.approved_fields ?? d?.fields ?? {}) };
  });
  if (!items.length) return { skipped: "no events" };
  const facts: PostEventFacts[] = items.map((i) => ({ id: i.ev.id, title: i.ev.title, startsAt: i.ev.starts_at, description: i.status, price: i.fields.price, eventStatus: i.ev.status }));
  const refusal = telegramRefusal(facts);
  if (refusal) return refuse(deps, post.id, refusal);

  // Each event links its pretix page when one is ticked with a link.
  const { data: pretix } = await deps.admin
    .from("publication_post_events")
    .select("event_id, publication_posts!inner(channel, status, link)")
    .in("event_id", items.map((i) => i.ev.id))
    .eq("publication_posts.channel", "pretix")
    .eq("publication_posts.status", "published");
  const signUp = new Map((pretix ?? []).map((r) => [r.event_id, (r.publication_posts as { link: string | null }).link]));
  const texts = postMessages(post.note, items.map((i) => ({ fields: { ...i.fields, title: i.fields.title || i.ev.title }, link: signUp.get(i.ev.id) ?? null })));
  for (const [n, text] of texts.entries()) {
    const tooLong = lengthProblem(text);
    // Name the event when the post has several messages.
    const item = items[n - (texts.length - items.length)];
    if (tooLong) return refuse(deps, post.id, texts.length > 1 && item ? `“${item.ev.title}”: ${tooLong}` : tooLong);
  }

  const tg = deps.telegram ?? telegramSetup(deps.admin, deps.env);
  const defaults = await loadDefaultPictures(deps.admin, events);
  const pictures = messagePictures(post.note, post.picture, events.map((e) => ({ own: ownPicture.get(e.id) ?? null, fallback: defaults.get(e.id) ?? null })));
  const layouts = postLayouts(texts, pictures);
  const prev = (post.telegram ?? {}) as Partial<TelegramState> & Partial<SentMessage>;
  const before = sentMessages(prev);
  const editsInPlace = prev.chatId === tg.chatId && before.length === layouts.length && before.every((m, i) => m.layout === layouts[i]);
  // A picture is read only when it is sent (new, or changed on an edit): an uploaded one is removed once the post is out.
  const readUpload: UploadReader = async (path, bucket) => {
    const { data, error: e } = await deps.admin.storage.from(bucket).download(path);
    if (e || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type };
  };
  const photos: Array<TelegramPhoto | null> = [];
  for (const [i, picture] of pictures.entries()) {
    const needed = !!picture && (!editsInPlace || picture !== (before[i]?.picture ?? null));
    try {
      photos.push(needed ? await resolvePicture(picture!, deps.google.drive, readUpload) : null);
    } catch (err) {
      if (err instanceof PictureError) return refuse(deps, post.id, err.message);
      throw err;
    }
  }
  const dropUpload = async () => {
    const paths = [post.picture, ...ownPicture.values()].map((p) => uploadPath(p)).filter((p): p is string => !!p);
    if (paths.length) await deps.admin.storage.from("post-pictures").remove(paths);
  };

  const captionOf = (i: number) => (layouts[i] === "photo" ? texts[i].html : texts[i].titleHtml);
  const unchangedOk = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof TelegramError && /not modified/i.test(err.description))) throw err;
    }
  };

  // Same chat and the same messages: edit them in place.
  if (editsInPlace) {
    try {
      for (const [i, m] of before.entries()) {
        if (m.layout !== "text") {
          if (photos[i]) await tg.client.editMessageMedia({ chat_id: tg.chatId, message_id: m.photoMessageId!, photo: photos[i]!, caption: captionOf(i) });
          else await unchangedOk(() => tg.client.editMessageCaption({ chat_id: tg.chatId, message_id: m.photoMessageId!, caption: captionOf(i) }));
        }
        if (m.layout !== "photo") await unchangedOk(() => tg.client.editMessageText({ chat_id: tg.chatId, message_id: m.textMessageId!, text: texts[i].html }));
      }
      const done: TelegramState = { chatId: tg.chatId, picture: post.picture, messages: before.map((m, i) => ({ ...m, picture: pictures[i] })), messageId: prev.messageId };
      await deps.admin.rpc("post_published", { post: post.id, version: post.version, telegram: done as unknown as Json, link: post.link ?? "", by_whom: p.by ?? "schedule" });
      await dropUpload();
      return { edited: true };
    } catch (err) {
      // Deleted in Telegram meanwhile: post anew below.
      if (!(err instanceof TelegramError && /not found|can't be edited|message to edit/i.test(err.description))) throw err;
    }
  }

  // A new post (the messages changed: the old ones go).
  if (prev.chatId === tg.chatId) {
    for (const id of before.flatMap((m) => [m.photoMessageId, m.textMessageId]).filter((x): x is number => !!x)) {
      await tg.client.deleteMessage({ chat_id: tg.chatId, message_id: id }).catch(() => undefined);
    }
  }
  const state: TelegramState = { chatId: tg.chatId, picture: post.picture, messages: [] };
  let first: TelegramMessage | null = null;
  for (const [i, text] of texts.entries()) {
    const sent: SentMessage = { layout: layouts[i], picture: pictures[i] };
    if (layouts[i] !== "text") {
      const msg = await tg.client.sendPhoto({ chat_id: tg.chatId, photo: photos[i]!, caption: captionOf(i), message_thread_id: tg.topicId });
      sent.photoMessageId = msg.message_id;
      first = first ?? msg;
    }
    if (layouts[i] !== "photo") {
      const msg = await tg.client.sendMessage({ chat_id: tg.chatId, text: text.html, message_thread_id: tg.topicId });
      sent.textMessageId = msg.message_id;
      first = first ?? msg;
    }
    state.messages.push(sent);
  }
  state.messageId = first!.message_id;
  const { error: e3 } = await deps.admin.rpc("post_published", {
    post: post.id,
    version: post.version,
    telegram: state as unknown as Json,
    link: telegramLink(first!),
    by_whom: p.by ?? "schedule",
  });
  if (e3) throw new Error(e3.message);
  await dropUpload();
  return { posted: layouts, messageId: state.messageId };
};

/** "📢 Comms has published *Event* on Telegram" – once per event and channel. */
export const channelPublished: JobHandler = async (job, deps) => {
  const p = job.payload as { event_id: string; channel: string };
  const [{ data: event, error }, { data: channel }, { data: status }] = await Promise.all([
    deps.admin.from("events").select("id, title, chat_space_name").eq("id", p.event_id).maybeSingle(),
    deps.admin.from("publication_channels").select("name").eq("key", p.channel).maybeSingle(),
    deps.admin
      .from("publication_post_events")
      .select("publication_posts!inner(channel, status, link)")
      .eq("event_id", p.event_id)
      .eq("publication_posts.channel", p.channel)
      .eq("publication_posts.status", "published")
      .limit(1),
  ]);
  if (error) throw new Error(error.message);
  if (!event) return { skipped: "event gone" };
  if (!event.chat_space_name) return { skipped: "no Chat space" };
  const link = (status?.[0]?.publication_posts as { link: string | null } | undefined)?.link ?? null;
  await deps.google.chat.postMessage(event.chat_space_name, channelPublishedMessage(event.title, channel?.name ?? p.channel, link), `published-${p.channel}-${event.id}`);
  return { posted: true };
};
