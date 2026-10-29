// Fakes of the Telegram client: in memory (unit tests) and in the
// fake_telegram_messages table (dev, DB and E2E tests – the result of the
// jobs can be inspected). No real Telegram call is ever made by them.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { TelegramError, type TelegramClient, type TelegramMessage, type TelegramPhoto } from "@/lib/telegram/types";

const photoRef = (p: TelegramPhoto) => ("url" in p ? p.url : `upload:${p.name} (${p.mimeType}, ${p.bytes.byteLength} bytes)`);
const chatOf = (chat_id: string) => (/^-?\d+$/.test(chat_id) ? Number(chat_id) : chat_id);

interface Stored {
  kind: "text" | "photo";
  text: string;
  photo: string | null;
  edits: number;
  deleted: boolean;
  thread: number | null;
}

export class MemoryTelegramClient implements TelegramClient {
  messages = new Map<string, Stored>();
  private next = 100;
  failNext = 0;

  private key = (chat: string, id: number) => `${chat}:${id}`;
  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new TelegramError("Fake Telegram failure");
    }
  }
  private get(chat: string, id: number) {
    const m = this.messages.get(this.key(chat, id));
    if (!m || m.deleted) throw new TelegramError("Bad Request: message to edit not found");
    return m;
  }
  private add(chat: string, m: Omit<Stored, "edits" | "deleted">): TelegramMessage {
    this.maybeFail();
    const id = this.next++;
    this.messages.set(this.key(chat, id), { ...m, edits: 0, deleted: false });
    return { message_id: id, chat: { id: chatOf(chat), username: chat.startsWith("@") ? chat.slice(1) : undefined } };
  }

  async sendMessage(p: { chat_id: string; text: string; message_thread_id?: number }) {
    return this.add(p.chat_id, { kind: "text", text: p.text, photo: null, thread: p.message_thread_id ?? null });
  }
  async editMessageText(p: { chat_id: string; message_id: number; text: string }) {
    this.maybeFail();
    const m = this.get(p.chat_id, p.message_id);
    if (m.text === p.text) throw new TelegramError("Bad Request: message is not modified");
    m.text = p.text;
    m.edits++;
  }
  async sendPhoto(p: { chat_id: string; photo: TelegramPhoto; caption: string; message_thread_id?: number }) {
    return this.add(p.chat_id, { kind: "photo", text: p.caption, photo: photoRef(p.photo), thread: p.message_thread_id ?? null });
  }
  async editMessageCaption(p: { chat_id: string; message_id: number; caption: string }) {
    this.maybeFail();
    const m = this.get(p.chat_id, p.message_id);
    if (m.text === p.caption) throw new TelegramError("Bad Request: message is not modified");
    m.text = p.caption;
    m.edits++;
  }
  async editMessageMedia(p: { chat_id: string; message_id: number; photo: TelegramPhoto; caption: string }) {
    this.maybeFail();
    const m = this.get(p.chat_id, p.message_id);
    m.photo = photoRef(p.photo);
    m.text = p.caption;
    m.edits++;
  }
  async deleteMessage(p: { chat_id: string; message_id: number }) {
    this.get(p.chat_id, p.message_id).deleted = true;
  }

  /** The messages still there, oldest first (tests). */
  visible() {
    return [...this.messages.entries()].filter(([, m]) => !m.deleted).map(([k, m]) => ({ id: Number(k.split(":").at(-1)), ...m }));
  }
}

type Admin = SupabaseClient<Database>;

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Fake Telegram store: ${res.error.message}`);
  return res.data;
}

export class DbTelegramClient implements TelegramClient {
  constructor(private db: Admin) {}

  private async add(chat_id: string, kind: "text" | "photo", text: string, photo: string | null, thread?: number): Promise<TelegramMessage> {
    const last = check(await this.db.from("fake_telegram_messages").select("message_id").eq("chat_id", chat_id).order("message_id", { ascending: false }).limit(1).maybeSingle());
    const message_id = (last?.message_id ?? 0) + 1;
    check(await this.db.from("fake_telegram_messages").insert({ chat_id, message_id, kind, text, photo, thread_id: thread ?? null }));
    return { message_id, chat: { id: chatOf(chat_id), username: chat_id.startsWith("@") ? chat_id.slice(1) : undefined } };
  }

  private async edit(chat_id: string, message_id: number, patch: { text: string; photo?: string }) {
    const m = check(await this.db.from("fake_telegram_messages").select("text, photo, edits, deleted").eq("chat_id", chat_id).eq("message_id", message_id).maybeSingle());
    if (!m || m.deleted) throw new TelegramError("Bad Request: message to edit not found");
    if (m.text === patch.text && (patch.photo === undefined || patch.photo === m.photo)) throw new TelegramError("Bad Request: message is not modified");
    check(
      await this.db
        .from("fake_telegram_messages")
        .update({ ...patch, edits: m.edits + 1, updated_at: new Date().toISOString() })
        .eq("chat_id", chat_id)
        .eq("message_id", message_id)
    );
  }

  async sendMessage(p: { chat_id: string; text: string; message_thread_id?: number }) {
    return this.add(p.chat_id, "text", p.text, null, p.message_thread_id);
  }
  async editMessageText(p: { chat_id: string; message_id: number; text: string }) {
    await this.edit(p.chat_id, p.message_id, { text: p.text });
  }
  async sendPhoto(p: { chat_id: string; photo: TelegramPhoto; caption: string; message_thread_id?: number }) {
    return this.add(p.chat_id, "photo", p.caption, photoRef(p.photo), p.message_thread_id);
  }
  async editMessageCaption(p: { chat_id: string; message_id: number; caption: string }) {
    await this.edit(p.chat_id, p.message_id, { text: p.caption });
  }
  async editMessageMedia(p: { chat_id: string; message_id: number; photo: TelegramPhoto; caption: string }) {
    await this.edit(p.chat_id, p.message_id, { text: p.caption, photo: photoRef(p.photo) });
  }
  async deleteMessage(p: { chat_id: string; message_id: number }) {
    check(await this.db.from("fake_telegram_messages").update({ deleted: true }).eq("chat_id", p.chat_id).eq("message_id", p.message_id));
  }
}
