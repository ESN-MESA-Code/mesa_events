// The demo outbox (/admin/demo-outbox, staging and dev:local): what the
// platform would have sent to Google Chat, Google Drive and Telegram, read
// from the fakes' tables (fake_*) and shown the way a person would see it.
// Pure helpers; the page does the reading.

export type OutboxKind = "message" | "dm" | "space" | "folder" | "telegram";

export interface OutboxEntry {
  kind: OutboxKind;
  /** When it was sent (or last edited). */
  at: string;
  /** Where it went: a space's name, a person, a folder path, a channel. */
  where: string;
  title: string;
  body: string;
  /** e.g. "edited 2×", "12 photos", "8 members" */
  meta: string[];
}

export const OUTBOX_KINDS: Array<{ key: OutboxKind | "all"; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "message", label: "Chat messages" },
  { key: "dm", label: "Direct messages" },
  { key: "space", label: "Chat spaces" },
  { key: "folder", label: "Drive folders" },
  { key: "telegram", label: "Telegram posts" },
];

export function parseOutboxKind(raw: string | string[] | undefined): OutboxKind | "all" {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return OUTBOX_KINDS.some((k) => k.key === v) ? (v as OutboxKind | "all") : "all";
}

/**
 * Chat markup as people read it: `<users/email>` mentions become "@Name"
 * (or the address when the person is unknown), `<users/all>` becomes "@all".
 */
export function readableChatText(text: string, names: ReadonlyMap<string, string> = new Map()): string {
  return text.replace(/<users\/([^>]+)>/g, (_, who: string) => {
    if (who === "all") return "@all";
    return `@${names.get(who.toLowerCase()) ?? who}`;
  });
}

/** "dm:anna.demo@esnmesa.org" → the person; null for a space. */
export function dmRecipient(space: string): string | null {
  return space.startsWith("dm:") ? space.slice(3) : null;
}

/** Newest first, then by title so the order is stable. */
export function sortOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title));
}

/** A folder's path from the photo drive's root ("WiSe_26-27 / 2026-11-05 Pub Quiz"). */
export function folderPath(id: string, folders: ReadonlyMap<string, { name: string; parent: string }>): string {
  const parts: string[] = [];
  let cur = folders.get(id);
  for (let depth = 0; cur && depth < 20; depth++) {
    parts.unshift(cur.name);
    cur = folders.get(cur.parent);
  }
  return parts.join(" / ");
}
