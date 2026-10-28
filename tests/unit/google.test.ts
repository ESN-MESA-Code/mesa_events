// The real Google clients (Directory ported from MESAttendance, Chat, Drive)
// against a mocked fetch – no network – plus the client choice.
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_MEMBER_SCOPE, GoogleDirectoryClient, groupMemberEmails, isGroupMember } from "@/lib/google/directory";
import { GoogleChatClient, chatMessageId } from "@/lib/google/chat";
import { GoogleDriveClient } from "@/lib/google/drive";
import { accessToken, clearTokenCache, serviceAccountFromEnv, signedAssertion } from "@/lib/google/serviceAccount";
import { googleClients, googleMode } from "@/lib/google";
import { MemoryChatClient } from "@/lib/google/fakes";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const sa = { email: "sync@project.iam.gserviceaccount.com", privateKey: pem };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch mock answering with `responses` in turn (the token request first, if any). */
function fetchReturning(...responses: Response[]) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed so the calls can be inspected
  const fn = vi.fn(async (..._args: unknown[]) => responses.shift()!);
  return { fn, fetch: fn as unknown as typeof fetch };
}

const calls = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.map((c) => ({ url: String(c[0]), init: (c[1] ?? {}) as RequestInit }));

beforeEach(() => clearTokenCache());

describe("service account", () => {
  it("is null without email and key", () => {
    expect(serviceAccountFromEnv({})).toBeNull();
    expect(serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "x" })).toBeNull();
  });

  it("restores line breaks stored as \\n", () => {
    expect(serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_EMAIL: sa.email, GOOGLE_SERVICE_ACCOUNT_KEY: pem.replace(/\n/g, "\\n") })).toEqual(sa);
  });

  it("signs an RS256 JWT for the scopes, verifiable with the public key", () => {
    const now = Date.UTC(2026, 9, 28);
    const jwt = signedAssertion(sa, [GROUP_MEMBER_SCOPE], "admin@esnmesa.org", now);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: sa.email,
      sub: "admin@esnmesa.org",
      scope: GROUP_MEMBER_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });
    expect(crypto.createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(signedAssertion(sa, ["s"]).split(".")[1], "base64url").toString())).not.toHaveProperty("sub");
  });

  it("trades the assertion for a token and caches it", async () => {
    const { fn, fetch } = fetchReturning(json({ access_token: "ya29.token", expires_in: 3600 }));
    expect(await accessToken(sa, ["s"], undefined, fetch)).toBe("ya29.token");
    expect(await accessToken(sa, ["s"], undefined, fetch)).toBe("ya29.token");
    expect(fn).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(String(calls(fn)[0].init.body));
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  });

  it("fails loudly when Google refuses", async () => {
    await expect(accessToken(sa, ["s"], undefined, fetchReturning(json({ error: "unauthorized_client" }, 401)).fetch)).rejects.toThrow("401");
  });
});

describe("Directory API", () => {
  it("follows the pages and keeps active users, lower-cased", async () => {
    const { fn, fetch } = fetchReturning(
      json({
        members: [
          { email: "Chair@esnmesa.org", type: "USER", status: "ACTIVE" },
          { email: "sub-group@esnmesa.org", type: "GROUP", status: "ACTIVE" },
          { email: "gone@esnmesa.org", type: "USER", status: "SUSPENDED" },
        ],
        nextPageToken: "p2",
      }),
      json({ members: [{ email: "treasurer@esnmesa.org", type: "USER", status: "ACTIVE" }] })
    );
    expect(await groupMemberEmails("board@esnmesa.org", "token", fetch)).toEqual(["chair@esnmesa.org", "treasurer@esnmesa.org"]);
    const urls = fn.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls[0].pathname).toBe("/admin/directory/v1/groups/board%40esnmesa.org/members");
    expect(urls[0].searchParams.get("includeDerivedMembership")).toBe("true");
    expect(urls[1].searchParams.get("pageToken")).toBe("p2");
  });

  it("fails on an error instead of returning an empty group", async () => {
    await expect(groupMemberEmails("board@esnmesa.org", "token", fetchReturning(json({}, 403)).fetch)).rejects.toThrow("403");
  });

  it("asks hasMember", async () => {
    const { fn, fetch } = fetchReturning(json({ isMember: true }));
    expect(await isGroupMember("board@esnmesa.org", "chair@esnmesa.org", "t", fetch)).toBe(true);
    expect(String(fn.mock.calls[0][0])).toBe(
      "https://admin.googleapis.com/admin/directory/v1/groups/board%40esnmesa.org/hasMember/chair%40esnmesa.org"
    );
  });

  it("the client gets a token for the read-only scope first", async () => {
    const { fn, fetch } = fetchReturning(json({ access_token: "t" }), json({ isMember: false }));
    expect(await new GoogleDirectoryClient(sa, "admin@esnmesa.org", fetch).isGroupMember("g@esnmesa.org", "x@esnmesa.org")).toBe(false);
    expect(calls(fn)[1].init.headers).toEqual({ Authorization: "Bearer t" });
  });
});

describe("Chat API", () => {
  it("builds valid client message ids", () => {
    expect(chatMessageId("description:3F2A-Event_ID")).toBe("client-description-3f2a-event-id");
    expect(chatMessageId("x".repeat(100))).toHaveLength(63);
    expect(chatMessageId("x".repeat(100))).toMatch(/^client-[a-z0-9-]+$/);
  });

  it("creates a space with a request id (idempotent retries)", async () => {
    const { fn, fetch } = fetchReturning(json({ access_token: "t" }), json({ name: "spaces/AAA", spaceUri: "https://chat.google.com/room/AAA" }));
    const chat = new GoogleChatClient(sa, "bot@esnmesa.org", fetch);
    expect(await chat.createSpace({ displayName: "Pub Quiz – 5 Nov", requestId: "space-1" })).toEqual({
      name: "spaces/AAA",
      url: "https://chat.google.com/room/AAA",
    });
    const call = calls(fn)[1];
    expect(call.url).toBe("https://chat.googleapis.com/v1/spaces?requestId=space-1");
    expect(JSON.parse(String(call.init.body))).toEqual({ spaceType: "SPACE", displayName: "Pub Quiz – 5 Nov" });
  });

  it("treats an existing member / message as success", async () => {
    const { fn, fetch } = fetchReturning(json({ access_token: "t" }), json({}, 409), json({}, 409), json({}, 404));
    const chat = new GoogleChatClient(sa, "bot@esnmesa.org", fetch);
    await chat.addMember("spaces/AAA", "x@esnmesa.org");
    expect(await chat.postMessage("spaces/AAA", "Hi", "welcome:1")).toEqual({ name: "spaces/AAA/messages/client-welcome-1" });
    await chat.removeMember("spaces/AAA", "gone@esnmesa.org");
    expect(calls(fn).slice(1).map((c) => c.init.method)).toEqual(["POST", "POST", "DELETE"]);
  });

  it("truncates the space description to Chat's 150 characters", async () => {
    const { fn, fetch } = fetchReturning(json({ access_token: "t" }), json({}));
    await new GoogleChatClient(sa, "bot@esnmesa.org", fetch).updateSpaceDetails("spaces/AAA", { description: "d".repeat(300), guidelines: "g" });
    const body = JSON.parse(String(calls(fn)[1].init.body));
    expect(body.spaceDetails.description).toHaveLength(150);
    expect(calls(fn)[1].url).toBe("https://chat.googleapis.com/v1/spaces/AAA?updateMask=spaceDetails");
  });

  it("fails on other errors (the job is retried)", async () => {
    const { fetch } = fetchReturning(json({ access_token: "t" }), json({ error: "boom" }, 500));
    await expect(new GoogleChatClient(sa, "bot@esnmesa.org", fetch).updateMessage("spaces/A/messages/1", "x")).rejects.toThrow("500");
  });
});

describe("Drive API", () => {
  it("creates the event folder, then uploads multipart", async () => {
    const { fn, fetch } = fetchReturning(
      json({ access_token: "t" }),
      json({ files: [] }), // folder lookup
      json({ id: "folder1" }), // folder created
      json({ files: [] }), // file lookup
      json({ id: "file1", webViewLink: "https://drive.google.com/file/d/file1/view" })
    );
    const drive = new GoogleDriveClient(sa, "parent", undefined, fetch);
    const out = await drive.uploadFile({ folder: "2026-11-05 Pub Quiz", fileName: "a.jpg", mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) });
    expect(out).toEqual({ id: "file1", url: "https://drive.google.com/file/d/file1/view" });
    const upload = calls(fn)[4];
    expect(upload.url).toContain("uploadType=multipart");
    expect(String(upload.init.headers && (upload.init.headers as Record<string, string>)["Content-Type"])).toMatch(/^multipart\/related; boundary=/);
  });

  it("returns an existing file instead of uploading twice", async () => {
    const { fn, fetch } = fetchReturning(json({ access_token: "t" }), json({ files: [{ id: "folder1" }] }), json({ files: [{ id: "f", webViewLink: "u" }] }));
    expect(await new GoogleDriveClient(sa, "parent", undefined, fetch).uploadFile({ folder: "x", fileName: "a.jpg", mimeType: "image/jpeg", data: new Uint8Array() })).toEqual({ id: "f", url: "u" });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("client choice", () => {
  it("uses fakes without a service account and real clients with one", () => {
    expect(googleMode({})).toBe("fake");
    expect(googleMode({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "a", GOOGLE_SERVICE_ACCOUNT_KEY: "k" })).toBe("real");
    expect(googleMode({ GOOGLE_MODE: "fake", GOOGLE_SERVICE_ACCOUNT_EMAIL: "a", GOOGLE_SERVICE_ACCOUNT_KEY: "k" })).toBe("fake");
  });

  it("refuses real mode without credentials", () => {
    expect(() => googleClients({} as never, { GOOGLE_MODE: "real" })).toThrow(/GOOGLE_SERVICE_ACCOUNT/);
  });

  it("real mode without a Chat subject fails the Chat calls, not the app", async () => {
    const clients = googleClients({} as never, { GOOGLE_SERVICE_ACCOUNT_EMAIL: sa.email, GOOGLE_SERVICE_ACCOUNT_KEY: pem });
    expect(clients.mode).toBe("real");
    await expect(clients.chat.addMember("s", "e")).rejects.toThrow(/GOOGLE_CHAT_SUBJECT/);
  });
});

describe("memory fake", () => {
  it("is idempotent like the real API", async () => {
    const chat = new MemoryChatClient();
    const a = await chat.createSpace({ displayName: "A", requestId: "r1" });
    expect(await chat.createSpace({ displayName: "A", requestId: "r1" })).toEqual(a);
    await chat.postMessage(a.name, "one", "m1");
    await chat.postMessage(a.name, "two", "m1");
    expect([...chat.messages.values()].map((m) => m.text)).toEqual(["one"]);
  });
});
