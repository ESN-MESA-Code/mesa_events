// Picks the Google clients: the real ones when a service account is
// configured (GOOGLE_MODE=real or unset with GOOGLE_SERVICE_ACCOUNT_*), the
// database-backed fakes otherwise (GOOGLE_MODE=fake, the default locally).
// Server only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleChatClient } from "@/lib/google/chat";
import { GoogleDirectoryClient } from "@/lib/google/directory";
import { GoogleDriveClient } from "@/lib/google/drive";
import { DbChatClient, DbDirectoryClient, DbDriveClient } from "@/lib/google/fakes";
import { serviceAccountFromEnv } from "@/lib/google/serviceAccount";
import type { ChatClient, DirectoryClient, DriveClient } from "@/lib/google/types";
import type { Database } from "@/types/database";

export interface GoogleClients {
  mode: "real" | "fake";
  chat: ChatClient;
  drive: DriveClient;
  directory: DirectoryClient;
}

export function googleMode(env: Record<string, string | undefined> = process.env): "real" | "fake" {
  if (env.GOOGLE_MODE === "fake") return "fake";
  if (env.GOOGLE_MODE === "real") return "real";
  return serviceAccountFromEnv(env) ? "real" : "fake";
}

class NotConfigured implements ChatClient, DriveClient {
  constructor(private what: string) {}
  private fail(): never {
    throw new Error(`${this.what} is not configured`);
  }
  createSpace = async () => this.fail();
  updateSpaceDetails = async () => this.fail();
  addMember = async () => this.fail();
  removeMember = async () => this.fail();
  postMessage = async () => this.fail();
  updateMessage = async () => this.fail();
  notify = async () => this.fail();
  ensureFolder = async () => this.fail();
  countFiles = async () => this.fail();
}

export function googleClients(admin: SupabaseClient<Database>, env: Record<string, string | undefined> = process.env): GoogleClients {
  if (googleMode(env) === "fake") {
    return { mode: "fake", chat: new DbChatClient(admin), drive: new DbDriveClient(admin, env.DRIVE_PHOTOS_FOLDER_ID || undefined), directory: new DbDirectoryClient(admin) };
  }
  const sa = serviceAccountFromEnv(env);
  if (!sa) throw new Error("GOOGLE_MODE=real needs GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY");
  return {
    mode: "real",
    directory: new GoogleDirectoryClient(sa, env.GOOGLE_ADMIN_SUBJECT || undefined),
    chat: env.GOOGLE_CHAT_SUBJECT ? new GoogleChatClient(sa, env.GOOGLE_CHAT_SUBJECT) : new NotConfigured("Google Chat (GOOGLE_CHAT_SUBJECT)"),
    drive: env.DRIVE_PHOTOS_FOLDER_ID
      ? new GoogleDriveClient(sa, env.DRIVE_PHOTOS_FOLDER_ID, env.GOOGLE_DRIVE_SUBJECT || undefined)
      : new NotConfigured("Google Drive (DRIVE_PHOTOS_FOLDER_ID)"),
  };
}
