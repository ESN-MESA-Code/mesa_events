// Publishing (brief 2026-10-29, E): the Telegram message builder (single,
// bundle, caption split, 4,096 limit), the board's warnings and refusals,
// the picture rules and the Bot API client against a mocked fetch.
import { describe, expect, it, vi } from "vitest";
import { emptyFields, type DescriptionFields } from "@/lib/description/template";
import { CAPTION_MAX, TELEGRAM_MAX, eventMessage, lengthProblem, messagePictures, postLayouts, postMessages, telegramLayout } from "@/lib/telegram/messages";
import { postWarnings, telegramRefusal, type PostEventFacts } from "@/lib/publishing";
import { BotApiTelegramClient } from "@/lib/telegram/client";
import { MemoryTelegramClient } from "@/lib/telegram/fakes";
import { TelegramError, telegramLink } from "@/lib/telegram/types";
import { PictureError, driveFileId, resolvePicture } from "@/lib/telegram/picture";
import { MemoryDriveClient } from "@/lib/google/fakes";

const quiz: DescriptionFields = {
  ...emptyFields("Pub Quiz & Friends"),
  dateIso: "2026-11-05",
  time: "19:00",
  venue: "Shamrock",
  price: "5",
  hook: "a night of trivia",
  intro: "Teams battle it out. Prizes!",
  program: "Six rounds",
  bring: "A pen",
  closing: "see you there",
};

describe("Telegram messages", () => {
  it("one event: the bold title, then the rendered description (HTML escaped)", () => {
    const m = eventMessage(quiz);
    expect(m.html.startsWith("<b>Pub Quiz &amp; Friends</b>\n\n🗓️ Thursday, 5 November 2026")).toBe(true);
    expect(m.html).toContain("<b>Dear Internationals,</b>");
    expect(m.titleHtml).toBe("<b>Pub Quiz &amp; Friends</b>");
    expect(m.length).toBe(m.html.replace(/<[^>]+>/g, "").replace("&amp;", "&").length);
  });

  it("several events: one message per event, in order, after the heading when there is one (round 2026-11-03)", () => {
    const hike = { ...quiz, title: "Hike <3", price: "free" };
    const ms = postMessages("This week at ESN MESA", [{ fields: quiz, link: "https://pretix.eu/esnmesa/quiz/" }, { fields: hike }]);
    expect(ms.map((m) => m.titleHtml)).toEqual(["<b>📅 This week at ESN MESA</b>", "<b>Pub Quiz &amp; Friends</b>", "<b>Hike &lt;3</b>"]);
    expect(ms[0].html).toBe("<b>📅 This week at ESN MESA</b>");
    // Each event's message is its single-event post, with where to sign up when known.
    expect(ms[1].html).toBe(`${eventMessage(quiz).html}\n\n🔗 Sign up: https://pretix.eu/esnmesa/quiz/`);
    expect(ms[2].html).toBe(eventMessage(hike).html);
    // No heading: the events only; one event: no heading message at all.
    expect(postMessages("", [{ fields: quiz }, { fields: hike }])).toHaveLength(2);
    expect(postMessages("This week", [{ fields: quiz }])).toEqual([eventMessage(quiz)]);
    // Each message has the layout of its own picture.
    expect(postLayouts(ms, ["upload:a.png", null, "library:b.png"])).toEqual(["photo", "text", "photo"]);
    expect(postLayouts(ms, [null, null, null])).toEqual(["text", "text", "text"]);
  });

  it("a picture per message: the heading the post's, each event its own, else its default", () => {
    const evs = [
      { own: "upload:p/quiz.png", fallback: "library:format/quiz.png" },
      { own: null, fallback: "library:type/trip.png" },
      { own: null, fallback: null },
    ];
    expect(messagePictures("This week", "upload:p/head.png", evs)).toEqual(["upload:p/head.png", "upload:p/quiz.png", "library:type/trip.png", null]);
    // No heading: a post picture set before pictures per event stays on the first event.
    expect(messagePictures("", "upload:p/old.png", [{ own: null, fallback: "library:x.png" }, ...evs.slice(1)])).toEqual(["upload:p/old.png", "library:type/trip.png", null]);
    expect(messagePictures("Heading", null, [{ own: null, fallback: "library:x.png" }])).toEqual(["library:x.png"]);
  });

  it("the bot's layout: text only; one photo post when it fits a caption; else photo then text", () => {
    const short = eventMessage(quiz);
    expect(telegramLayout(short, false)).toBe("text");
    expect(short.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(telegramLayout(short, true)).toBe("photo");
    const long = eventMessage({ ...quiz, intro: "Long sentence here. ".repeat(60) });
    expect(telegramLayout(long, true)).toBe("photo+text");
  });

  it("refuses more than 4,096 characters, saying by how much", () => {
    expect(lengthProblem(eventMessage(quiz))).toBeNull();
    const big = { html: "", titleHtml: "", length: TELEGRAM_MAX + 10 };
    expect(lengthProblem(big)).toBe("The Telegram post is 4,106 characters long – the maximum is 4,096. Shorten it by 10 characters.");
  });
});

describe("the board's rules", () => {
  const ev = (extra: Partial<PostEventFacts> = {}): PostEventFacts => ({ id: "e1", title: "Quiz", startsAt: "2026-11-05T18:00:00Z", description: "approved", price: "5", ...extra });

  it("Telegram refuses unapproved descriptions and TBA prices (as the bot did)", () => {
    expect(telegramRefusal([ev()])).toBeNull();
    expect(telegramRefusal([ev({ description: "submitted" })])).toBe("The description of “Quiz” is not approved yet.");
    expect(telegramRefusal([ev({ price: "TBA" })])).toBe("The price of “Quiz” is still TBA.");
  });

  it("warns: not approved, after the event, TBA on Telegram, planned twice", () => {
    const post = (day: string, channel = "telegram") => ({ channel, scheduledFor: `${day}T09:00:00Z`, status: "planned" });
    expect(postWarnings(post("2026-11-01"), [ev()], new Map([["e1", 1]]))).toEqual([]);
    expect(postWarnings(post("2026-11-06"), [ev({ description: "draft", price: "tba" })], new Map([["e1", 2]]))).toEqual([
      "“Quiz”: description not approved yet",
      "“Quiz”: planned after the event",
      "“Quiz”: price still TBA",
      "“Quiz”: planned more than once on this channel",
    ]);
    expect(postWarnings(post("2026-11-01", "instagram"), [ev({ price: "TBA" })], new Map())).toEqual([]);
    expect(postWarnings({ ...post("2026-11-06"), status: "published" }, [ev()], new Map())).toEqual([]);
  });
});

describe("pictures", () => {
  it("knows Drive links and ids", () => {
    expect(driveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123/view?usp=sharing")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz123");
    expect(driveFileId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz123")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz123");
    expect(driveFileId("https://example.com/pic.jpg")).toBeNull();
  });

  it("JPG/PNG/WebP up to 10 MB from Drive, image URLs as they are; HEIC and big files refused", async () => {
    const drive = new MemoryDriveClient();
    const id = (s: string) => `1${s.padEnd(29, "x")}`;
    drive.images.set(id("a"), { mimeType: "image/jpeg", size: 2000, name: "a.jpg" });
    drive.images.set(id("b"), { mimeType: "image/heic", size: 2000, name: "b.heic" });
    drive.images.set(id("c"), { mimeType: "image/png", size: 11 * 1024 * 1024, name: "c.png" });
    expect(await resolvePicture(`https://drive.google.com/file/d/${id("a")}/view`, drive)).toMatchObject({ mimeType: "image/jpeg", name: "a.jpg" });
    expect(await resolvePicture("https://example.com/p.jpg", drive)).toEqual({ url: "https://example.com/p.jpg" });
    await expect(resolvePicture(id("b"), drive)).rejects.toThrow(/HEIC/);
    await expect(resolvePicture(id("c"), drive)).rejects.toThrow(/10 MB/);
    await expect(resolvePicture(id("z"), drive)).rejects.toBeInstanceOf(PictureError);
    await expect(resolvePicture("my photo", drive)).rejects.toThrow(/Drive link or an image URL/);
  });
});

describe("Bot API client", () => {
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });

  it("sends HTML without link previews; uploads Drive pictures as multipart", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so the calls can be inspected
    const fn = vi.fn(async (..._args: unknown[]) => ok({ message_id: 7, chat: { id: -1001234, username: "esnmesa" } }));
    const client = new BotApiTelegramClient("TOKEN", fn as unknown as typeof fetch);
    const msg = await client.sendMessage({ chat_id: "@esnmesa", text: "<b>Hi</b>", message_thread_id: 3 });
    expect(telegramLink(msg)).toBe("https://t.me/esnmesa/7");
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: "@esnmesa", text: "<b>Hi</b>", message_thread_id: 3, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    await client.sendPhoto({ chat_id: "@esnmesa", photo: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", name: "p.png" }, caption: "c" });
    const form = (fn.mock.calls[1] as [string, RequestInit])[1].body as FormData;
    expect(form.get("caption")).toBe("c");
    expect((form.get("photo") as File).name).toBe("p.png");
  });

  it("turns ok: false into a TelegramError with Telegram's words", async () => {
    const client = new BotApiTelegramClient("T", (async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: message is not modified" }))) as unknown as typeof fetch);
    await expect(client.editMessageText({ chat_id: "x", message_id: 1, text: "t" })).rejects.toMatchObject({ description: "Bad Request: message is not modified" });
    expect(telegramLink({ message_id: 9, chat: { id: -1009876 } })).toBe("https://t.me/c/9876/9");
  });

  it("the memory fake behaves like Telegram: edits, 'not modified', deleted messages", async () => {
    const tg = new MemoryTelegramClient();
    const m = await tg.sendMessage({ chat_id: "@c", text: "a" });
    await tg.editMessageText({ chat_id: "@c", message_id: m.message_id, text: "b" });
    await expect(tg.editMessageText({ chat_id: "@c", message_id: m.message_id, text: "b" })).rejects.toBeInstanceOf(TelegramError);
    await tg.deleteMessage({ chat_id: "@c", message_id: m.message_id });
    await expect(tg.editMessageText({ chat_id: "@c", message_id: m.message_id, text: "c" })).rejects.toThrow(/not found/);
    expect(tg.visible()).toEqual([]);
  });
});
