// Automatic reminders to the OC (round 2026-11-03): send_oc_reminders()
// reminds of the description from N days before the deadline and of the
// hand-in from N days after the event, at most once a Berlin day per event
// and topic, between 10:00 and 20:00, as app_settings.oc_reminders says –
// in the space mentioning the OC, or as a direct message without a space.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle, createEvent } from "../helpers/local";
import { runDueJobs } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";

const deps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "http://mesa.test" };
const space = `spaces/FAKEREMIND${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const DAY = 86_400_000;
/** Noon in Berlin (11:00 UTC in winter, 10:00 in summer: both inside 10–20). */
const noon = (iso: string) => `${iso.slice(0, 10)}T11:00:00Z`;
const today = noon(new Date().toISOString());

let cycleId: string;
let deadline: string;
let ahead: string;
let past: string;
let original: unknown;

const jobs = async (event: string) => (await admin.from("jobs").select("payload, idempotency_key").eq("event_id", event).eq("kind", "chat.remind_oc")).data ?? [];
const send = async (at: string) => (await admin.rpc("send_oc_reminders", { at })).error;

beforeAll(async () => {
  original = (await admin.from("app_settings").select("value").eq("key", "oc_reminders").single()).data?.value;
  const cycle = await createCycle({ status: "confirmed" });
  cycleId = cycle.id;
  // The deadline on the 20th of the test month, the event after it.
  deadline = `${cycle.month.slice(0, 8)}20T22:59:00Z`;
  await admin.from("planning_cycles").update({ description_deadline: deadline }).eq("id", cycleId);
  ahead = (await createEvent({ title: "Remind ahead", cycle_id: cycleId, starts_at: `${cycle.month.slice(0, 8)}25T18:00:00Z`, oc: USERS.oc })).id;
  await admin.from("events").update({ chat_space_name: space }).eq("id", ahead);
  past = (await createEvent({ title: "Remind past", starts_at: new Date(Date.parse(today) - 2 * DAY).toISOString(), oc: USERS.oc })).id;
});
afterAll(async () => {
  await admin.from("app_settings").update({ value: original as never }).eq("key", "oc_reminders");
  await admin.from("fake_chat_messages").delete().eq("space", space);
  await admin.from("fake_chat_messages").delete().eq("space", `dm:${USERS.oc.email}`).like("text", "%Remind past%");
  await admin.from("jobs").delete().in("event_id", [ahead, past]);
  await admin.from("events").delete().in("id", [ahead, past]);
  await admin.from("planning_cycles").delete().eq("id", cycleId);
});

describe("automatic reminders to the OC", () => {
  it("the description: from 3 days before the deadline, once a day, only by day", async () => {
    await send(noon(new Date(Date.parse(deadline) - 5 * DAY).toISOString()));
    expect(await jobs(ahead)).toHaveLength(0);
    const twoBefore = noon(new Date(Date.parse(deadline) - 2 * DAY).toISOString());
    expect(await send(twoBefore)).toBeNull();
    await send(twoBefore);
    expect(await jobs(ahead)).toEqual([{ payload: { event_id: ahead, about: "description" }, idempotency_key: `chat.remind_oc:description:${ahead}:${twoBefore.slice(0, 10)}` }]);
    // At night: nothing.
    expect((await admin.rpc("send_oc_reminders", { at: `${deadline.slice(0, 10)}T03:00:00Z` })).data).toBe(0);
    // The Events team sees when, in the log.
    const { data: log } = await (await as(USERS.events)).from("activity_log").select("details").eq("event_id", ahead).eq("action", "remind");
    expect(log).toEqual([{ details: { reminded: "description", automatic: true } }]);
    // In the space, mentioning the OC, with the due date and what happens after it.
    await runDueJobs(deps, HANDLERS, { worker: "remind-test" });
    const { data: inSpace } = await admin.from("fake_chat_messages").select("text").eq("space", space);
    expect(inSpace![0].text).toContain(`✍️ <users/${USERS.oc.email}> A reminder: please write the description of *Remind ahead* – due `);
    expect(inSpace![0].text).toContain("otherwise the event is cancelled");
  });

  it("stops once the description is in", async () => {
    await admin.from("descriptions").upsert({ event_id: ahead, status: "submitted" });
    await send(noon(new Date(Date.parse(deadline) - 1 * DAY).toISOString()));
    expect(await jobs(ahead)).toHaveLength(1);
  });

  it("the hand-in: names what is missing, in a direct message without a space", async () => {
    await send(today);
    expect((await jobs(past)).map((j) => j.payload)).toEqual([{ event_id: past, about: "handin" }]);
    await runDueJobs(deps, HANDLERS, { worker: "remind-test" });
    const { data: dm } = await admin.from("fake_chat_messages").select("text").eq("space", `dm:${USERS.oc.email}`).like("text", "%Remind past%");
    expect(dm).toHaveLength(1);
    expect(dm![0].text).toContain("the hand-in of *Remind past* is still missing the signed-off attendance list, the photos and the event report");
    expect(dm![0].text).toContain(`http://mesa.test/events/${past}/hand-in`);
  });

  it("follows the admin's setting: 0 days switches a reminder off; nonsense is refused", async () => {
    await admin.from("jobs").delete().eq("event_id", past);
    await admin.from("app_settings").update({ value: { description_days_before: 3, description_every_days: 1, handin_days_after: 0, handin_every_days: 3, handin_max: 3 } }).eq("key", "oc_reminders");
    await send(today);
    expect(await jobs(past)).toHaveLength(0);
    const { error } = await admin.from("app_settings").update({ value: { description_days_before: 30, description_every_days: 1, handin_days_after: 1, handin_every_days: 3, handin_max: 3 } }).eq("key", "oc_reminders");
    expect(error?.code).toBe("22023");
  });
});
