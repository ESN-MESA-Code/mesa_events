// Reliability (2026-11-07): the OC reports who was missing after an event;
// the Events team and HR keep the blacklist; people on it join events only
// as helpers on non-crucial ones; member_reliability() sums it up.
import { afterAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createEvent, daysFromNow } from "../helpers/local";

const events: string[] = [];
const who = USERS.volunteer2;
afterAll(async () => {
  await admin.from("volunteer_blacklist").delete().eq("profile_id", who.id);
  await admin.from("events").delete().in("id", events);
});

async function event(extra: Parameters<typeof createEvent>[0] = {}) {
  const e = await createEvent({ oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1, ...extra });
  events.push(e.id);
  return e;
}
const assignmentOf = async (eventId: string, profileId: string) =>
  (await admin.from("assignments").select("id").eq("event_id", eventId).eq("profile_id", profileId).single()).data!.id;

describe("attendance reports", () => {
  it("the OC reports a helper missing once the event started; not before, not about themself", async () => {
    const future = await event({ starts_at: daysFromNow(3) });
    const oc = await as(USERS.oc);
    const early = await oc.rpc("report_attendance", { assignment: await assignmentOf(future.id, USERS.helper.id), outcome: "no_show" });
    expect(early.error?.message).toMatch(/once the event has started/);

    const past = await event({ starts_at: daysFromNow(-1) });
    const helperA = await assignmentOf(past.id, USERS.helper.id);
    expect((await oc.rpc("report_attendance", { assignment: await assignmentOf(past.id, USERS.oc.id), outcome: "no_show" })).error?.code).toBe("42501");
    expect((await (await as(USERS.helper)).rpc("report_attendance", { assignment: helperA, outcome: "no_show" })).error?.code).toBe("42501");
    expect((await oc.rpc("report_attendance", { assignment: helperA, outcome: "no_show", note: "Did not answer in the Chat" })).error).toBeNull();
    // A second report replaces the first.
    expect((await oc.rpc("report_attendance", { assignment: helperA, outcome: "short_notice", note: "Told me an hour before" })).error).toBeNull();
    const { data } = await admin.from("attendance_reports").select("outcome, note, reported_by").eq("assignment_id", helperA);
    expect(data).toEqual([{ outcome: "short_notice", note: "Told me an hour before", reported_by: USERS.oc.email }]);
  });

  it("reports are read by the event's OC, Events, HR and the board – not by the helper or other members", async () => {
    const past = await event({ starts_at: daysFromNow(-2) });
    await (await as(USERS.oc)).rpc("report_attendance", { assignment: await assignmentOf(past.id, USERS.helper.id), outcome: "late" });
    for (const [user, n] of [[USERS.oc, 1], [USERS.events, 1], [USERS.hr, 1], [USERS.executive, 1], [USERS.helper, 0], [USERS.member, 0], [USERS.vp, 0]] as const) {
      const { data } = await (await as(user)).from("attendance_reports").select("outcome").eq("event_id", past.id);
      expect(data?.length, user.email).toBe(n);
    }
    // Straight writes are refused.
    const { error } = await (await as(USERS.events)).from("attendance_reports").delete().eq("event_id", past.id).select();
    expect((await admin.from("attendance_reports").select("outcome").eq("event_id", past.id)).data?.length).toBe(1);
    void error;
  });

  it("clearing a report: they were there after all", async () => {
    const past = await event({ starts_at: daysFromNow(-1) });
    const a = await assignmentOf(past.id, USERS.helper.id);
    const oc = await as(USERS.oc);
    await oc.rpc("report_attendance", { assignment: a, outcome: "no_show" });
    expect((await oc.rpc("clear_attendance_report", { assignment: a })).error).toBeNull();
    expect((await admin.from("attendance_reports").select("outcome").eq("assignment_id", a)).data).toEqual([]);
  });
});

describe("the blacklist", () => {
  it("the Events team and HR keep it, with a reason; others cannot", async () => {
    expect((await (await as(USERS.oc)).rpc("blacklist_add", { profile: who.id, reason: "x" })).error?.code).toBe("42501");
    expect((await (await as(USERS.hr)).rpc("blacklist_add", { profile: who.id, reason: " " })).error?.code).toBe("22023");
    expect((await (await as(USERS.hr)).rpc("blacklist_add", { profile: who.id, reason: "Three no-shows" })).error).toBeNull();
    expect((await (await as(USERS.events)).rpc("blacklist_add", { profile: who.id, reason: "Again" })).error?.code).toBe("23505");
    expect((await (await as(USERS.member)).from("volunteer_blacklist").select("id").eq("profile_id", who.id)).data).toEqual([]);
    expect((await (await as(USERS.events)).from("volunteer_blacklist").select("reason").eq("profile_id", who.id)).data).toEqual([{ reason: "Three no-shows" }]);
  });

  it("someone on it joins only as a helper on a non-crucial event", async () => {
    const crucial = await event({ starts_at: daysFromNow(20) });
    const relaxed = await event({ starts_at: daysFromNow(21) });
    const team = await as(USERS.events);
    expect((await team.from("events").update({ non_crucial: true }).eq("id", relaxed.id)).error).toBeNull();
    // The OC cannot mark their own event non-crucial.
    await (await as(USERS.oc)).from("events").update({ non_crucial: true }).eq("id", crucial.id);
    expect((await admin.from("events").select("non_crucial").eq("id", crucial.id).single()).data?.non_crucial).toBe(false);

    const helperOn = (eventId: string, role = "helper") => team.from("assignments").insert({ event_id: eventId, profile_id: who.id, role, source: "manual" }).select("id").single();
    expect((await helperOn(crucial.id)).error?.message).toMatch(/on the blacklist/);
    expect((await helperOn(relaxed.id, "oc")).error?.message).toMatch(/on the blacklist/);
    const ok = await helperOn(relaxed.id);
    expect(ok.error).toBeNull();
    // Moved to the crucial event: refused; made OC: refused.
    expect((await team.from("assignments").update({ event_id: crucial.id }).eq("id", ok.data!.id)).error?.message).toMatch(/on the blacklist/);
    expect((await team.from("assignments").update({ role: "oc" }).eq("id", ok.data!.id)).error?.message).toMatch(/on the blacklist/);
  });

  it("taken off again, kept as history; then placed anywhere", async () => {
    expect((await (await as(USERS.events)).rpc("blacklist_remove", { profile: who.id, note: "Better now" })).error).toBeNull();
    const { data } = await admin.from("volunteer_blacklist").select("removed_by, remove_note").eq("profile_id", who.id);
    expect(data).toEqual([{ removed_by: USERS.events.email, remove_note: "Better now" }]);
    const crucial = await event({ starts_at: daysFromNow(22) });
    expect((await admin.from("assignments").insert({ event_id: crucial.id, profile_id: who.id, role: "helper", source: "manual" })).error).toBeNull();
  });
});

describe("non-crucial events", () => {
  it("the service role (seeds, jobs) may mark them too", async () => {
    const e = await event({ starts_at: daysFromNow(25) });
    expect((await admin.from("events").update({ non_crucial: true }).eq("id", e.id)).error).toBeNull();
  });
});

describe("member_reliability()", () => {
  it("counts events done, reports and late drop-outs; Events, HR and the board only", async () => {
    const past = await event({ starts_at: daysFromNow(-3), helpers: [USERS.helper, who] });
    await (await as(USERS.oc)).rpc("report_attendance", { assignment: await assignmentOf(past.id, who.id), outcome: "no_show" });
    const late = await event({ starts_at: daysFromNow(-1), helpers: [who] });
    await admin.from("assignments").update({ status: "dropped_out", dropped_at: daysFromNow(-1.5) }).eq("event_id", late.id).eq("profile_id", who.id);

    expect((await (await as(USERS.member)).rpc("member_reliability", {})).error?.code).toBe("42501");
    const { data, error } = await (await as(USERS.hr)).rpc("member_reliability", { months: 12 });
    expect(error).toBeNull();
    const row = data!.find((r) => r.profile_id === who.id)!;
    expect(row.no_show).toBeGreaterThanOrEqual(1);
    expect(row.late_dropouts).toBeGreaterThanOrEqual(1);
    expect(row.events_done).toBeGreaterThanOrEqual(1);

    const { data: incidents } = await (await as(USERS.events)).rpc("member_incidents", { profile: who.id });
    expect(incidents!.map((i) => i.kind)).toEqual(expect.arrayContaining(["no_show", "late_dropout"]));
  });
});
