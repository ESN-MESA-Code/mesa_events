// Chat spaces through the jobs queue (database-backed fake Chat client), and
// roster changes: dropouts, open slots, claiming.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle, createEvent, daysFromNow, type SeedUser } from "../helpers/local";
import { actionContext } from "./actionContext";
import { runDueJobs, type JobDeps } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/handlers";
import { googleClients } from "@/lib/google";
import { MemoryChatClient, MemoryDirectoryClient, MemoryDriveClient } from "@/lib/google/fakes";
import * as R from "@/lib/actions/roster";
import * as P from "@/lib/actions/planning";
import * as D from "@/lib/actions/descriptions";

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
  // The staging demo's team members (seed:staging on the local stack) are invited too: only the test accounts count here.
  return { event: ev!, space: s!, members: members!.map((m) => m.email).filter((e) => !e.endsWith(".demo@esnmesa.org")), messages: messages! };
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

  it("the drop-out reason: the event's OC and the Events team only, not in the roster or the log", async () => {
    const { data: a } = await admin.from("assignments").select("id").eq("event_id", eventId).eq("profile_id", USERS.helper.id).single();
    const reasonFor = async (u: SeedUser) => (await (await as(u)).from("assignment_drop_reasons").select("reason").eq("assignment_id", a!.id)).data ?? [];
    expect(await reasonFor(USERS.oc)).toEqual([{ reason: "Exam" }]);
    expect(await reasonFor(USERS.events)).toEqual([{ reason: "Exam" }]);
    for (const u of [USERS.member, USERS.helper, USERS.volunteer1, USERS.comms, USERS.finance, USERS.executive, USERS.admin]) expect(await reasonFor(u), u.email).toEqual([]);
    // The roster row has no reason any more, and the log never sees it.
    const { data: row } = await (await as(USERS.member)).from("assignments").select("*").eq("id", a!.id).single();
    expect(row).not.toHaveProperty("drop_reason");
    const { data: log } = await admin.from("activity_log").select("details").eq("entity", "assignments").eq("entity_id", a!.id).eq("action", "update");
    expect(JSON.stringify(log)).not.toContain("Exam");
    expect(log!.length).toBeGreaterThan(0);
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

describe("the OC's decision on an under-staffed event (review 2026-10-29 A1)", () => {
  let eventId: string;
  const status = async () => (await admin.from("events").select("status, understaffed_decision, understaffed_decided_by").eq("id", eventId).single()).data!;
  const assignmentOf = async (u: SeedUser) => (await admin.from("assignments").select("id").eq("event_id", eventId).eq("profile_id", u.id).eq("status", "active").single()).data!.id;

  beforeAll(async () => {
    const ev = await createEvent({ title: "Short-handed quiz", oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 3, starts_at: daysFromNow(12) });
    eventId = ev.id;
  });
  afterAll(async () => {
    await admin.from("events").delete().eq("id", eventId);
  });

  it("a short roster makes the event under-staffed; only the OC or Events decide, through the function", async () => {
    expect(await status()).toMatchObject({ status: "understaffed", understaffed_decision: null });
    expect((await (await as(USERS.helper)).rpc("decide_understaffed", { event: eventId, decision: "run" })).error?.code).toBe("42501");
    // Neither the status nor the decision can be written directly.
    await (await as(USERS.oc)).from("events").update({ status: "confirmed" }).eq("id", eventId);
    await (await as(USERS.events)).from("events").update({ understaffed_decision: "run" }).eq("id", eventId);
    expect(await status()).toMatchObject({ status: "understaffed", understaffed_decision: null });
  });

  it("decide run → a helper claims (still short) → stays confirmed, nobody is asked again", async () => {
    expect((await R.decideUnderstaffed(await actionContext(USERS.oc), { event_id: eventId, decision: "run" })).ok).toBe(true);
    expect(await status()).toEqual({ status: "confirmed", understaffed_decision: "run", understaffed_decided_by: USERS.oc.email });
    // Still one helper short after the claim: before, this set it back to under-staffed.
    expect((await R.claimSlot(await actionContext(USERS.member), { event_id: eventId, role: "helper" })).ok).toBe(true);
    expect(await status()).toMatchObject({ status: "confirmed", understaffed_decision: "run" });
    // A helper dropping out does not undo it either.
    expect((await R.dropOut(await actionContext(USERS.member), { assignment_id: await assignmentOf(USERS.member) })).ok).toBe(true);
    expect(await status()).toMatchObject({ status: "confirmed", understaffed_decision: "run" });
    // Confirmed events need no decision.
    expect(await R.decideUnderstaffed(await actionContext(USERS.oc), { event_id: eventId, decision: "cancel" })).toMatchObject({ ok: false });
  });

  it("the OC drops out → under-staffed again, the decision is cleared; the new OC decides again", async () => {
    expect((await R.dropOut(await actionContext(USERS.oc), { assignment_id: await assignmentOf(USERS.oc) })).ok).toBe(true);
    expect(await status()).toEqual({ status: "understaffed", understaffed_decision: null, understaffed_decided_by: null });
    // Without an OC it cannot be "run"; the Events team can cancel it, or someone takes the OC slot.
    expect((await (await as(USERS.events)).rpc("decide_understaffed", { event: eventId, decision: "run" })).error?.message).toMatch(/needs an OC/);
    expect((await R.claimSlot(await actionContext(USERS.volunteer1), { event_id: eventId, role: "oc" })).ok).toBe(true);
    expect(await status()).toMatchObject({ status: "understaffed", understaffed_decision: null });
    expect((await R.decideUnderstaffed(await actionContext(USERS.volunteer1), { event_id: eventId, decision: "run" })).ok).toBe(true);
    expect(await status()).toEqual({ status: "confirmed", understaffed_decision: "run", understaffed_decided_by: USERS.volunteer1.email });
  });

  it("the Events team swapping the OC on the roster clears the decision too", async () => {
    const ctx = await actionContext(USERS.events);
    const { data: ev } = await admin.from("events").select("cycle_id").eq("id", eventId).single();
    expect(ev!.cycle_id).toBeNull();
    // Events outside a cycle are adjustable on the roster board.
    expect((await P.assign(ctx, { event_id: eventId, profile_id: USERS.volunteer2.id, role: "oc" })).ok).toBe(true);
    expect(await status()).toMatchObject({ understaffed_decision: null });
    // Vera is a helper now: 2 of 3, still short.
    expect((await status()).status).toBe("understaffed");
  });
});

describe("cancelling and reopening (review 2026-10-29 A2)", () => {
  let eventId: string;
  const jobs = async () => (await admin.from("jobs").select("idempotency_key, payload").eq("event_id", eventId).eq("kind", "chat.event_status").order("id")).data!;
  const ev = async () => (await admin.from("events").select("status, cancelled_by, cancel_reason, chat_space_name").eq("id", eventId).single()).data!;

  beforeAll(async () => {
    const e = await createEvent({ title: "Rooftop cinema", oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, starts_at: daysFromNow(15) });
    eventId = e.id;
    await (await as(USERS.events)).rpc("request_chat_space", { event: eventId });
    await runJobs();
  });
  afterAll(async () => {
    await admin.from("events").delete().eq("id", eventId);
  });

  it("only the Events team cancels a running event, not by writing the status", async () => {
    for (const u of [USERS.oc, USERS.helper, USERS.member, USERS.comms]) {
      expect((await (await as(u)).rpc("cancel_event", { event: eventId })).error?.code, u.email).toBe("42501");
    }
    expect(await R.cancelEvent(await actionContext(USERS.oc), { event_id: eventId })).toMatchObject({ ok: false, error: "forbidden" });
    await (await as(USERS.events)).from("events").update({ status: "cancelled" }).eq("id", eventId);
    expect((await ev()).status).toBe("confirmed");
    expect(await jobs()).toEqual([]);
  });

  it("cancelling enqueues one Chat message, which mentions OC and helpers in the space", async () => {
    expect((await R.cancelEvent(await actionContext(USERS.events), { event_id: eventId, reason: "Storm warning" })).ok).toBe(true);
    expect(await ev()).toMatchObject({ status: "cancelled", cancelled_by: USERS.events.email, cancel_reason: "Storm warning" });
    // A second cancel is refused and enqueues nothing.
    expect(await R.cancelEvent(await actionContext(USERS.events), { event_id: eventId })).toMatchObject({ ok: false });
    expect(await jobs()).toHaveLength(1);
    expect((await jobs())[0].idempotency_key.startsWith(`chat.event_status:cancelled:${eventId}:`)).toBe(true);

    await runJobs();
    await runJobs();
    const { data: messages } = await admin.from("fake_chat_messages").select("text").eq("space", (await ev()).chat_space_name!).like("text", "🚫%");
    expect(messages).toHaveLength(1);
    expect(messages![0].text).toContain("*Rooftop cinema*");
    expect(messages![0].text).toContain("is cancelled. Reason: Storm warning");
    expect(messages![0].text).toContain("stay valid");
    expect(messages![0].text).toContain("<users/oc@esnmesa.org>");
    expect(messages![0].text).toContain("<users/helper@esnmesa.org>");
    // The log shows who cancelled.
    const { data: log } = await admin.from("activity_log").select("actor_email, details").eq("entity", "events").eq("entity_id", eventId).order("id", { ascending: false }).limit(1).single();
    expect(log).toMatchObject({ actor_email: USERS.events.email, details: { status: "cancelled" } });
  });

  it("Comms sees it when the description was published, and marks it handled", async () => {
    await admin.from("descriptions").upsert({ event_id: eventId, status: "published", published_at: new Date().toISOString() });
    const list = async () =>
      (await (await as(USERS.comms)).from("events").select("id, descriptions!inner(published_at)").eq("status", "cancelled").is("cancellation_noted_at", null).not("descriptions.published_at", "is", null)).data!.map((e) => e.id);
    expect(await list()).toContain(eventId);
    expect((await (await as(USERS.events)).rpc("note_cancellation", { event: eventId })).error?.code).toBe("42501");
    expect((await D.noteCancellation(await actionContext(USERS.comms), { event_id: eventId })).ok).toBe(true);
    expect(await list()).not.toContain(eventId);
  });

  it("only the Events team reopens; the event goes back to its staffing status and the space is told", async () => {
    for (const u of [USERS.oc, USERS.comms, USERS.member]) {
      expect((await (await as(u)).rpc("reopen_event", { event: eventId })).error?.code, u.email).toBe("42501");
    }
    expect(await R.reopenEvent(await actionContext(USERS.oc), { event_id: eventId })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await R.reopenEvent(await actionContext(USERS.events), { event_id: eventId })).toEqual({ ok: true, data: { status: "confirmed" } });
    expect(await ev()).toMatchObject({ status: "confirmed", cancelled_by: null, cancel_reason: null });
    expect(await R.reopenEvent(await actionContext(USERS.events), { event_id: eventId })).toMatchObject({ ok: false });
    await runJobs();
    const { data: messages } = await admin.from("fake_chat_messages").select("text").eq("space", (await ev()).chat_space_name!).like("text", "✅%back on%");
    expect(messages).toHaveLength(1);
    // A second cancellation is a new message.
    expect((await R.cancelEvent(await actionContext(USERS.events), { event_id: eventId })).ok).toBe(true);
    expect(await jobs()).toHaveLength(3);
    await runJobs();
    const { count } = await admin.from("fake_chat_messages").select("name", { count: "exact", head: true }).eq("space", (await ev()).chat_space_name!).like("text", "🚫%");
    expect(count).toBe(2);
  });

  it("the OC cancels an under-staffed event; without a space, OC and helpers get direct messages", async () => {
    const e = await createEvent({ title: `No space ${Math.random().toString(36).slice(2, 7)}`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 3, starts_at: daysFromNow(16) });
    try {
      expect((await admin.from("events").select("status").eq("id", e.id).single()).data!.status).toBe("understaffed");
      expect((await (await as(USERS.oc)).rpc("cancel_event", { event: e.id })).error?.code).toBe("42501");
      expect((await R.decideUnderstaffed(await actionContext(USERS.oc), { event_id: e.id, decision: "cancel" })).ok).toBe(true);
      expect((await admin.from("events").select("status, cancel_reason").eq("id", e.id).single()).data).toEqual({ status: "cancelled", cancel_reason: "Not enough people" });
      await runJobs();
      for (const email of ["oc@esnmesa.org", "helper@esnmesa.org"]) {
        const { data } = await admin.from("fake_chat_messages").select("text").eq("space", `dm:${email}`).like("text", `%${e.title}%is cancelled%`);
        expect(data, email).toHaveLength(1);
      }
    } finally {
      await admin.from("events").delete().eq("id", e.id);
    }
  });
});
