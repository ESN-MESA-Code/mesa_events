// An event's and a cycle's life after the roster (review 2026-10-29):
// events become "completed" once they ended (A3), and deadlines must lie
// before the cycle's events (A5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, createEvent, daysFromNow, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as A from "@/lib/actions/attendance";
import * as H from "@/lib/actions/handin";

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
