// The Telegram Bot API calls the platform uses (ported from the bot's
// src/Integrations.gs), as an interface: the real fetch-based client
// (client.ts) and fakes (fakes.ts) implement it; index.ts picks one.

export interface TelegramMessage {
  message_id: number;
  chat: { id: number | string; username?: string };
}

/** A picture: a URL Telegram fetches itself, or the file's bytes (a Drive file). */
export type TelegramPhoto = { url: string } | { bytes: Uint8Array; mimeType: string; name: string };

export interface TelegramClient {
  sendMessage(p: { chat_id: string; text: string; message_thread_id?: number }): Promise<TelegramMessage>;
  editMessageText(p: { chat_id: string; message_id: number; text: string }): Promise<void>;
  sendPhoto(p: { chat_id: string; photo: TelegramPhoto; caption: string; message_thread_id?: number }): Promise<TelegramMessage>;
  editMessageCaption(p: { chat_id: string; message_id: number; caption: string }): Promise<void>;
  editMessageMedia(p: { chat_id: string; message_id: number; photo: TelegramPhoto; caption: string }): Promise<void>;
  deleteMessage(p: { chat_id: string; message_id: number }): Promise<void>;
}

/** An answer of the Bot API with ok: false. `description` as Telegram words it ("message is not modified"). */
export class TelegramError extends Error {
  constructor(public description: string) {
    super(`Telegram: ${description}`);
  }
}

/** t.me link of a message: public channels by username, private ones by id (-100…). */
export function telegramLink(msg: TelegramMessage): string {
  if (msg.chat.username) return `https://t.me/${msg.chat.username}/${msg.message_id}`;
  const id = String(msg.chat.id);
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${msg.message_id}` : "";
}
