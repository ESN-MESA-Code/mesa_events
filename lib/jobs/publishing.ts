// Publishing (brief 2026-10-29, E2): a planned Telegram post publishes
// itself at its time (telegram.publish_post, run_after = the post's time,
// one job per post version); re-publishing edits the same messages (the
// bot's uploadTelegram_). Refused – no retry, the reason on the card – while
// a description is not approved or a price is TBA, or the text is too long.
// The first publication of an event on a channel is told in its Chat space.
import type { Job, JobDeps, JobHandler } from "@/lib/jobs/runner";
import { coerceFields } from "@/lib/description/template";
import { telegramRefusal, type PostEventFacts } from "@/lib/publishing";
import { bundleMessage, bundlePrice, eventMessage, lengthProblem, telegramLayout, type TelegramLayout } from "@/lib/telegram/messages";
import { PictureError, resolvePicture } from "@/lib/telegram/picture";
import { telegramSetup } from "@/lib/telegram";
import { TelegramError, telegramLink, type TelegramMessage, type TelegramPhoto } from "@/lib/telegram/types";
import { channelPublishedMessage } from "@/lib/chatMessages";
import type { Json } from "@/types/database";

interface TelegramState {
  chatId: string;
  layout: TelegramLayout;
  picture: string | null;
  photoMessageId?: number;
  textMessageId?: number;
  messageId?: number;
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

  const { data: rows, error: e2 } = await deps.admin.from("publication_post_events").select("position, events(id, title, starts_at)").eq("post_id", post.id).order("position");
  if (e2) throw new Error(e2.message);
  const events = (rows ?? []).map((r) => r.events as { id: string; title: string; starts_at: string });
  const { data: descriptions } = await deps.admin.from("descriptions").select("event_id, status, fields, approved_fields").in("event_id", events.map((e) => e.id));
  const byEvent = new Map((descriptions ?? []).map((d) => [d.event_id, d]));
  // What Comms approved is what goes out.
  const items = events.map((ev) => {
    const d = byEvent.get(ev.id);
    return { ev, status: d?.status ?? "missing", fields: coerceFields(d?.approved_fields ?? d?.fields ?? {}) };
  });
  if (!items.length) return { skipped: "no events" };
  const facts: PostEventFacts[] = items.map((i) => ({ id: i.ev.id, title: i.ev.title, startsAt: i.ev.starts_at, description: i.status, price: i.fields.price }));
  const refusal = telegramRefusal(facts);
  if (refusal) return refuse(deps, post.id, refusal);

  // A bundle links each event's pretix page when one is published.
  const { data: pretix } = await deps.admin
    .from("publication_post_events")
    .select("event_id, publication_posts!inner(channel, status, link)")
    .in("event_id", items.map((i) => i.ev.id))
    .eq("publication_posts.channel", "pretix")
    .eq("publication_posts.status", "published");
  const signUp = new Map((pretix ?? []).map((r) => [r.event_id, (r.publication_posts as { link: string | null }).link]));
  const text =
    items.length === 1
      ? eventMessage({ ...items[0].fields, title: items[0].fields.title || items[0].ev.title })
      : bundleMessage(post.note, items.map((i) => ({ title: i.fields.title || i.ev.title, startsAt: i.ev.starts_at, price: bundlePrice(i.fields), link: signUp.get(i.ev.id) ?? null })));
  const tooLong = lengthProblem(text);
  if (tooLong) return refuse(deps, post.id, tooLong);

  let photo: TelegramPhoto | null = null;
  if (post.picture) {
    try {
      photo = await resolvePicture(post.picture, deps.google.drive);
    } catch (err) {
      if (err instanceof PictureError) return refuse(deps, post.id, err.message);
      throw err;
    }
  }

  const tg = deps.telegram ?? telegramSetup(deps.admin, deps.env);
  const layout = telegramLayout(text, !!photo);
  const prev = (post.telegram ?? {}) as Partial<TelegramState>;
  const caption = layout === "photo" ? text.html : text.titleHtml;
  const state: TelegramState = { chatId: tg.chatId, layout, picture: post.picture };
  const unchangedOk = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof TelegramError && /not modified/i.test(err.description))) throw err;
    }
  };

  // Same chat and layout: edit the messages in place.
  if (prev.chatId === tg.chatId && prev.layout === layout) {
    try {
      if (layout !== "text") {
        if (post.picture !== prev.picture) await tg.client.editMessageMedia({ chat_id: tg.chatId, message_id: prev.photoMessageId!, photo: photo!, caption });
        else await unchangedOk(() => tg.client.editMessageCaption({ chat_id: tg.chatId, message_id: prev.photoMessageId!, caption }));
      }
      if (layout !== "photo") await unchangedOk(() => tg.client.editMessageText({ chat_id: tg.chatId, message_id: prev.textMessageId!, text: text.html }));
      const done = { ...prev, ...state };
      await deps.admin.rpc("post_published", { post: post.id, version: post.version, telegram: done as unknown as Json, link: post.link ?? "", by_whom: p.by ?? "schedule" });
      return { edited: true };
    } catch (err) {
      // Deleted in Telegram meanwhile: post anew below.
      if (!(err instanceof TelegramError && /not found|can't be edited|message to edit/i.test(err.description))) throw err;
    }
  }

  // A new post (the layout changed: the old messages go).
  if (prev.chatId === tg.chatId) {
    for (const id of [prev.photoMessageId, prev.textMessageId].filter((x): x is number => !!x)) {
      await tg.client.deleteMessage({ chat_id: tg.chatId, message_id: id }).catch(() => undefined);
    }
  }
  let first: TelegramMessage | null = null;
  if (layout !== "text") {
    first = await tg.client.sendPhoto({ chat_id: tg.chatId, photo: photo!, caption, message_thread_id: tg.topicId });
    state.photoMessageId = first.message_id;
  }
  if (layout !== "photo") {
    const msg = await tg.client.sendMessage({ chat_id: tg.chatId, text: text.html, message_thread_id: tg.topicId });
    state.textMessageId = msg.message_id;
    first = first ?? msg;
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
  return { posted: layout, messageId: state.messageId };
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
