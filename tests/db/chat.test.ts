// Chat spaces through the jobs queue (database-backed fake Chat client), and
// roster changes: dropouts, open slots, claiming.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle, createEvent, daysFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import { runDueJobs, type JobDeps } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";
import { MemoryChatClient, MemoryDirectoryClient, MemoryDriveClient } from "@/lib/google/fakes";
import * as R from "@/lib/actions/roster";

const deps: JobDeps = { admin, google: googleClients(admin, { GOOGLE_MODE: "fake" }), env: {}, baseUrl: "https://events.example" };
const runJobs = () => runDueJobs(deps, HANDLERS, { worker: "chat-test" });

async function space(eventId: string) {
  const { data: ev } = await admin.from("events").select("chat_space_name, chat_space_url, status").eq("id", eventId).single();
  const name = ev!.chat_space_name!;
  const [{ data: s }, { data: members }, { data: messages }] = await Promise.all([
    admin.from("fake_chat_spaces").select("*").eq("name", name).single(),
    admin.from("fake_chat_members").select("email").eq("space", name).order("email"),
    admin.from("fake_chat_messages").select("name, text, edits").eq("space", name).order("created_at"),
  ]);
  return { event: ev!, space: s!, members: members!.map((m) => m.email), messages: messages! };
}

describe("Chat spaces and roster changes", () => {
  let cycleId: string;
  let eventId: string;

  beforeAll(async () => {
    const cycle = await createCycle();
    cycleId = cycle.id;
    const ev = await createEvent({ title: "Karaoke night", cycle_id: cycleId, status: "scheduled", oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, starts_at: daysFromNow(14) });
    eventId = ev.id;
    // As if the allocation had run: allocated → confirm through the real function.
    await admin.from("planning_cycles").update({ status: "allocated" }).eq("id", cycleId);
  });
  afterAll(async () => {
    await admin.from("events").delete().eq("cycle_id", cycleId);
    await admin.from("planning_cycles").delete().eq("id", cycleId);
  });

  it("confirming the roster creates the space, invites OC, helpers, Comms and Events, and welcomes them", async () => {
    expect((await (await as(USERS.events)).rpc("confirm_allocation", { cycle: cycleId })).error).toBeNull();
    const { data: job } = await admin.from("jobs").select("status").eq("idempotency_key", `chat.create_space:${eventId}`).single();
    expect(job!.status).toBe("pending");

    const summary = await runJobs();
    expect(summary.failed).toBe(0);
    const s = await space(eventId);
    expect(s.event.chat_space_url).toMatch(/^https:\/\/chat\.google\.com\/room\//);
    expect(s.members).toEqual(["comms@esnmesa.org", "events@esnmesa.org", "helper@esnmesa.org", "oc@esnmesa.org"]);
    expect(s.space.display_name).toMatch(/^Karaoke night · /);
    expect(s.space.description).toMatch(/^📅 .* · OC: Olga Organiser$/);
    expect(s.space.description.length).toBeLessThanOrEqual(150);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].text).toContain("OC: <users/oc@esnmesa.org>");
    expect(s.messages[0].text).toContain("Helpers: <users/helper@esnmesa.org>");
    expect(s.messages[0].text).toContain(`https://events.example/events/${eventId}`);
  });

  it("creating again changes nothing (idempotent)", async () => {
    await admin.from("jobs").update({ status: "pending", run_after: new Date(Date.now() - 60_000).toISOString() }).eq("idempotency_key", `chat.create_space:${eventId}`);
    await runJobs();
    const s = await space(eventId);
    expect(s.messages).toHaveLength(1);
    const { count } = await admin.from("fake_chat_spaces").select("name", { count: "exact", head: true }).eq("request_id", `mesa-event-${eventId}`);
    expect(count).toBe(1);
  });

  it("nobody can drop someone else out", async () => {
    const { data: a } = await admin.from("assignments").select("id").eq("event_id", eventId).eq("profile_id", USERS.helper.id).single();
    expect(await R.dropOut(await actionContext(USERS.member), { assignment_id: a!.id })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await R.dropOut(await actionContext(USERS.oc), { assignment_id: a!.id })).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("a helper drops out: slot opens for everyone, space and OC are told", async () => {
    const { data: a } = await admin.from("assignments").select("id").eq("event_id", eventId).eq("profile_id", USERS.helper.id).single();
    expect((await R.dropOut(await actionContext(USERS.helper), { assignment_id: a!.id, reason: "Exam" })).ok).toBe(true);

    const { data: ev } = await admin.from("events").select("status").eq("id", eventId).single();
    expect(ev!.status).toBe("understaffed");
    const { data: slots } = await (await as(USERS.member)).rpc("open_slots");
    expect(slots!.find((s) => s.event_id === eventId)).toEqual({ event_id: eventId, open_oc: false, open_helpers: 1 });

    await runJobs();
    const s = await space(eventId);
    expect(s.members).not.toContain("helper@esnmesa.org");
    expect(s.messages.at(-1)!.text).toMatch(/^⚠️ Hugo Helper dropped out as helper of \*Karaoke night\*\. .*<users\/oc@esnmesa\.org>$/);
    const { data: dm } = await admin.from("fake_chat_messages").select("text").eq("space", "dm:oc@esnmesa.org");
    expect(dm!.some((m) => m.text.includes("Hugo Helper dropped out"))).toBe(true);
  });

  it("staff cannot claim twice; any other member can claim the slot", async () => {
    expect(await R.claimSlot(await actionContext(USERS.oc), { event_id: eventId, role: "helper" })).toMatchObject({ ok: false });
    expect(await R.claimSlot(await actionContext(USERS.member), { event_id: eventId, role: "oc" })).toMatchObject({ ok: false });
    expect((await R.claimSlot(await actionContext(USERS.member), { event_id: eventId, role: "helper" })).ok).toBe(true);
    // The slot is gone now.
    expect(await R.claimSlot(await actionContext(USERS.volunteer1), { event_id: eventId, role: "helper" })).toMatchObject({ ok: false });

    const { data: ev } = await admin.from("events").select("status").eq("id", eventId).single();
    expect(ev!.status).toBe("confirmed");
    await runJobs();
    const s = await space(eventId);
    expect(s.members).toContain("member@esnmesa.org");
    expect(s.messages.at(-1)!.text).toBe("✅ Mia Member took the open helper slot of *Karaoke night*. <users/oc@esnmesa.org>");
    const { data: a } = await admin.from("assignments").select("source").eq("event_id", eventId).eq("profile_id", USERS.member.id).single();
    expect(a!.source).toBe("replacement");
  });

  it("the OC dropping out opens the OC slot; the claimer becomes OC", async () => {
    const { data: a } = await admin.from("assignments").select("id").eq("event_id", eventId).eq("profile_id", USERS.oc.id).single();
    expect((await R.dropOut(await actionContext(USERS.oc), { assignment_id: a!.id })).ok).toBe(true);
    expect((await R.claimSlot(await actionContext(USERS.volunteer1), { event_id: eventId, role: "oc" })).ok).toBe(true);
    expect((await (await as(USERS.volunteer1)).rpc("is_event_oc", { event: eventId })).data).toBe(true);
    await runJobs();
    const s = await space(eventId);
    expect(s.members).toEqual(["comms@esnmesa.org", "events@esnmesa.org", "member@esnmesa.org", "volunteer1@esnmesa.org"]);
    expect(s.space.description).toContain("OC: Vera Volunteer");
  });

  it("a new Comms member is added to upcoming spaces", async () => {
    await admin.from("role_members").insert({ email: "volunteer2@esnmesa.org", role: "comms", source: "manual" });
    await runJobs();
    expect((await space(eventId)).members).toContain("volunteer2@esnmesa.org");
    await admin.from("role_members").delete().eq("email", "volunteer2@esnmesa.org").eq("role", "comms");
    await runJobs();
    expect((await space(eventId)).members).not.toContain("volunteer2@esnmesa.org");
  });

  it("only Events creates a space by hand", async () => {
    const other = await createEvent({ title: "Ad hoc", starts_at: daysFromNow(20) });
    expect(await R.requestChatSpace(await actionContext(USERS.oc), { event_id: other.id })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.member)).rpc("request_chat_space", { event: other.id })).error?.code).toBe("42501");
    expect((await R.requestChatSpace(await actionContext(USERS.events), { event_id: other.id })).ok).toBe(true);
    await runJobs();
    const { data } = await admin.from("events").select("chat_space_name").eq("id", other.id).single();
    expect(data!.chat_space_name).toMatch(/^spaces\/FAKE/);
    await admin.from("events").delete().eq("id", other.id);
  });
});

describe("job retries with a failing Chat API", () => {
  it("fails, backs off, then succeeds without duplicates", async () => {
    const ev = await createEvent({ title: "Flaky", oc: USERS.oc, starts_at: daysFromNow(30) });
    const chat = new MemoryChatClient();
    const flaky: JobDeps = { ...deps, google: { mode: "fake", chat, drive: new MemoryDriveClient(), directory: new MemoryDirectoryClient() } };
    await (await as(USERS.events)).rpc("request_chat_space", { event: ev.id });

    chat.failNext = 2; // createSpace succeeds? no: fails on the first call
    await runDueJobs(flaky, HANDLERS, { worker: "flaky" });
    let { data: job } = await admin.from("jobs").select("status, attempts, last_error").eq("idempotency_key", `chat.create_space:${ev.id}`).single();
    expect(job).toMatchObject({ status: "failed", attempts: 1, last_error: "Fake Chat API failure" });

    await admin.from("jobs").update({ run_after: new Date(Date.now() - 3_600_000).toISOString() }).eq("idempotency_key", `chat.create_space:${ev.id}`);
    await runDueJobs(flaky, HANDLERS, { worker: "flaky" }); // fails again (second failure)
    await admin.from("jobs").update({ run_after: new Date(Date.now() - 3_600_000).toISOString() }).eq("idempotency_key", `chat.create_space:${ev.id}`);
    await runDueJobs(flaky, HANDLERS, { worker: "flaky" });
    ({ data: job } = await admin.from("jobs").select("status, attempts").eq("idempotency_key", `chat.create_space:${ev.id}`).single());
    expect(job).toMatchObject({ status: "done", attempts: 3 });
    expect(chat.spaces.size).toBe(1);
    expect([...chat.messages.values()].filter((m) => m.text.startsWith("👋"))).toHaveLength(1);
    await admin.from("events").delete().eq("id", ev.id);
  });
});
