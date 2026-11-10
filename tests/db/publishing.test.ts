// Publishing (brief 2026-10-29, E): only Comms plans and publishes; a
// Telegram post's job runs at its time, once per version; publishing
// against the fake Telegram, re-publishing edits the same message, refusals
// (unapproved, TBA); manual channels; the status per event and channel;
// posts weeks before an event of a later month (round 2026-11-02).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, hoursFromNow, setAsideTypePictures } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/publishing";
import { runDueJobs, type JobDeps } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";
import { berlinDate } from "@/lib/dates";
import { loadStillToPlan } from "@/lib/publishingLoad";

const deps: JobDeps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "http://mesa.test" };
// Until the queue is empty (other suites may have left due jobs ahead of ours).
async function runJobs() {
  const all: Awaited<ReturnType<typeof runDueJobs>>["results"] = [];
  for (let i = 0; i < 10; i++) {
    const r = await runDueJobs(deps, HANDLERS, { worker: "publishing-test" });
    all.push(...r.results);
    if (!r.claimed) break;
  }
  return { results: all };
}
const space = `spaces/FAKEPUB${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const fields = (title: string, price = "5") => ({ title, dateIso: "2026-11-05", time: "19:00", venue: "Shamrock", price, hook: "a test", intro: "A test event.", program: "Testing", bring: "Nothing", closing: "see you" });
const day = (h: number) => berlinDate(hoursFromNow(h));
let approved: string;
let unapproved: string;
let tba: string;
let free: string;
const created: string[] = [];
const posts: string[] = [];
// These posts go out as text: no default picture for their events' type meanwhile.
let restorePictures: () => Promise<void> = async () => {};

async function post(channel: string, events: string[], h = 48) {
  const r = await P.createPost(await actionContext(USERS.comms), { channel, day: day(h), time: "10:00", event_ids: events });
  if (!r.ok) throw new Error(r.message);
  posts.push(r.data.id);
  return r.data.id;
}
const row = async (id: string) => (await admin.from("publication_posts").select("*").eq("id", id).single()).data!;
// The sent messages of a post, in order (one per event since round 2026-11-03).
type SentState = { chatId: string; messages: Array<{ textMessageId?: number; photoMessageId?: number }> };
const sentIds = (t: SentState) => t.messages.flatMap((m) => [m.photoMessageId, m.textMessageId]).filter((x): x is number => !!x);
const tgMessages = async (id: string) => {
  const t = (await row(id)).telegram as SentState | null;
  if (!t?.messages?.length) return [];
  const { data } = await admin.from("fake_telegram_messages").select("text, edits, deleted").eq("chat_id", t.chatId).in("message_id", sentIds(t)).order("message_id");
  return data ?? [];
};

beforeAll(async () => {
  restorePictures = await setAsideTypePictures();
  const make = async (title: string, status: string, price = "5") => {
    const e = await createEvent({ title, starts_at: hoursFromNow(24 * 6), oc: USERS.oc, helpers: [USERS.helper] });
    created.push(e.id);
    await admin.from("descriptions").upsert({ event_id: e.id, status, fields: fields(title, price), approved_fields: ["approved", "published"].includes(status) ? fields(title, price) : null });
    return e.id;
  };
  approved = await make("Pub approved", "approved");
  unapproved = await make("Pub submitted", "submitted");
  tba = await make("Pub TBA", "approved", "TBA");
  free = await make("Pub free", "approved", "free");
  await admin.from("events").update({ chat_space_name: space }).eq("id", approved);
});
afterAll(async () => {
  await restorePictures();
  const { data } = await admin.from("publication_posts").select("telegram").in("id", posts);
  for (const t of (data ?? []).map((d) => d.telegram as SentState | null).filter(Boolean)) {
    await admin.from("fake_telegram_messages").delete().eq("chat_id", t!.chatId).in("message_id", sentIds(t!));
  }
  await admin.from("publication_posts").delete().in("id", posts);
  await admin.from("fake_chat_messages").delete().eq("space", space);
  await admin.from("jobs").delete().in("event_id", created);
  for (const id of posts) await admin.from("jobs").delete().like("idempotency_key", `telegram.publish_post:${id}:%`);
  await admin.from("events").delete().in("id", created);
});

describe("who plans", () => {
  it("only Comms creates and changes posts; Comms, Events and executives read them", async () => {
    for (const u of [USERS.events, USERS.oc, USERS.member, USERS.executive]) {
      expect(await P.createPost(await actionContext(u), { channel: "telegram", day: day(48), event_ids: [approved] }), u.email).toMatchObject({ ok: false, error: "forbidden" });
      expect((await (await as(u)).rpc("create_post", { channel: "telegram", scheduled_for: hoursFromNow(48), events: [approved] })).error?.code, u.email).toBe("42501");
    }
    const id = await post("instagram", [approved]);
    for (const u of [USERS.comms, USERS.events, USERS.executive]) expect((await (await as(u)).from("publication_posts").select("id").eq("id", id)).data, u.email).toHaveLength(1);
    for (const u of [USERS.oc, USERS.helper, USERS.member, USERS.finance, USERS.admin]) expect((await (await as(u)).from("publication_posts").select("id").eq("id", id)).data, u.email).toEqual([]);
    expect(await P.createPost(await actionContext(USERS.comms), { channel: "chat", day: day(48), event_ids: [approved] })).toMatchObject({ ok: false, message: "This channel is not on the schedule" });
  });
});

describe("Telegram", () => {
  let tg: string;

  it("a planned post goes out only once Comms confirmed it (round 2026-10-30); a change takes the confirmation back", async () => {
    tg = await post("telegram", [approved], 48);
    const jobs = async () => (await admin.from("jobs").select("idempotency_key, run_after, status").like("idempotency_key", `telegram.publish_post:${tg}:%`).order("id")).data!;
    // Planned, not confirmed: no job.
    expect(await jobs()).toHaveLength(0);
    expect(await P.confirmPost(await actionContext(USERS.events), { post_id: tg })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await P.confirmPost(await actionContext(USERS.comms), { post_id: tg })).ok).toBe(true);
    expect(await row(tg)).toMatchObject({ confirmed_by: USERS.comms.email });
    let j = await jobs();
    expect(j).toHaveLength(1);
    expect(Math.abs(Date.parse(j[0].run_after) - Date.parse((await row(tg)).scheduled_for))).toBeLessThan(1000);
    await runJobs();
    expect((await row(tg)).status).toBe("planned");
    // A move is a new version without confirmation: no new job, and the old one skips itself.
    expect((await P.movePost(await actionContext(USERS.comms), { post_id: tg, day: day(72), time: "11:00" })).ok).toBe(true);
    expect((await row(tg)).confirmed_at).toBeNull();
    j = await jobs();
    expect(j).toHaveLength(1);
    // A minute back: the database clock may lag the test's.
    await admin.from("jobs").update({ run_after: new Date(Date.now() - 60_000).toISOString() }).eq("idempotency_key", j[0].idempotency_key);
    await runJobs();
    // (pg_cron's runner may have taken it first – either way it ran and skipped itself.)
    expect((await jobs())[0].status).toBe("done");
    expect((await row(tg)).status).toBe("planned");
    // Confirmed again: a job for the new version.
    expect((await P.confirmPost(await actionContext(USERS.comms), { post_id: tg })).ok).toBe(true);
    expect(await jobs()).toHaveLength(2);
    // Only Telegram posts are confirmed.
    const ig = await post("instagram", [approved], 48);
    expect(await P.confirmPost(await actionContext(USERS.comms), { post_id: ig })).toMatchObject({ ok: false, message: "Only Telegram posts are confirmed for sending" });
    await P.deletePost(await actionContext(USERS.comms), { post_id: ig });
  });

  it("plans an event on every required channel it is missing from, on one day (round 2026-10-30)", async () => {
    const beforeRows = (await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel)").eq("event_id", approved)).data!;
    const before = beforeRows.map((x) => (x.publication_posts as { channel: string }).channel);
    const r = await P.planEverywhere(await actionContext(USERS.comms), { event_id: approved, day: day(96), time: "09:00" });
    expect(r.ok).toBe(true);
    const after = (await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel, scheduled_for)").eq("event_id", approved)).data!;
    const channels = after.map((x) => (x.publication_posts as { channel: string }).channel);
    for (const c of ["telegram", "instagram"]) expect(channels).toContain(c);
    // pretix is a checklist, not on the schedule (round 2026-10-31).
    expect(channels).not.toContain("pretix");
    // Telegram was there already: not planned twice.
    expect(channels.filter((c) => c === "telegram")).toHaveLength(before.filter((c) => c === "telegram").length);
    expect(r.ok && r.data.posts).toBe(2 - new Set(before.filter((c) => ["telegram", "instagram"].includes(c))).size);
    // Again: nothing left to plan.
    expect(await P.planEverywhere(await actionContext(USERS.comms), { event_id: approved, day: day(96) })).toMatchObject({ ok: true, data: { posts: 0 } });
    expect(await P.planEverywhere(await actionContext(USERS.events), { event_id: approved, day: day(96) })).toMatchObject({ ok: false, error: "forbidden" });
    const added = after.map((x) => x.post_id).filter((id) => !beforeRows.some((b) => b.post_id === id));
    for (const id of added) await P.deletePost(await actionContext(USERS.comms), { post_id: id });
  });

  it("uploaded pictures: Comms only, kept in a private bucket until the post is out", async () => {
    const path = `${tg}/${crypto.randomUUID()}.png`;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await (await as(USERS.events)).storage.from("post-pictures").upload(path, png, { contentType: "image/png" })).error).not.toBeNull();
    expect((await (await as(USERS.comms)).storage.from("post-pictures").upload(path, png, { contentType: "image/png" })).error).toBeNull();
    expect(await P.editPost(await actionContext(USERS.comms), { post_id: tg, picture: "https://example.com/x.jpg" })).toMatchObject({ ok: false });
    expect((await P.editPost(await actionContext(USERS.comms), { post_id: tg, picture: `upload:${path}` })).ok).toBe(true);
    for (const u of [USERS.member, USERS.events]) expect(((await (await as(u)).storage.from("post-pictures").list(tg)).data ?? []).length, u.email).toBe(0);
    // Removed again: the upload goes too.
    expect((await P.editPost(await actionContext(USERS.comms), { post_id: tg, picture: "" })).ok).toBe(true);
    expect((await admin.storage.from("post-pictures").list(tg)).data).toEqual([]);
  });

  it("publishes at its time (here: now), tells the space once; re-publishing edits the same message", async () => {
    expect((await P.publishPostNow(await actionContext(USERS.comms), { post_id: tg })).ok).toBe(true);
    await runJobs();
    const p = await row(tg);
    expect(p).toMatchObject({ status: "published", published_by: "schedule", last_error: null });
    expect(p.link).toMatch(/^https:\/\/t\.me\/mesa_fake_channel\/\d+$/);
    let msgs = await tgMessages(tg);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text.startsWith("<b>PUB APPROVED</b>\n\n🗓️")).toBe(true);
    const { data: chat } = await admin.from("fake_chat_messages").select("text").eq("space", space).like("text", "%on Telegram%");
    expect(chat).toEqual([{ text: `<users/all> 📢 Comms has published *Pub approved* on Telegram. <${p.link}|Open>` }]);

    // The description changes after approval and is approved again: publish again → the message is edited.
    await admin.from("descriptions").update({ approved_fields: { ...fields("Pub approved"), hook: "a changed test" } }).eq("event_id", approved);
    expect((await P.publishPostNow(await actionContext(USERS.comms), { post_id: tg })).ok).toBe(true);
    await runJobs();
    msgs = await tgMessages(tg);
    expect(msgs).toEqual([expect.objectContaining({ edits: 1, deleted: false })]);
    expect(msgs[0].text).toContain("are you ready for a changed test?");
    expect((await admin.from("fake_chat_messages").select("name").eq("space", space).like("text", "%on Telegram%")).data).toHaveLength(1);
  });

  it("refuses an unapproved description or a TBA price – the reason on the post, no retry", async () => {
    for (const [ev, reason] of [
      [unapproved, "The description of “Pub submitted” is not approved yet."],
      [tba, "The price of “Pub TBA” is still TBA."],
    ]) {
      const id = await post("telegram", [ev]);
      await P.publishPostNow(await actionContext(USERS.comms), { post_id: id });
      await runJobs();
      expect(await row(id)).toMatchObject({ status: "planned", last_error: reason, telegram: null });
    }
  });

  it("a post of several events: its heading, then one message per event, in its order (round 2026-11-03)", async () => {
    const id = await post("telegram", [free]);
    expect((await P.addToPost(await actionContext(USERS.comms), { post_id: id, event_id: approved })).ok).toBe(true);
    expect((await P.editPost(await actionContext(USERS.comms), { post_id: id, picture: "", note: "This week" })).ok).toBe(true);
    expect((await P.reorderPost(await actionContext(USERS.comms), { post_id: id, event_ids: [approved, free] })).ok).toBe(true);
    await P.publishPostNow(await actionContext(USERS.comms), { post_id: id });
    await runJobs();
    const ms = await tgMessages(id);
    expect(ms.map((m) => m.text.split("\n")[0])).toEqual(["<b>📅 This week</b>", "<b>PUB APPROVED</b>", "<b>PUB FREE</b>"]);
    expect(ms[1].text).toContain("💸 € 5.00");
    expect(ms[2].text).toContain("FREE");
    // Published again with the same messages: each is edited in place, none sent anew.
    await admin.from("descriptions").update({ approved_fields: { ...fields("Pub free", "free"), hook: "a bundled change" } }).eq("event_id", free);
    expect((await P.publishPostNow(await actionContext(USERS.comms), { post_id: id })).ok).toBe(true);
    await runJobs();
    const again = await tgMessages(id);
    expect(again).toHaveLength(3);
    expect(again[2]).toMatchObject({ edits: 1, deleted: false });
    expect(again[2].text).toContain("a bundled change");
  });

  it("a post saved before one message per event (one layout, no list) is still edited in place", async () => {
    const id = await post("telegram", [approved]);
    await P.publishPostNow(await actionContext(USERS.comms), { post_id: id });
    await runJobs();
    const t = (await row(id)).telegram as SentState & { messageId: number };
    const textMessageId = t.messages[0].textMessageId!;
    await admin.from("publication_posts").update({ telegram: { chatId: t.chatId, layout: "text", picture: null, textMessageId, messageId: t.messageId } }).eq("id", id);
    await admin.from("descriptions").update({ approved_fields: { ...fields("Pub approved"), hook: "an old state" } }).eq("event_id", approved);
    expect((await P.publishPostNow(await actionContext(USERS.comms), { post_id: id })).ok).toBe(true);
    await runJobs();
    const { data } = await admin.from("fake_telegram_messages").select("text, edits, deleted").eq("chat_id", t.chatId).eq("message_id", textMessageId).single();
    expect(data).toMatchObject({ edits: 1, deleted: false });
    expect(data!.text).toContain("an old state");
    expect(await tgMessages(id)).toHaveLength(1);
  });
});

describe("manual channels and the status", () => {
  it("Instagram is marked published with a link (once told in the space); Telegram cannot be marked by hand", async () => {
    const ig = (await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel)").eq("event_id", approved).eq("publication_posts.channel", "instagram").single()).data!.post_id;
    expect(await P.markPostPublished(await actionContext(USERS.comms), { post_id: ig, link: "not a link" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect((await P.markPostPublished(await actionContext(USERS.comms), { post_id: ig, link: "https://www.instagram.com/p/abc/" })).ok).toBe(true);
    await runJobs();
    expect((await admin.from("fake_chat_messages").select("text").eq("space", space).like("text", "%on Instagram%")).data).toEqual([
      { text: "<users/all> 📢 Comms has published *Pub approved* on Instagram. <https://www.instagram.com/p/abc/|Open>" },
    ]);
    const tgPost = posts[1];
    expect(await P.markPostPublished(await actionContext(USERS.comms), { post_id: tgPost, link: "https://t.me/x/1" })).toMatchObject({ ok: false, message: "The platform publishes this channel itself" });
  });

  it("skip needs a reason; published posts stay; each change is logged for the event's staff", async () => {
    const id = await post("instagram", [free]);
    expect(await P.skipPost(await actionContext(USERS.comms), { post_id: id, reason: " " })).toMatchObject({ ok: false, error: "invalid_input" });
    expect((await P.skipPost(await actionContext(USERS.comms), { post_id: id, reason: "no pretix for free events" })).ok).toBe(true);
    expect(await P.deletePost(await actionContext(USERS.comms), { post_id: posts[1] })).toMatchObject({ ok: false, message: "Published posts stay (they are the record)" });
    const { data: log } = await (await as(USERS.oc)).from("activity_log").select("details").eq("event_id", free).eq("entity", "publication_posts");
    expect(log!.some((l) => (l.details as { skipped?: string }).skipped === "no pretix for free events")).toBe(true);
  });

  it("status per event and channel; staff and teams read it, others nothing", async () => {
    const status = async (u: (typeof USERS)[keyof typeof USERS], ev: string) =>
      Object.fromEntries(((await (await as(u)).rpc("publication_status", { events: [ev] })).data ?? []).map((s) => [s.channel, s.state]));
    expect(await status(USERS.oc, approved)).toEqual({ chat: "planned", telegram: "published", instagram: "published", pretix: "not_planned", esn: "not_planned" });
    expect(await status(USERS.comms, free)).toMatchObject({ telegram: "published", instagram: "skipped" });
    expect(await status(USERS.comms, unapproved)).toMatchObject({ telegram: "planned" });
    expect(await status(USERS.member, approved)).toEqual({});
  });

  it("pretix is a tick per event, with its link optionally – not a post on the schedule (round 2026-10-31)", async () => {
    const status = async (ev: string) => Object.fromEntries(((await (await as(USERS.comms)).rpc("publication_status", { events: [ev] })).data ?? []).map((s) => [s.channel, s]));
    expect(await P.createPost(await actionContext(USERS.comms), { channel: "pretix", day: day(48), event_ids: [approved] })).toMatchObject({ ok: false, message: "This channel is not on the schedule" });
    expect(await P.setPretixReady(await actionContext(USERS.events), { event_id: approved, ready: true })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await P.setPretixReady(await actionContext(USERS.comms), { event_id: approved, ready: true, link: "pretix.eu/x" })).toMatchObject({ ok: false, error: "invalid_input" });
    expect((await P.setPretixReady(await actionContext(USERS.comms), { event_id: approved, ready: true })).ok).toBe(true);
    expect(await status(approved)).toMatchObject({ pretix: { state: "published", link: null } });
    // Ticking again only sets the link; still one pretix post.
    expect((await P.setPretixReady(await actionContext(USERS.comms), { event_id: approved, ready: true, link: "https://pretix.eu/esnmesa/pub/" })).ok).toBe(true);
    expect(await status(approved)).toMatchObject({ pretix: { state: "published", link: "https://pretix.eu/esnmesa/pub/" } });
    const pretixPosts = async () => (await admin.from("publication_post_events").select("post_id, publication_posts!inner(channel)").eq("event_id", approved).eq("publication_posts.channel", "pretix")).data ?? [];
    expect(await pretixPosts()).toHaveLength(1);
    await runJobs();
    expect((await admin.from("fake_chat_messages").select("text").eq("space", space).like("text", "%on pretix%")).data).toHaveLength(1);
    // Not up after all: the tick goes.
    expect((await P.setPretixReady(await actionContext(USERS.comms), { event_id: approved, ready: false })).ok).toBe(true);
    expect(await status(approved)).toMatchObject({ pretix: { state: "not_planned" } });
    expect(await pretixPosts()).toHaveLength(0);
  });

  it("an admin switches a channel off: it leaves the status and the board", async () => {
    expect((await P.setChannelEnabled(await actionContext(USERS.comms), { channel: "pretix", enabled: false })).ok).toBe(false);
    expect((await P.setChannelEnabled(await actionContext(USERS.admin), { channel: "pretix", enabled: false })).ok).toBe(true);
    try {
      const { data } = await (await as(USERS.comms)).rpc("publication_status", { events: [free] });
      expect((data ?? []).map((s) => s.channel)).not.toContain("pretix");
      expect(await P.createPost(await actionContext(USERS.comms), { channel: "pretix", day: day(48), event_ids: [free] })).toMatchObject({ ok: false });
      expect(await P.setPretixReady(await actionContext(USERS.comms), { event_id: free, ready: true })).toMatchObject({ ok: false });
    } finally {
      await P.setChannelEnabled(await actionContext(USERS.admin), { channel: "pretix", enabled: true });
    }
  });
});

describe("events weeks ahead (round 2026-11-02)", () => {
  it("a post may go out weeks before its event, in an earlier month; the event may still be in its volunteer form; drafts only within six weeks", async () => {
    const trip = await createEvent({ title: "Pub weekend trip", type: "weekend_trip", status: "scheduled", starts_at: hoursFromNow(24 * 60), oc: USERS.oc });
    const draft = await createEvent({ title: "Pub draft", status: "draft", starts_at: hoursFromNow(24 * 60) });
    // Round 2026-11-09: a draft a month away may be advertised already (its cycle is still being planned).
    const nearDraft = await createEvent({ title: "Pub near draft", status: "draft", starts_at: hoursFromNow(24 * 30) });
    created.push(trip.id, draft.id, nearDraft.id);
    const early = await P.createPost(await actionContext(USERS.comms), { channel: "instagram", day: day(48), event_ids: [nearDraft.id] });
    expect(early.ok).toBe(true);
    if (early.ok) await admin.from("publication_posts").delete().eq("id", early.data.id);
    // No description yet: it can be planned all the same (the warning says so on the board).
    const id = await post("instagram", [trip.id], 48);
    expect(berlinDate((await row(id)).scheduled_for)).toBe(day(48));
    // Moved further ahead, still weeks before the trip.
    expect((await P.movePost(await actionContext(USERS.comms), { post_id: id, day: day(24 * 30), time: "12:00" })).ok).toBe(true);
    expect(await P.createPost(await actionContext(USERS.comms), { channel: "instagram", day: day(48), event_ids: [draft.id] })).toMatchObject({ ok: false, message: "This event cannot be published" });

    // Home's figure: the trip is still missing Telegram, whichever month it is in.
    const ids = async () => (await loadStillToPlan(await as(USERS.comms), Date.now())).toPlan.map((e) => e.id);
    // Its pretix page is not up either.
    expect((await loadStillToPlan(await as(USERS.comms), Date.now())).pretix.map((e) => e.id)).toContain(trip.id);
    expect(await ids()).toContain(trip.id);
    expect(await ids()).not.toContain(draft.id);
    const tg = await post("telegram", [trip.id], 72);
    expect(await ids()).not.toContain(trip.id);
    // Telegram refuses it until the description is approved (the board shows why, without a confirm button).
    await P.publishPostNow(await actionContext(USERS.comms), { post_id: tg });
    await runJobs();
    expect(await row(tg)).toMatchObject({ status: "planned", last_error: "The description of “Pub weekend trip” is not approved yet." });
  });
});

describe("content planning (round 2026-11-09)", () => {
  it("a post without events needs a title and is not on Telegram; who, how far, caption and design; the last event leaves a titled post", async () => {
    const ctx = await actionContext(USERS.comms);
    expect(await P.createPost(ctx, { channel: "instagram", day: day(48), event_ids: [] })).toMatchObject({ ok: false });
    expect(await P.createPost(ctx, { channel: "telegram", day: day(48), event_ids: [], title: "December calendar" })).toMatchObject({ ok: false });
    const r = await P.createPost(ctx, { channel: "instagram", day: day(48), event_ids: [], title: "December calendar", format: "post" });
    if (!r.ok) throw new Error(r.message);
    posts.push(r.data.id);
    expect(await row(r.data.id)).toMatchObject({ title: "December calendar", format: "post", progress: "todo", assignees: [] });

    const content = { post_id: r.data.id, title: "December calendar", format: "post", progress: "in_progress", caption: "New month, new events", design_link: "https://www.canva.com/design/x" };
    expect(await P.updatePostContent(await actionContext(USERS.events), { ...content, assignees: [USERS.comms.email] })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await P.updatePostContent(ctx, { ...content, assignees: [USERS.member.email] })).toMatchObject({ ok: false });
    expect(await P.updatePostContent(ctx, { ...content, title: "", assignees: [] })).toMatchObject({ ok: false });
    const before = await row(r.data.id);
    expect((await P.updatePostContent(ctx, { ...content, assignees: [USERS.comms.email.toUpperCase()] })).ok).toBe(true);
    const after = await row(r.data.id);
    expect(after).toMatchObject({ assignees: [USERS.comms.email], progress: "in_progress", caption: "New month, new events", design_link: "https://www.canva.com/design/x" });
    // Not a change to what is sent: the version stays.
    expect(after.version).toBe(before.version);
    // The team to pick from.
    expect(((await (await as(USERS.comms)).rpc("comms_team")).data ?? []).map((m) => m.email)).toContain(USERS.comms.email);

    // A titled post of an event stays when its event is removed.
    const titled = await P.createPost(ctx, { channel: "instagram", day: day(48), event_ids: [approved], title: "Sales NOW" });
    if (!titled.ok) throw new Error(titled.message);
    posts.push(titled.data.id);
    expect((await P.removeFromPost(ctx, { post_id: titled.data.id, event_id: approved })).ok).toBe(true);
    expect((await row(titled.data.id)).title).toBe("Sales NOW");
  });
});
