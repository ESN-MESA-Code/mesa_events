// "Remind OC" on the Comms page (brief 2026-10-29, C): Comms and Events
// only, once per event, topic and day, through the jobs queue – in the
// space mentioning the OC, or as a direct message without a space.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as D from "@/lib/actions/descriptions";
import { runDueJobs } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";

const deps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "http://mesa.test" };
const space = `spaces/FAKEREMIND${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
let ahead: string;
let past: string;

beforeAll(async () => {
  ahead = (await createEvent({ title: "Remind ahead", starts_at: hoursFromNow(72), oc: USERS.oc })).id;
  past = (await createEvent({ title: "Remind past", starts_at: hoursFromNow(-30), oc: USERS.oc })).id;
  await admin.from("events").update({ chat_space_name: space }).eq("id", ahead);
});
afterAll(async () => {
  await admin.from("fake_chat_messages").delete().eq("space", space);
  await admin.from("fake_chat_messages").delete().eq("space", `dm:${USERS.oc.email}`).like("text", "%Remind past%");
  await admin.from("jobs").delete().in("event_id", [ahead, past]);
  await admin.from("events").delete().in("id", [ahead, past]);
});

describe("Remind OC", () => {
  it("only Comms and Events; once a day per event and topic", async () => {
    expect(await D.remindOc(await actionContext(USERS.oc), { event_id: ahead, about: "description" })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.finance)).rpc("remind_oc", { event: ahead, about: "description" })).error?.code).toBe("42501");
    expect(await D.remindOc(await actionContext(USERS.comms), { event_id: ahead, about: "description" })).toEqual({ ok: true, data: { sent: true } });
    expect(await D.remindOc(await actionContext(USERS.events), { event_id: ahead, about: "description" })).toEqual({ ok: true, data: { sent: false } });
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("event_id", ahead).eq("kind", "chat.remind_oc");
    expect(count).toBe(1);
    const { data: log } = await (await as(USERS.events)).from("activity_log").select("details").eq("event_id", ahead).eq("action", "remind");
    expect(log).toEqual([{ details: { reminded: "description" } }]);
  });

  it("refuses what is not due: a report before the event, a description already in", async () => {
    expect(await D.remindOc(await actionContext(USERS.comms), { event_id: ahead, about: "report" })).toMatchObject({ ok: false, message: "No report is due" });
    await admin.from("descriptions").upsert({ event_id: past, status: "submitted" });
    expect(await D.remindOc(await actionContext(USERS.comms), { event_id: past, about: "description" })).toMatchObject({ ok: false, message: "The description is already in" });
  });

  it("posts in the space mentioning the OC, or sends the OC a direct message", async () => {
    expect((await D.remindOc(await actionContext(USERS.comms), { event_id: past, about: "report" })).ok).toBe(true);
    await runDueJobs(deps, HANDLERS, { worker: "remind-test" });
    const { data: inSpace } = await admin.from("fake_chat_messages").select("text").eq("space", space);
    expect(inSpace).toHaveLength(1);
    expect(inSpace![0].text).toContain(`✍️ <users/${USERS.oc.email}> A reminder from Comms: please write the description of *Remind ahead*`);
    expect(inSpace![0].text).toContain(`http://mesa.test/events/${ahead}/description`);
    const { data: dm } = await admin.from("fake_chat_messages").select("text").eq("space", `dm:${USERS.oc.email}`).like("text", "%Remind past%");
    expect(dm).toHaveLength(1);
    expect(dm![0].text).toContain("please fill in the short event report of *Remind past*");
  });
});
