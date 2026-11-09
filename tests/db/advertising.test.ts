// Round 2026-11-03: an approved description goes to the Chat space by
// itself (at once, or when the space is created); a Telegram post of several
// events is one message per event, each with its own picture or the default
// of its format (else type) from the Pictures tab.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/publishing";
import { runDueJobs, type JobDeps } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";
import { berlinDate } from "@/lib/dates";

const deps: JobDeps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "http://mesa.test" };
async function runJobs() {
  for (let i = 0; i < 10; i++) if (!(await runDueJobs(deps, HANDLERS, { worker: "advertising-test" })).claimed) break;
}
const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
const fields = (title: string) => ({ title, dateIso: "2026-11-05", time: "19:00", venue: "Shamrock", price: "5", hook: "a test", intro: "A test event.", program: "Testing", bring: "Nothing", closing: "see you" });
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
const created: string[] = [];
const posts: string[] = [];
let formatId: string;
const libraryFiles: string[] = [];

async function submitted(title: string, space: boolean) {
  const e = await createEvent({ title: `${title} ${tag}`, starts_at: hoursFromNow(24 * 8), oc: USERS.oc });
  created.push(e.id);
  await admin.from("descriptions").upsert({ event_id: e.id, status: "submitted", fields: fields(e.title) });
  if (space) await admin.from("events").update({ chat_space_requested_at: new Date().toISOString(), chat_space_name: `spaces/FAKEADV${tag}${created.length}` }).eq("id", e.id);
  return e.id;
}
const approve = async (id: string) => (await as(USERS.comms)).rpc("review_description", { event: id, decision: "approved", comment: "", rendered: "The approved text" });
const description = async (id: string) => (await admin.from("descriptions").select("status, publish_requested_at, published_message_name").eq("event_id", id).single()).data!;

beforeAll(async () => {
  const { data } = await admin.from("event_formats").insert({ name: `Advertising test ${tag}`, type: "standard" }).select("id").single();
  formatId = data!.id;
});
afterAll(async () => {
  const { data } = await admin.from("publication_posts").select("telegram").in("id", posts);
  for (const t of (data ?? []).map((d) => d.telegram as { chatId: string; messages: Array<{ photoMessageId?: number; textMessageId?: number }> } | null).filter(Boolean)) {
    const ids = t!.messages.flatMap((m) => [m.photoMessageId, m.textMessageId]).filter((x): x is number => !!x);
    await admin.from("fake_telegram_messages").delete().eq("chat_id", t!.chatId).in("message_id", ids);
  }
  await admin.from("publication_posts").delete().in("id", posts);
  await admin.from("fake_chat_messages").delete().like("space", `spaces/FAKEADV${tag}%`);
  await admin.from("jobs").delete().in("event_id", created);
  for (const id of posts) await admin.from("jobs").delete().like("idempotency_key", `telegram.publish_post:${id}:%`);
  await admin.from("events").delete().in("id", created);
  await admin.from("event_formats").delete().eq("id", formatId);
  if (libraryFiles.length) await admin.storage.from("advertising-pictures").remove(libraryFiles);
});

describe("approved = published to the Chat space", () => {
  it("approving publishes at once when the event has its space – no Publish click", async () => {
    const id = await submitted("Approve with space", true);
    expect((await approve(id)).error).toBeNull();
    expect((await description(id)).publish_requested_at).not.toBeNull();
    await runJobs();
    const d = await description(id);
    expect(d.status).toBe("published");
    expect(d.published_message_name).toBeTruthy();
  });

  it("without a space it waits, and goes out when the space is created", async () => {
    const id = await submitted("Approve before the space", false);
    expect((await approve(id)).error).toBeNull();
    expect(await description(id)).toMatchObject({ status: "approved", publish_requested_at: null });
    await admin.from("events").update({ chat_space_requested_at: new Date().toISOString() }).eq("id", id);
    expect((await description(id)).publish_requested_at).toBeNull();
    await admin.from("events").update({ chat_space_name: `spaces/FAKEADV${tag}LATE` }).eq("id", id);
    expect((await description(id)).publish_requested_at).not.toBeNull();
    await runJobs();
    expect((await description(id)).status).toBe("published");
  });

  it("changes requested publish nothing", async () => {
    const id = await submitted("Changes", true);
    expect((await (await as(USERS.comms)).rpc("review_description", { event: id, decision: "changes_requested", comment: "Shorter", rendered: "" })).error).toBeNull();
    expect(await description(id)).toMatchObject({ status: "changes_requested", publish_requested_at: null });
  });
});

describe("pictures per message and defaults", () => {
  it("only Comms sets a format's or a type's default picture", async () => {
    const path = `format/${formatId}/${crypto.randomUUID()}.png`;
    expect((await (await as(USERS.events)).storage.from("advertising-pictures").upload(path, png, { contentType: "image/png" })).error).not.toBeNull();
    expect((await (await as(USERS.comms)).storage.from("advertising-pictures").upload(path, png, { contentType: "image/png" })).error).toBeNull();
    libraryFiles.push(path);
    expect(await P.setDefaultPicture(await actionContext(USERS.events), { format_id: formatId, picture: `library:${path}` })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await P.setDefaultPicture(await actionContext(USERS.comms), { format_id: formatId, event_type: "special", picture: `library:${path}` })).toMatchObject({ ok: false });
    expect(await P.setDefaultPicture(await actionContext(USERS.comms), { format_id: formatId, picture: "https://example.com/x.png" })).toMatchObject({ ok: false });
    expect((await P.setDefaultPicture(await actionContext(USERS.comms), { format_id: formatId, picture: `library:${path}` })).ok).toBe(true);
    for (const u of [USERS.comms, USERS.events, USERS.executive]) expect((await (await as(u)).from("advertising_pictures").select("picture").eq("format_id", formatId)).data, u.email).toEqual([{ picture: `library:${path}` }]);
    expect((await (await as(USERS.member)).from("advertising_pictures").select("picture").eq("format_id", formatId)).data).toEqual([]);
  });

  it("a category's default picture (round 2026-11-09): one key at a time, removed with an empty picture", async () => {
    const { data: cat } = await admin.from("event_categories").select("id").order("sort").limit(1).single();
    const path = `category/${cat!.id}/${crypto.randomUUID()}.png`;
    expect((await (await as(USERS.comms)).storage.from("advertising-pictures").upload(path, png, { contentType: "image/png" })).error).toBeNull();
    libraryFiles.push(path);
    expect(await P.setDefaultPicture(await actionContext(USERS.events), { category_id: cat!.id, picture: `library:${path}` })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await P.setDefaultPicture(await actionContext(USERS.comms), { category_id: cat!.id, event_type: "standard", picture: `library:${path}` })).toMatchObject({ ok: false });
    expect((await P.setDefaultPicture(await actionContext(USERS.comms), { category_id: cat!.id, picture: `library:${path}` })).ok).toBe(true);
    expect((await admin.from("advertising_pictures").select("picture, format_id, event_type").eq("category_id", cat!.id)).data).toEqual([{ picture: `library:${path}`, format_id: null, event_type: null }]);
    expect((await P.setDefaultPicture(await actionContext(USERS.comms), { category_id: cat!.id, picture: "" })).ok).toBe(true);
    expect((await admin.from("advertising_pictures").select("id").eq("category_id", cat!.id)).data).toEqual([]);
  });

  it("a post of two events: each message has its own picture, else its format's default", async () => {
    const own = await submitted("Own picture", false);
    const byFormat = await submitted("Format picture", false);
    for (const id of [own, byFormat]) await admin.from("descriptions").update({ status: "approved", approved_fields: fields("x") }).eq("event_id", id);
    await admin.from("descriptions").update({ approved_fields: fields(`Own picture ${tag}`) }).eq("event_id", own);
    await admin.from("descriptions").update({ approved_fields: fields(`Format picture ${tag}`) }).eq("event_id", byFormat);
    await admin.from("events").update({ format_id: formatId }).eq("id", byFormat);

    const r = await P.createPost(await actionContext(USERS.comms), { channel: "telegram", day: berlinDate(hoursFromNow(48)), event_ids: [own, byFormat] });
    if (!r.ok) throw new Error(r.message);
    posts.push(r.data.id);
    const upload = `${r.data.id}/${crypto.randomUUID()}.png`;
    expect((await (await as(USERS.comms)).storage.from("post-pictures").upload(upload, png, { contentType: "image/png" })).error).toBeNull();
    expect(await P.setPostEventPicture(await actionContext(USERS.events), { post_id: r.data.id, event_id: own, picture: `upload:${upload}` })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await P.setPostEventPicture(await actionContext(USERS.comms), { post_id: r.data.id, event_id: own, picture: "upload:another-post/x.png" })).toMatchObject({ ok: false });
    expect((await P.setPostEventPicture(await actionContext(USERS.comms), { post_id: r.data.id, event_id: own, picture: `upload:${upload}` })).ok).toBe(true);

    expect((await P.publishPostNow(await actionContext(USERS.comms), { post_id: r.data.id })).ok).toBe(true);
    await runJobs();
    const post = (await admin.from("publication_posts").select("status, last_error, telegram").eq("id", r.data.id).single()).data!;
    expect(post).toMatchObject({ status: "published", last_error: null });
    const tg = post.telegram as { chatId: string; messages: Array<{ layout: string; picture: string | null; photoMessageId?: number }> };
    expect(tg.messages.map((m) => [m.layout, m.picture])).toEqual([
      ["photo", `upload:${upload}`],
      ["photo", `library:${libraryFiles[0]}`],
    ]);
    const { data: sent } = await admin.from("fake_telegram_messages").select("kind, text").eq("chat_id", tg.chatId).in("message_id", tg.messages.map((m) => m.photoMessageId!)).order("message_id");
    expect(sent!.map((m) => [m.kind, m.text.split("\n")[0]])).toEqual([
      ["photo", `<b>Own picture ${tag}</b>`],
      ["photo", `<b>Format picture ${tag}</b>`],
    ]);
    // The post's upload is gone once it is out; the default stays.
    expect((await admin.storage.from("post-pictures").list(r.data.id)).data).toEqual([]);
    expect((await admin.storage.from("advertising-pictures").list(`format/${formatId}`)).data).toHaveLength(1);
  });
});
