// Google Chat API client (REST, fetch-based), used only when a service
// account is configured (GOOGLE_MODE=real). It acts as a Workspace user
// through domain-wide delegation (GOOGLE_CHAT_SUBJECT, e.g. a dedicated
// events-bot@ account), because creating spaces and adding members needs
// user authentication. Scopes to delegate: CHAT_SCOPES below.
//
// Every call is idempotent, so the jobs runner can retry safely:
// spaces are created with a requestId, messages with a client messageId,
// adding an existing member or removing a missing one is not an error.
import { accessToken, type Fetch, type ServiceAccount } from "@/lib/google/serviceAccount";
import {
  SPACE_DESCRIPTION_MAX,
  SPACE_GUIDELINES_MAX,
  type ChatClient,
  type ChatSpace,
} from "@/lib/google/types";

const API = "https://chat.googleapis.com/v1";
export const CHAT_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.memberships",
  "https://www.googleapis.com/auth/chat.messages",
];

/** Chat message ids: "client-" + lowercase letters, digits and hyphens, at most 63 characters. */
export function chatMessageId(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `client-${slug}`.slice(0, 63).replace(/-$/, "");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export class GoogleChatClient implements ChatClient {
  constructor(
    private sa: ServiceAccount,
    private subject: string,
    private fetchFn: Fetch = fetch
  ) {}

  private async call(method: string, path: string, body?: unknown, okStatuses: number[] = []) {
    const token = await accessToken(this.sa, CHAT_SCOPES, this.subject, this.fetchFn);
    const res = await this.fetchFn(`${API}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`Chat API ${method} ${path} failed (${res.status}): ${await res.text()}`);
    }
    return res;
  }

  async createSpace({ displayName, requestId }: { displayName: string; requestId: string }): Promise<ChatSpace> {
    const res = await this.call("POST", `spaces?requestId=${encodeURIComponent(requestId)}`, {
      spaceType: "SPACE",
      displayName: truncate(displayName, 128),
    });
    const space = (await res.json()) as { name: string; spaceUri?: string };
    return { name: space.name, url: space.spaceUri ?? `https://mail.google.com/chat/u/0/#chat/space/${space.name.split("/")[1]}` };
  }

  async updateSpaceDetails(space: string, details: { description: string; guidelines: string }) {
    await this.call("PATCH", `${space}?updateMask=spaceDetails`, {
      spaceDetails: {
        description: truncate(details.description, SPACE_DESCRIPTION_MAX),
        guidelines: truncate(details.guidelines, SPACE_GUIDELINES_MAX),
      },
    });
  }

  async addMember(space: string, email: string) {
    // 409: already a member.
    await this.call("POST", `${space}/members`, { member: { name: `users/${email}`, type: "HUMAN" } }, [409]);
  }

  async removeMember(space: string, email: string) {
    // With user authentication the member may be named by email; 404: not a member.
    await this.call("DELETE", `${space}/members/${encodeURIComponent(`users/${email}`)}`, undefined, [404]);
  }

  async postMessage(space: string, text: string, messageId: string) {
    const id = chatMessageId(messageId);
    const res = await this.call("POST", `${space}/messages?messageId=${id}`, { text }, [409]);
    if (res.status === 409) return { name: `${space}/messages/${id}` };
    const message = (await res.json()) as { name: string };
    return { name: message.name };
  }

  async updateMessage(messageName: string, text: string) {
    await this.call("PATCH", `${messageName}?updateMask=text`, { text });
  }

  async notify(email: string, text: string, messageId: string) {
    const res = await this.call("GET", `spaces:findDirectMessage?name=${encodeURIComponent(`users/${email}`)}`, undefined, [404]);
    let space: string;
    if (res.status === 404) {
      const setup = await this.call("POST", "spaces:setup", {
        space: { spaceType: "DIRECT_MESSAGE", singleUserBotDm: false },
        memberships: [{ member: { name: `users/${email}`, type: "HUMAN" } }],
      });
      space = ((await setup.json()) as { name: string }).name;
    } else {
      space = ((await res.json()) as { name: string }).name;
    }
    await this.postMessage(space, text, messageId);
  }
}
