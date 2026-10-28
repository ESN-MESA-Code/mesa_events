// The Google services the platform uses, as small interfaces. Real
// fetch-based clients (directory.ts, chat.ts, drive.ts) and fakes
// (fakes.ts) implement them; lib/google/index.ts picks one.

export interface DirectoryClient {
  /** Email addresses of the group's users, nested groups included, suspended users left out. */
  groupMemberEmails(group: string): Promise<string[]>;
  isGroupMember(group: string, email: string): Promise<boolean>;
}

export interface ChatSpace {
  /** Resource name, e.g. "spaces/AAAA1234" */
  name: string;
  url: string;
}

export interface ChatClient {
  /** Creates a space; the same requestId returns the same space (idempotent). */
  createSpace(input: { displayName: string; requestId: string }): Promise<ChatSpace>;
  /** Space description (at most 150 characters) and guidelines (at most 5,000). */
  updateSpaceDetails(space: string, details: { description: string; guidelines: string }): Promise<void>;
  /** Adding an existing member or removing a missing one is not an error. */
  addMember(space: string, email: string): Promise<void>;
  removeMember(space: string, email: string): Promise<void>;
  /** Posts a message; the same messageId posts it only once. Returns its resource name. */
  postMessage(space: string, text: string, messageId: string): Promise<{ name: string }>;
  updateMessage(messageName: string, text: string): Promise<void>;
  /** Sends a direct message to a person (notifications); idempotent per messageId. */
  notify(email: string, text: string, messageId: string): Promise<void>;
}

export interface DriveClient {
  /** Uploads a file into the event's folder (created if missing). Idempotent per fileName within a folder. */
  uploadFile(input: { folder: string; fileName: string; mimeType: string; data: Uint8Array }): Promise<{ id: string; url: string }>;
}

/** Mentions in Chat message text. */
export const mention = (email: string) => `<users/${email}>`;
export const MENTION_ALL = "<users/all>";

export const SPACE_DESCRIPTION_MAX = 150;
export const SPACE_GUIDELINES_MAX = 5000;
