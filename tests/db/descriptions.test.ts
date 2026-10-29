// Descriptions: autosave merge, who edits, the Comms review, idempotent
// publishing (and editing the posted message after a new approval).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, daysFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as D from "@/lib/actions/descriptions";
import { runDueJobs } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";
import { postedTexts } from "@/lib/jobs/descriptions";
import { renderDescription, coerceFields } from "@/lib/description/template";

const deps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "https://events.example" };
const runJobs = () => runDueJobs(deps, HANDLERS, { worker: "desc-test" });

const complete = {
  title: "Pub Quiz",
  dateIso: "2026-12-03",
  time: "19:30",
  venue: "Shamrock",
  price: "5",
  priceNote: "",
  hook: "a night of trivia",
  intro: "Test your knowledge. Win prizes!",
  program: "Six rounds",
  bring: "Good mood 😄",
  closing: "see you there!",
  esnType: "10",
  esnObjectives: "413,426",
};

describe("descriptions", () => {
  let eventId: string;
  let otherId: string;

  beforeAll(async () => {
    const ev = await createEvent({ title: "Pub Quiz", oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(20) });
    eventId = ev.id;
    otherId = (await createEvent({ title: "Other", oc: USERS.volunteer1, starts_at: daysFromNow(21) })).id;
    await (await as(USERS.events)).rpc("request_chat_space", { event: eventId });
    await runJobs();
  });
  afterAll(async () => {
    await admin.from("events").delete().in("id", [eventId, otherId]);
  });

  it("the OC, Events and Comms edit; helpers, other members and other OCs do not", async () => {
    expect((await D.saveDescription(await actionContext(USERS.oc), { event_id: eventId, patch: { title: "Pub Quiz", venue: "Shamrock" } })).ok).toBe(true);
    for (const u of [USERS.helper, USERS.member, USERS.volunteer1, USERS.finance]) {
      expect(await D.saveDescription(await actionContext(u), { event_id: eventId, patch: { venue: "Hacked" } }), u.email).toMatchObject({ ok: false, error: "forbidden" });
    }
    expect((await D.saveDescription(await actionContext(USERS.comms), { event_id: eventId, patch: { priceNote: "ESNcard € 4" } })).ok).toBe(true);
    const { data } = await admin.from("descriptions").select("fields, version").eq("event_id", eventId).single();
    expect(data).toMatchObject({ fields: { title: "Pub Quiz", venue: "Shamrock", priceNote: "ESNcard € 4" }, version: 2 });
  });

  it("merges per field and ignores unknown keys", async () => {
    await (await as(USERS.oc)).rpc("save_description", { event: eventId, patch: { hook: "trivia", evil: "x", intro: 5 } });
    await (await as(USERS.events)).rpc("save_description", { event: eventId, patch: { intro: "Fun. Prizes!" } });
    const { data } = await admin.from("descriptions").select("fields").eq("event_id", eventId).single();
    expect(data!.fields).toEqual({ title: "Pub Quiz", venue: "Shamrock", priceNote: "ESNcard € 4", hook: "trivia", intro: "Fun. Prizes!" });
    // The action validates the patch strictly.
    expect(await D.saveDescription(await actionContext(USERS.oc), { event_id: eventId, patch: { evil: "x" } })).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("an incomplete description cannot be submitted", async () => {
    const r = await D.submitDescription(await actionContext(USERS.oc), { event_id: eventId });
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/Not complete yet/);
  });

  it("only the OC or Events submit; only Comms review", async () => {
    await (await as(USERS.oc)).rpc("save_description", { event: eventId, patch: complete });
    expect(await D.submitDescription(await actionContext(USERS.helper), { event_id: eventId })).toMatchObject({ ok: false });
    expect(await D.submitDescription(await actionContext(USERS.comms), { event_id: eventId })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await D.submitDescription(await actionContext(USERS.oc), { event_id: eventId })).ok).toBe(true);

    expect(await D.reviewDescription(await actionContext(USERS.oc), { event_id: eventId, decision: "approved" })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.events)).rpc("review_description", { event: eventId, decision: "approved", comment: "", rendered: "x" })).error?.code).toBe("42501");
    // Changes need a comment.
    expect((await D.reviewDescription(await actionContext(USERS.comms), { event_id: eventId, decision: "changes_requested" })).ok).toBe(false);
    expect((await D.reviewDescription(await actionContext(USERS.comms), { event_id: eventId, decision: "changes_requested", comment: "Add the meeting point" })).ok).toBe(true);
    const { data } = await admin.from("descriptions").select("status").eq("event_id", eventId).single();
    expect(data!.status).toBe("changes_requested");
  });

  it("after changes the OC resubmits; Comms approves and publishes once, with @all", async () => {
    await (await as(USERS.oc)).rpc("save_description", { event: eventId, patch: { important: "Meet at the entrance" } });
    expect((await D.submitDescription(await actionContext(USERS.oc), { event_id: eventId })).ok).toBe(true);
    // Not approved yet: nothing to publish.
    expect((await D.publishDescription(await actionContext(USERS.comms), { event_id: eventId })).ok).toBe(false);
    expect((await D.reviewDescription(await actionContext(USERS.comms), { event_id: eventId, decision: "approved", comment: "Great" })).ok).toBe(true);
    expect(await D.publishDescription(await actionContext(USERS.oc), { event_id: eventId })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await D.publishDescription(await actionContext(USERS.comms), { event_id: eventId })).ok).toBe(true);
    // Clicking twice is harmless: one job.
    expect((await D.publishDescription(await actionContext(USERS.comms), { event_id: eventId })).ok).toBe(true);
    await runJobs();

    const { data: d } = await admin.from("descriptions").select("*").eq("event_id", eventId).single();
    expect(d).toMatchObject({ status: "published", approved_by: USERS.comms.email });
    const expected = postedTexts(renderDescription(coerceFields(d!.approved_fields)).chat).main;
    expect(d!.published_text).toBe(expected);
    expect(expected.endsWith("\n\n<users/all>")).toBe(true);
    const { data: msgs } = await admin.from("fake_chat_messages").select("name, text, edits").eq("name", d!.published_message_name!);
    expect(msgs).toEqual([{ name: d!.published_message_name, text: expected, edits: 0 }]);
    const { data: versions } = await admin.from("description_versions").select("kind").eq("event_id", eventId).order("id");
    expect(versions!.map((v) => v.kind)).toEqual(["submitted", "submitted", "approved", "published"]);
  });

  it("every member can read a published description (templates), not drafts of others", async () => {
    expect((await (await as(USERS.member)).from("descriptions").select("event_id").eq("event_id", eventId)).data).toHaveLength(1);
    await (await as(USERS.volunteer1)).rpc("save_description", { event: otherId, patch: { title: "Other draft" } });
    expect((await (await as(USERS.member)).from("descriptions").select("event_id").eq("event_id", otherId)).data).toEqual([]);
    // The helper of the quiz is not staff of the other event.
    expect((await (await as(USERS.helper)).from("descriptions").select("event_id").eq("event_id", otherId)).data).toEqual([]);
  });

  it("editing after publishing needs a new review; publishing again edits the same message", async () => {
    await (await as(USERS.oc)).rpc("save_description", { event: eventId, patch: { price: "6" } });
    let { data: d } = await admin.from("descriptions").select("status, published_message_name, published_text").eq("event_id", eventId).single();
    expect(d!.status).toBe("draft");
    const messageName = d!.published_message_name;
    expect((await D.submitDescription(await actionContext(USERS.oc), { event_id: eventId })).ok).toBe(true);
    expect((await D.reviewDescription(await actionContext(USERS.comms), { event_id: eventId, decision: "approved" })).ok).toBe(true);
    expect((await D.publishDescription(await actionContext(USERS.comms), { event_id: eventId })).ok).toBe(true);
    await runJobs();
    ({ data: d } = await admin.from("descriptions").select("status, published_message_name, published_text").eq("event_id", eventId).single());
    expect(d!.published_message_name).toBe(messageName);
    expect(d!.published_text).toContain("💸 € 6.00\n");
    const { data: msgs } = await admin.from("fake_chat_messages").select("text, edits").eq("name", messageName!);
    expect(msgs).toEqual([{ text: d!.published_text, edits: 1 }]);
  });

  it("the overview shows the month's deadline and late descriptions", async () => {
    const { data: cycle } = await admin.from("planning_cycles").insert({ month: `2${String(Math.floor(Math.random() * 900) + 100)}-0${1 + Math.floor(Math.random() * 9)}-01`, description_deadline: new Date(Date.now() - 86_400_000).toISOString() }).select().single();
    await admin.from("events").update({ cycle_id: cycle!.id }).eq("id", otherId);
    const { data } = await (await as(USERS.comms)).rpc("description_overview");
    const other = data!.find((r) => r.event_id === otherId)!;
    expect(other).toMatchObject({ status: "draft", late: true });
    expect(data!.find((r) => r.event_id === eventId)).toMatchObject({ status: "published", late: false });
    // A member who is not staff sees nothing of it.
    expect(((await (await as(USERS.member)).rpc("description_overview")).data ?? []).some((r) => r.event_id === otherId)).toBe(false);
    expect(other).toMatchObject({ cycle_id: cycle!.id, cycle_month: cycle!.month });
    expect(other).toMatchObject({ late: true, missed: false });
    // An event that happened without a published description is missed, not late:
    // nobody chases it any more (review 2026-10-29 A6, replacing C8's "late once started").
    const { data: before } = await admin.from("events").select("starts_at").eq("id", otherId).single();
    await admin.from("events").update({ starts_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", otherId);
    expect((await (await as(USERS.comms)).rpc("description_overview")).data!.find((r) => r.event_id === otherId)).toMatchObject({ late: false, missed: true });
    // Before the deadline and ahead: neither.
    await admin.from("planning_cycles").update({ description_deadline: new Date(Date.now() + 7 * 86_400_000).toISOString() }).eq("id", cycle!.id);
    await admin.from("events").update({ starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }).eq("id", otherId);
    expect((await (await as(USERS.comms)).rpc("description_overview")).data!.find((r) => r.event_id === otherId)).toMatchObject({ late: false, missed: false });
    // A published description is never missed.
    expect(data!.find((r) => r.event_id === eventId)).toMatchObject({ missed: false });
    await admin.from("events").update({ cycle_id: null, starts_at: before!.starts_at }).eq("id", otherId);
    await admin.from("planning_cycles").delete().eq("id", cycle!.id);
  });
});

describe("postedTexts", () => {
  it("adds @all to the message, or as its own message when the text is at the limit", () => {
    expect(postedTexts("Hi")).toEqual({ main: "Hi\n\n<users/all>", extra: null });
    const long = "x".repeat(4090);
    expect(postedTexts(long)).toEqual({ main: long, extra: "<users/all> ☝️ The description is up." });
  });
});
