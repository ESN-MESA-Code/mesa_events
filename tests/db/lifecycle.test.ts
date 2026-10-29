// An event's and a cycle's life after the roster (review 2026-10-29):
// events become "completed" once they ended (A3), and deadlines must lie
// before the cycle's events (A5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, createEvent, daysFromNow, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as A from "@/lib/actions/attendance";
import * as H from "@/lib/actions/handin";
import * as D from "@/lib/actions/descriptions";
import * as P from "@/lib/actions/planning";

describe("past events become completed (A3)", () => {
  const ids: Record<string, string> = {};
  const statusOf = async (key: string) => (await admin.from("events").select("status").eq("id", ids[key]).single()).data!.status;

  beforeAll(async () => {
    const make = async (key: string, setup: Parameters<typeof createEvent>[0]) => {
      ids[key] = (await createEvent({ title: `Lifecycle ${key}`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, ...setup })).id;
    };
    await make("ended", { starts_at: daysFromNow(-2), ends_at: daysFromNow(-2 + 0.2) });
    await make("startedToday", { starts_at: hoursFromNow(-2) });
    await make("dayAfter", { starts_at: hoursFromNow(-25) });
    await make("short", { starts_at: daysFromNow(-3), helpers_needed: 3 });
    await make("trip", { starts_at: daysFromNow(-2), ends_at: daysFromNow(1) });
    await make("cancelled", { starts_at: daysFromNow(-5), status: "cancelled" });
    await make("ahead", { starts_at: daysFromNow(3) });
  });
  afterAll(async () => {
    await admin.from("reimbursements").delete().in("event_id", Object.values(ids));
    await admin.from("receipts").delete().in("event_id", Object.values(ids));
    await admin.from("events").delete().in("id", Object.values(ids));
  });

  it("the scheduled job marks ended confirmed and under-staffed events completed, nothing else", async () => {
    expect(await statusOf("short")).toBe("understaffed");
    const { data: n, error } = await admin.rpc("complete_past_events");
    expect(error).toBeNull();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(await statusOf("ended")).toBe("completed");
    expect(await statusOf("dayAfter")).toBe("completed");
    expect(await statusOf("short")).toBe("completed");
    // Started today, no end: runs for a day. A trip runs until its end.
    expect(await statusOf("startedToday")).toBe("confirmed");
    expect(await statusOf("trip")).toBe("confirmed");
    expect(await statusOf("cancelled")).toBe("cancelled");
    expect(await statusOf("ahead")).toBe("confirmed");
    // Members cannot run it (pg_cron does, every 15 minutes).
    expect((await (await actionContext(USERS.events)).supabase.rpc("complete_past_events")).error).not.toBeNull();
  });

  it("completed events keep their hand-in: attendance sign-off, receipts, the overview", async () => {
    expect((await A.signOffList(await actionContext(USERS.oc), { event_id: ids.ended, headcount: 9 })).ok).toBe(true);
    const r = await H.registerReceipt(await actionContext(USERS.helper), {
      event_id: ids.ended,
      kind: "ticket",
      vendor: "Lifecycle box office",
      amount_cents: 1000,
      purchased_on: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const { data } = await (await actionContext(USERS.oc)).supabase.rpc("event_claims_summary", { event: ids.ended });
    expect(data).toMatchObject({ receipts: 1, belege_missing: 1 });
    const { data: overview } = await (await actionContext(USERS.comms)).supabase.rpc("description_overview");
    expect(overview!.some((o) => o.event_id === ids.ended)).toBe(true);
    // Nobody can drop out or claim a slot any more.
    const { data: slots } = await (await actionContext(USERS.member)).supabase.rpc("open_slots");
    expect(slots!.some((s) => s.event_id === ids.short)).toBe(false);
  });
});

describe("deadlines before the month's events (A5)", () => {
  // A January (CET, UTC+1) in a far-future test year.
  const Y = 2100 + Math.floor(Math.random() * 800);
  const M = `${Y}-01`;
  let cycleId: string;
  const eventIds: string[] = [];

  beforeAll(async () => {
    const { data, error } = await admin.from("planning_cycles").insert({ month: `${M}-01` }).select("id").single();
    if (error) throw new Error(error.message);
    cycleId = data!.id;
    for (const d of ["10", "20"]) {
      eventIds.push((await createEvent({ title: `Deadline ${d}`, cycle_id: cycleId, status: "draft", starts_at: `${M}-${d}T18:00:00Z` })).id);
    }
  });
  afterAll(async () => {
    await admin.from("events").delete().eq("cycle_id", cycleId);
    await admin.from("planning_cycles").delete().eq("id", cycleId);
  });

  it("names the latest allowed dates", async () => {
    const { data } = await (await actionContext(USERS.events)).supabase.rpc("cycle_deadline_limits", { cycle: cycleId });
    expect(data).toEqual([{ form_latest: `${M}-01T22:59:00+00:00`, description_latest: `${M}-10T18:00:00+00:00` }]);
  });

  it("refuses a description deadline after the first event starts", async () => {
    const events = await actionContext(USERS.events);
    const late = await D.setDescriptionDeadline(events, { cycle_id: cycleId, deadline: `${M}-10T19:30` });
    expect(late).toMatchObject({ ok: false });
    expect(late.ok ? "" : late.message).toBe(`The description deadline must be by 10 January ${Y}, 19:00 at the latest – when the month's first event starts`);
    expect((await D.setDescriptionDeadline(events, { cycle_id: cycleId, deadline: `${M}-10T19:00` })).ok).toBe(true);
    expect((await D.setDescriptionDeadline(events, { cycle_id: cycleId, deadline: `${M}-08T20:00` })).ok).toBe(true);
    // Straight to the table too.
    const { error } = await events.supabase.from("planning_cycles").update({ description_deadline: `${M}-25T12:00:00Z` }).eq("id", cycleId);
    expect(error?.message).toMatch(/must be by 10 January/);
  });

  it("refuses an event added or moved before the deadline", async () => {
    const db = (await actionContext(USERS.events)).supabase;
    const added = await db.from("events").insert({ cycle_id: cycleId, title: "Too early", starts_at: `${M}-05T18:00:00Z` });
    expect(added.error?.message).toBe(`The event would start before the month's description deadline (8 January ${Y}, 20:00) – move the deadline first`);
    const moved = await db.from("events").update({ starts_at: `${M}-03T18:00:00Z` }).eq("id", eventIds[1]);
    expect(moved.error?.message).toMatch(/before the month's description deadline/);
    expect((await db.from("events").update({ starts_at: `${M}-21T18:00:00Z` }).eq("id", eventIds[1])).error).toBeNull();
  });

  it("refuses a volunteer form deadline after the month's first day", async () => {
    const events = await actionContext(USERS.events);
    const late = await P.openForm(events, { cycle_id: cycleId, closes_at: `${M}-02T00:00` });
    expect(late.ok ? "" : late.message).toBe(`The volunteer form must close by 1 January ${Y}, 23:59 at the latest – the first day of the month its events take place in`);
    expect((await P.openForm(events, { cycle_id: cycleId, closes_at: `${M}-01T23:59` })).ok).toBe(true);
  });
});
