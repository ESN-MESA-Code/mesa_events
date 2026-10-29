// Telegram Bot API client (fetch-based), used only when TELEGRAM_BOT_TOKEN
// is set (lib/telegram/index.ts). HTML parse mode, link previews off, as the
// bot posted. Pictures go as a URL or as multipart upload.
import { TelegramError, type TelegramClient, type TelegramMessage, type TelegramPhoto } from "@/lib/telegram/types";

type Fetch = typeof fetch;

export class BotApiTelegramClient implements TelegramClient {
  constructor(
    private token: string,
    private fetchFn: Fetch = fetch
  ) {}

  private async call<T>(method: string, payload: Record<string, unknown>, photo?: TelegramPhoto): Promise<T> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    let res: Response;
    if (photo && "bytes" in photo) {
      const form = new FormData();
      for (const [k, v] of Object.entries(payload)) if (v !== undefined) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
      form.append("photo", new Blob([photo.bytes as BlobPart], { type: photo.mimeType }), photo.name);
      res = await this.fetchFn(url, { method: "POST", body: form });
    } else {
      res = await this.fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    let body: { ok?: boolean; result?: unknown; description?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // not JSON: below
    }
    if (!body.ok) throw new TelegramError(body.description ?? `HTTP ${res.status}`);
    return body.result as T;
  }

  private media(photo: TelegramPhoto) {
    return "url" in photo ? photo.url : "attach://photo";
  }

  async sendMessage(p: { chat_id: string; text: string; message_thread_id?: number }) {
    return this.call<TelegramMessage>("sendMessage", { ...p, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  }

  async editMessageText(p: { chat_id: string; message_id: number; text: string }) {
    await this.call("editMessageText", { ...p, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  }

  async sendPhoto(p: { chat_id: string; photo: TelegramPhoto; caption: string; message_thread_id?: number }) {
    const { photo, ...rest } = p;
    return this.call<TelegramMessage>("sendPhoto", { ...rest, parse_mode: "HTML", photo: "url" in photo ? photo.url : undefined }, photo);
  }

  async editMessageCaption(p: { chat_id: string; message_id: number; caption: string }) {
    await this.call("editMessageCaption", { ...p, parse_mode: "HTML" });
  }

  async editMessageMedia(p: { chat_id: string; message_id: number; photo: TelegramPhoto; caption: string }) {
    await this.call("editMessageMedia", { chat_id: p.chat_id, message_id: p.message_id, media: { type: "photo", media: this.media(p.photo), caption: p.caption, parse_mode: "HTML" } }, p.photo);
  }

  async deleteMessage(p: { chat_id: string; message_id: number }) {
    await this.call("deleteMessage", p);
  }
}
