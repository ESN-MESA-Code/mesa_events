// What goes to Telegram (brief 2026-10-29, E2), ported from the bot's
// uploadTelegram_: the bold event title and the rendered description (the
// same house template and 4,096-character limit). A post of several events
// is one message per event (round 2026-11-03), after its heading when it has
// one. Each message may carry a picture (messagePictures): one photo post when
// it fits a 1,024-character caption, else the photo (caption: the title)
// followed by the text. Pure (tests/unit/telegram.test.ts).
import { escapeHtml, oneLine, renderDescription, type DescriptionFields } from "@/lib/description/template";
import { formatCount } from "@/lib/description/template";

export const TELEGRAM_MAX = 4096;
export const CAPTION_MAX = 1024;

export interface TelegramText {
  /** Telegram HTML. */
  html: string;
  /** The caption when the text does not fit one (the title / heading). */
  titleHtml: string;
  /** What Telegram counts: the text without the HTML. */
  length: number;
}

/** Telegram HTML as the reader sees it (the preview before confirming). */
export const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const plainLength = (html: string) => plainText(html).length;

/** One event: the description as the template renders it (which opens with the bold title) – and where to sign up (its pretix page), when known. */
export function eventMessage(d: DescriptionFields, link?: string | null): TelegramText {
  const title = oneLine(d.title);
  const titleHtml = title ? `<b>${escapeHtml(title)}</b>` : "";
  const html = [renderDescription(d).telegram, link && `🔗 Sign up: ${escapeHtml(link)}`].filter(Boolean).join("\n\n");
  return { html, titleHtml, length: plainLength(html) };
}

export interface PostItem {
  fields: DescriptionFields;
  /** Where to sign up (the pretix page), when there is one. */
  link?: string | null;
}

/**
 * The messages of a post, in order (round 2026-11-03): one per event, each
 * as a post of that event alone; a post of several events opens with its
 * heading ("This week at ESN MESA") when it has one.
 */
export function postMessages(heading: string, items: PostItem[]): TelegramText[] {
  const opening = hasHeading(heading, items.length) ? [`<b>📅 ${escapeHtml(oneLine(heading))}</b>`].map((html) => ({ html, titleHtml: html, length: plainLength(html) })) : [];
  return [...opening, ...items.map((i) => eventMessage(i.fields, i.link))];
}

/** A post of several events with a heading opens with a heading message. */
export const hasHeading = (heading: string, events: number) => events > 1 && !!oneLine(heading);

export interface EventPicture {
  /** The event's own picture in this post. */
  own: string | null;
  /** The default of its format, else of its type (the Pictures tab). */
  fallback: string | null;
}

/**
 * The picture of each message, in the order of postMessages (round
 * 2026-11-03): the heading message has the post's picture; each event's
 * message its own picture, else its default. The post's picture of a post
 * without a heading (set before pictures per event) stays on its first
 * event's message.
 */
export function messagePictures(heading: string, postPicture: string | null, events: EventPicture[]): Array<string | null> {
  const head = hasHeading(heading, events.length);
  return [...(head ? [postPicture] : []), ...events.map((e, i) => e.own ?? (!head && i === 0 ? postPicture : null) ?? e.fallback)];
}

export type TelegramLayout = "text" | "photo" | "photo+text";

/** The bot's rule: a picture and a short text make one photo post; a long text follows the photo. */
export function telegramLayout(text: TelegramText, hasPicture: boolean): TelegramLayout {
  if (!hasPicture) return "text";
  return text.length <= CAPTION_MAX ? "photo" : "photo+text";
}

/** The layout of each message of a post, by whether it has a picture. */
export const postLayouts = (messages: TelegramText[], pictures: Array<string | null>): TelegramLayout[] => messages.map((m, i) => telegramLayout(m, !!pictures[i]));

/** Too long for one Telegram message, in words. */
export function lengthProblem(text: TelegramText): string | null {
  return text.length > TELEGRAM_MAX
    ? `The Telegram post is ${formatCount(text.length)} characters long – the maximum is ${formatCount(TELEGRAM_MAX)}. Shorten it by ${formatCount(text.length - TELEGRAM_MAX)} characters.`
    : null;
}
