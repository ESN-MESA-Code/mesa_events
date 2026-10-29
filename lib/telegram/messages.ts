// What goes to Telegram (brief 2026-10-29, E2), ported from the bot's
// uploadTelegram_: the bold event title and the rendered description (the
// same house template and 4,096-character limit), or – for a bundle – a
// short block per event (title, date, price, link). With a picture: one
// photo post when everything fits a 1,024-character caption, else the photo
// (caption: the title) followed by the text. Pure (tests/unit/telegram.test.ts).
import { escapeHtml, formatPrice, oneLine, renderDescription, type DescriptionFields } from "@/lib/description/template";
import { formatDateTime } from "@/lib/dates";
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

const plainLength = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").length;

/** One event: <b>Title</b>, a blank line, the description as the template renders it. */
export function eventMessage(d: DescriptionFields): TelegramText {
  const title = oneLine(d.title);
  const titleHtml = title ? `<b>${escapeHtml(title)}</b>` : "";
  const html = [titleHtml, renderDescription(d).telegram].filter(Boolean).join("\n\n");
  return { html, titleHtml, length: plainLength(html) };
}

export interface BundleItem {
  title: string;
  startsAt: string;
  /** The template's price, e.g. "€ 5.00", "FREE". */
  price: string;
  /** Where to sign up (e.g. the pretix page), when there is one. */
  link?: string | null;
}

/** Several events in one post ("This week at ESN MESA"): a short block each, in the post's order. */
export function bundleMessage(heading: string, items: BundleItem[]): TelegramText {
  const titleHtml = `<b>📅 ${escapeHtml(oneLine(heading) || "Coming up at ESN MESA")}</b>`;
  const blocks = items.map((i) =>
    [`<b>${escapeHtml(oneLine(i.title))}</b>`, `🗓️ ${escapeHtml(formatDateTime(i.startsAt))}`, i.price && `💸 ${escapeHtml(i.price)}`, i.link && `🔗 ${escapeHtml(i.link)}`].filter(Boolean).join("\n")
  );
  const html = [titleHtml, ...blocks].join("\n\n");
  return { html, titleHtml, length: plainLength(html) };
}

/** The template's price for a bundle line. */
export const bundlePrice = (d: Pick<DescriptionFields, "price" | "priceNote">) => formatPrice(d.price, d.priceNote).value ?? "";

export type TelegramLayout = "text" | "photo" | "photo+text";

/** The bot's rule: a picture and a short text make one photo post; a long text follows the photo. */
export function telegramLayout(text: TelegramText, hasPicture: boolean): TelegramLayout {
  if (!hasPicture) return "text";
  return text.length <= CAPTION_MAX ? "photo" : "photo+text";
}

/** Too long for one Telegram message, in words. */
export function lengthProblem(text: TelegramText): string | null {
  return text.length > TELEGRAM_MAX
    ? `The Telegram post is ${formatCount(text.length)} characters long – the maximum is ${formatCount(TELEGRAM_MAX)}. Shorten it by ${formatCount(text.length - TELEGRAM_MAX)} characters.`
    : null;
}
