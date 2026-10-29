// Fakes of the Google clients, for development and tests. Two flavours:
// * Memory* – in-process state, for unit tests,
// * Db*     – the fake_* tables (migration 20261028000050_dev_fakes.sql),
//             used by the app without a service account, so the result of
//             the jobs can be inspected (tests, /admin).
// Both behave like the real clients: idempotent creates and posts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatClient, ChatSpace, DirectoryClient, DriveClient } from "@/lib/google/types";
import { chatMessageId } from "@/lib/google/chat";
import { driveFolderUrl } from "@/lib/photos";
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

/** The fake photo drive's root when DRIVE_PHOTOS_FOLDER_ID is not set. */
export const FAKE_DRIVE_ROOT = "fake-photos-root";
const newFolderId = () => `fakefolder-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

export class MemoryDriveClient implements DriveClient {
  /** id → folder */
  folders = new Map<string, { parent: string; name: string }>();
  /** Files uploaded by "members": folder id → file names. */
  files = new Map<string, string[]>();
  failNext = 0;

  constructor(public root = FAKE_DRIVE_ROOT) {}

  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("Fake Drive API failure");
    }
  }

  async ensureFolder(path: string[]) {
    this.maybeFail();
    let id = this.root;
    for (const name of path) {
      const found = [...this.folders].find(([, f]) => f.parent === id && f.name === name)?.[0];
      if (found) id = found;
      else {
        const created = newFolderId();
        this.folders.set(created, { parent: id, name });
        id = created;
      }
    }
    return { id, url: driveFolderUrl(id) };
  }

  /** A member puts a file into a folder (tests). */
  addFile(folderId: string, name: string) {
    this.files.set(folderId, [...(this.files.get(folderId) ?? []), name]);
  }

  async countFiles(folderId: string): Promise<number> {
    this.maybeFail();
    const sub = [...this.folders].filter(([, f]) => f.parent === folderId).map(([id]) => id);
    let n = (this.files.get(folderId) ?? []).length;
    for (const id of sub) n += await this.countFiles(id);
    return n;
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

/**
 * Folders in fake_drive_folders; files in fake_drive_files stand for what
 * members upload (the demo seed and tests insert them; `npm run
 * fake:drive -- <event id> [n]` adds some by hand).
 */
export class DbDriveClient implements DriveClient {
  constructor(
    private db: Admin,
    private root = FAKE_DRIVE_ROOT
  ) {}

  async ensureFolder(path: string[]) {
    let id = this.root;
    for (const name of path) {
      const existing = check(await this.db.from("fake_drive_folders").select("id").eq("parent_id", id).eq("name", name).maybeSingle());
      if (existing) {
        id = existing.id;
        continue;
      }
      const created = newFolderId();
      // A concurrent run may have created it: the unique (parent, name) keeps one.
      check(await this.db.from("fake_drive_folders").upsert({ id: created, parent_id: id, name }, { onConflict: "parent_id,name", ignoreDuplicates: true }));
      id = check(await this.db.from("fake_drive_folders").select("id").eq("parent_id", id).eq("name", name).single())!.id;
    }
    return { id, url: driveFolderUrl(id) };
  }

  async countFiles(folderId: string, depth = 0): Promise<number> {
    const [{ count }, subs] = await Promise.all([
      this.db.from("fake_drive_files").select("id", { count: "exact", head: true }).eq("folder_id", folderId),
      this.db.from("fake_drive_folders").select("id").eq("parent_id", folderId),
    ]);
    let n = count ?? 0;
    if (depth + 1 < 3) for (const s of check(subs) ?? []) n += await this.countFiles(s.id, depth + 1);
    return n;
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
