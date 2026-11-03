// The Events team decides cancellations (round 2026-11-03): the OC asks
// with a reason, the Events team cancels or keeps the event on (with a note),
// the OC can withdraw; a description Comms sent back has 4 days to come
// back, else the event is cancelled like one never sent.
import { afterAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle, createEvent, daysFromNow } from "../helpers/local";

const events: string[] = [];
const cycles: string[] = [];
afterAll(async () => {
  await admin.from("jobs").delete().in("event_id", events);
  await admin.from("events").delete().in("id", events);
  await admin.from("planning_cycles").delete().in("id", cycles);
});

async function event(extra: Parameters<typeof createEvent>[0] = {}) {
  const e = await createEvent({ oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, starts_at: daysFromNow(10), ...extra });
  events.push(e.id);
  return e;
}

describe("cancellation requests", () => {
  it("only the OC asks, with a reason, one at a time; the Events team is told in Chat", async () => {
    const e = await event();
    const oc = await as(USERS.oc);
    expect((await (await as(USERS.helper)).rpc("request_cancellation", { event: e.id, reason: "No" })).error?.code).toBe("42501");
    expect((await oc.rpc("request_cancellation", { event: e.id, reason: " " })).error?.code).toBe("22023");
    const { data: id, error } = await oc.rpc("request_cancellation", { event: e.id, reason: "Venue closed" });
    expect(error).toBeNull();
    expect((await oc.rpc("request_cancellation", { event: e.id, reason: "Again" })).error?.message).toMatch(/already has a request/);
    const { data: jobs } = await admin.from("jobs").select("kind, payload").eq("event_id", e.id).eq("kind", "chat.cancellation");
    expect(jobs).toEqual([{ kind: "chat.cancellation", payload: { request_id: id, kind: "requested" } }]);
    // The event runs until the Events team decides.
    expect((await admin.from("events").select("status").eq("id", e.id).single()).data?.status).toBe("confirmed");
  });

  it("the Events team keeps it on only with a note for the OC, or cancels it", async () => {
    const e = await event();
    const { data: id } = await (await as(USERS.oc)).rpc("request_cancellation", { event: e.id, reason: "Rain" });
    const events = await as(USERS.events);
    expect((await (await as(USERS.oc)).rpc("decide_cancellation", { request: id!, decision: "cancelled" })).error?.code).toBe("42501");
    expect((await events.rpc("decide_cancellation", { request: id!, decision: "declined" })).error?.message).toMatch(/why the event stays on/);
    expect((await events.rpc("decide_cancellation", { request: id!, decision: "declined", note: "Indoor plan B" })).error).toBeNull();
    expect((await admin.from("events").select("status").eq("id", e.id).single()).data?.status).toBe("confirmed");

    const { data: again } = await (await as(USERS.oc)).rpc("request_cancellation", { event: e.id, reason: "Storm warning" });
    expect((await events.rpc("decide_cancellation", { request: again!, decision: "cancelled" })).error).toBeNull();
    const { data: ev } = await admin.from("events").select("status, cancel_reason").eq("id", e.id).single();
    expect(ev).toEqual({ status: "cancelled", cancel_reason: "Storm warning" });
  });

  it("the OC withdraws; cancelling another way settles an open request", async () => {
    const e = await event();
    const oc = await as(USERS.oc);
    const { data: first } = await oc.rpc("request_cancellation", { event: e.id, reason: "Maybe" });
    expect((await oc.rpc("decide_cancellation", { request: first!, decision: "withdrawn" })).error).toBeNull();
    const { data: second } = await oc.rpc("request_cancellation", { event: e.id, reason: "Surely" });
    expect((await (await as(USERS.events)).rpc("cancel_event", { event: e.id, reason: "Decided ourselves" })).error).toBeNull();
    const { data: r } = await admin.from("cancellation_requests").select("decision").eq("id", second!).single();
    expect(r?.decision).toBe("cancelled");
    // The OC cannot cancel directly, not even an under-staffed event.
    const short = await event({ helpers: [], helpers_needed: 2, status: "understaffed" });
    expect((await oc.rpc("decide_understaffed", { event: short.id, decision: "cancel" })).error?.code).toBe("42501");
  });
});

describe("a description sent back", () => {
  it("has 4 days to come back after the deadline passed, else the event is cancelled", async () => {
    const cycle = await createCycle({ status: "confirmed", description_deadline: daysFromNow(-1) });
    cycles.push(cycle.id);
    const recent = await event({ cycle_id: cycle.id });
    const old = await event({ cycle_id: cycle.id });
    for (const [e, ago] of [[recent, 1], [old, 5]] as const) {
      await admin.from("descriptions").upsert({ event_id: e.id, status: "changes_requested", submitted_at: daysFromNow(-ago - 1) });
      await admin.from("reviews").insert({ event_id: e.id, reviewer: USERS.comms.email, decision: "changes_requested", comment: "Add the price", version: 1, created_at: daysFromNow(-ago) });
    }
    const { data: due } = await (await as(USERS.events)).rpc("description_due", { events: [recent.id] });
    expect(due?.[0]).toMatchObject({ sent_back: true });
    expect(Date.parse(due![0].due_at!)).toBeGreaterThan(Date.now());

    await admin.rpc("cancel_overdue_descriptions");
    const { data: rows } = await admin.from("events").select("id, status, cancel_reason, cancelled_by").in("id", [recent.id, old.id]);
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    expect(byId.get(recent.id)?.status).toBe("confirmed");
    expect(byId.get(old.id)).toMatchObject({ status: "cancelled", cancel_reason: "Description not sent again in time after Comms asked for changes", cancelled_by: "description deadline" });
  });
});
