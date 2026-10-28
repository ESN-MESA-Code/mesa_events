// Fakes of the Google clients, for development and tests. Two flavours:
// * Memory* – in-process state, for unit tests,
// * Db*     – the fake_* tables (migration 20261028000050_dev_fakes.sql),
//             used by the app without a service account, so the result of
//             the jobs can be inspected (tests, /admin).
// Both behave like the real clients: idempotent creates and posts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatClient, ChatSpace, DirectoryClient, DriveClient } from "@/lib/google/types";
import { chatMessageId } from "@/lib/google/chat";
import type { Database } from "@/types/database";

type Admin = SupabaseClient<Database>;

const spaceUrl = (name: string) => `https://chat.google.com/room/${name.split("/")[1]}`;
const newSpaceName = () => `spaces/FAKE${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

// ── Memory ──────────────────────────────────────────────────────────────────

export class MemoryChatClient implements ChatClient {
  spaces = new Map<string, { displayName: string; description: string; guidelines: string; requestId: string; members: Set<string> }>();
  messages = new Map<string, { space: string; text: string; edits: number }>();
  /** Fails the next n calls (retry tests). */
  failNext = 0;

  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("Fake Chat API failure");
    }
  }

  async createSpace({ displayName, requestId }: { displayName: string; requestId: string }): Promise<ChatSpace> {
    this.maybeFail();
    for (const [name, s] of this.spaces) if (s.requestId === requestId) return { name, url: spaceUrl(name) };
    const name = newSpaceName();
    this.spaces.set(name, { displayName, description: "", guidelines: "", requestId, members: new Set() });
    return { name, url: spaceUrl(name) };
  }

  private space(name: string) {
    const s = this.spaces.get(name);
    if (!s) throw new Error(`Fake Chat: no space ${name}`);
    return s;
  }

  async updateSpaceDetails(space: string, details: { description: string; guidelines: string }) {
    this.maybeFail();
    Object.assign(this.space(space), details);
  }

  async addMember(space: string, email: string) {
    this.maybeFail();
    this.space(space).members.add(email);
  }

  async removeMember(space: string, email: string) {
    this.maybeFail();
    this.space(space).members.delete(email);
  }

  async postMessage(space: string, text: string, messageId: string) {
    this.maybeFail();
    const name = `${space}/messages/${chatMessageId(messageId)}`;
    if (!this.messages.has(name)) this.messages.set(name, { space, text, edits: 0 });
    return { name };
  }

  async updateMessage(messageName: string, text: string) {
    this.maybeFail();
    const m = this.messages.get(messageName);
    if (!m) throw new Error(`Fake Chat: no message ${messageName}`);
    m.text = text;
    m.edits++;
  }

  async notify(email: string, text: string, messageId: string) {
    await this.postMessage(`dm:${email}`, text, messageId);
  }
}

export class MemoryDriveClient implements DriveClient {
  files = new Map<string, { id: string; mimeType: string; size: number }>();

  async uploadFile({ folder, fileName, mimeType, data }: { folder: string; fileName: string; mimeType: string; data: Uint8Array }) {
    const key = `${folder}/${fileName}`;
    let file = this.files.get(key);
    if (!file) {
      file = { id: `fake-${crypto.randomUUID()}`, mimeType, size: data.byteLength };
      this.files.set(key, file);
    }
    return { id: file.id, url: `https://drive.google.com/file/d/${file.id}/view` };
  }
}

export class MemoryDirectoryClient implements DirectoryClient {
  constructor(public groups: Record<string, string[]> = {}) {}

  async groupMemberEmails(group: string) {
    return (this.groups[group] ?? []).map((e) => e.toLowerCase());
  }

  async isGroupMember(group: string, email: string) {
    return (await this.groupMemberEmails(group)).includes(email.toLowerCase());
  }
}

// ── Database ────────────────────────────────────────────────────────────────

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Fake Google store: ${res.error.message}`);
  return res.data;
}

export class DbChatClient implements ChatClient {
  constructor(private db: Admin) {}

  async createSpace({ displayName, requestId }: { displayName: string; requestId: string }): Promise<ChatSpace> {
    const existing = check(await this.db.from("fake_chat_spaces").select("name").eq("request_id", requestId).maybeSingle());
    if (existing) return { name: existing.name, url: spaceUrl(existing.name) };
    const name = newSpaceName();
    check(await this.db.from("fake_chat_spaces").insert({ name, display_name: displayName, request_id: requestId }));
    return { name, url: spaceUrl(name) };
  }

  async updateSpaceDetails(space: string, details: { description: string; guidelines: string }) {
    check(await this.db.from("fake_chat_spaces").update(details).eq("name", space));
  }

  async addMember(space: string, email: string) {
    check(await this.db.from("fake_chat_members").upsert({ space, email }, { onConflict: "space,email", ignoreDuplicates: true }));
  }

  async removeMember(space: string, email: string) {
    check(await this.db.from("fake_chat_members").delete().eq("space", space).eq("email", email));
  }

  async postMessage(space: string, text: string, messageId: string) {
    const name = `${space}/messages/${chatMessageId(messageId)}`;
    check(await this.db.from("fake_chat_messages").upsert({ name, space, text }, { onConflict: "name", ignoreDuplicates: true }));
    return { name };
  }

  async updateMessage(messageName: string, text: string) {
    const msg = check(await this.db.from("fake_chat_messages").select("edits").eq("name", messageName).maybeSingle());
    if (!msg) throw new Error(`Fake Chat: no message ${messageName}`);
    check(
      await this.db
        .from("fake_chat_messages")
        .update({ text, edits: msg.edits + 1, updated_at: new Date().toISOString() })
        .eq("name", messageName)
    );
  }

  async notify(email: string, text: string, messageId: string) {
    await this.postMessage(`dm:${email}`, text, messageId);
  }
}

export class DbDriveClient implements DriveClient {
  constructor(private db: Admin) {}

  async uploadFile({ folder, fileName, mimeType, data }: { folder: string; fileName: string; mimeType: string; data: Uint8Array }) {
    const existing = check(
      await this.db.from("fake_drive_files").select("id").eq("folder", folder).eq("file_name", fileName).maybeSingle()
    );
    const id = existing?.id ?? `fake-${crypto.randomUUID()}`;
    if (!existing) {
      check(await this.db.from("fake_drive_files").insert({ id, folder, file_name: fileName, mime_type: mimeType, size: data.byteLength }));
    }
    return { id, url: `https://drive.google.com/file/d/${id}/view` };
  }
}

export class DbDirectoryClient implements DirectoryClient {
  constructor(private db: Admin) {}

  async groupMemberEmails(group: string) {
    const rows = check(await this.db.from("fake_directory_members").select("member_email").eq("group_email", group));
    return (rows ?? []).map((r) => r.member_email.toLowerCase());
  }

  async isGroupMember(group: string, email: string) {
    return (await this.groupMemberEmails(group)).includes(email.toLowerCase());
  }
}
