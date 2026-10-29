// Picks the Telegram client: the Bot API with TELEGRAM_BOT_TOKEN (and not on
// staging, not TELEGRAM_MODE=fake), the database fake otherwise – locally
// and in tests nothing is ever sent to Telegram. Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { BotApiTelegramClient } from "@/lib/telegram/client";
import { DbTelegramClient } from "@/lib/telegram/fakes";
import type { TelegramClient } from "@/lib/telegram/types";

export interface TelegramSetup {
  mode: "real" | "fake";
  client: TelegramClient;
  /** @channelname or -100… */
  chatId: string;
  /** Forum topic, optional. */
  topicId?: number;
}

export function telegramMode(env: Record<string, string | undefined> = process.env): "real" | "fake" {
  if (env.APP_ENV === "staging" || env.TELEGRAM_MODE === "fake" || !env.TELEGRAM_BOT_TOKEN) return "fake";
  return "real";
}

export function telegramSetup(admin: SupabaseClient<Database>, env: Record<string, string | undefined> = process.env): TelegramSetup {
  const topicId = Number(env.TELEGRAM_TOPIC_ID) || undefined;
  if (telegramMode(env) === "fake") return { mode: "fake", client: new DbTelegramClient(admin), chatId: env.TELEGRAM_CHAT_ID || "@mesa_fake_channel", topicId };
  if (!env.TELEGRAM_CHAT_ID) throw new Error("TELEGRAM_BOT_TOKEN needs TELEGRAM_CHAT_ID");
  return { mode: "real", client: new BotApiTelegramClient(env.TELEGRAM_BOT_TOKEN!), chatId: env.TELEGRAM_CHAT_ID, topicId };
}
