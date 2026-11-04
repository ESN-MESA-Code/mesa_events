// The planning cycle in the database and through the server actions:
// ideas → schedule → volunteer form → allocation → roster → confirmation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle, daysFromNow, type SeedUser } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";
import { isoToBerlinInput } from "@/lib/dates";

const ctx = actionContext;
const Y = 2100 + Math.floor(Math.random() * 800);
const local = (iso: string) => isoToBerlinInput(iso);

describe("planning cycle end to end", () => {
  let cycleId: string;
  let ideaId: string;
  let quizId: string;
  let hikeId: string;
  let ghostId: string;

  beforeAll(async () => {
    // A December far in the future: the cycle's events must take place in its month.
    cycleId = (await createCycle({ month: `${Y}-12-01` })).id;
  });
  afterAll(async () => {
    await admin.from("events").delete().eq("cycle_id", cycleId);
    await admin.from("event_ideas").delete().eq("title", "Pub quiz (planning test)");
    await admin.from("planning_cycles").delete().eq("id", cycleId);
  });

  it("a member proposes an idea; only they and the teams see it", async () => {
    const r = await P.proposeIdea(await ctx(USERS.member), { title: "Pub quiz (planning test)", proposed_date: `${Y}-12-03`, pitch: "Trivia night", helpers_needed: 2 });
    expect(r.ok).toBe(true);
    ideaId = (r as { data: { id: string } }).data.id;
    expect((await (await as(USERS.helper)).from("event_ideas").select("id").eq("id", ideaId)).data).toEqual([]);
    expect((await (await as(USERS.comms)).from("event_ideas").select("id").eq("id", ideaId)).data).toHaveLength(1);
  });

  it("the proposer cannot accept their own idea; only Events can", async () => {
    const asMember = await P.acceptIdea(await ctx(USERS.member), { idea_id: ideaId, cycle_id: cycleId, type: "standard", starts_at: `${Y}-12-03T19:00` });
    expect(asMember).toMatchObject({ ok: false, error: "forbidden" });
    // Even straight to the database (skipping the action's check):
    const direct = await (await as(USERS.member)).rpc("accept_idea", { idea: ideaId, cycle: cycleId, event_type: "standard", starts: new Date().toISOString() });
    expect(direct.error?.code).toBe("42501");
    const sneaky = await (await as(USERS.member)).from("event_ideas").update({ status: "accepted" }).eq("id", ideaId);
    expect(sneaky.error).not.toBeNull();

    const r = await P.acceptIdea(await ctx(USERS.events), { idea_id: ideaId, cycle_id: cycleId, type: "special", starts_at: `${Y}-12-03T19:00` });
    expect(r.ok).toBe(true);
    quizId = (r as { data: { event_id: string } }).data.event_id;
    const { data: ev } = await admin.from("events").select("status, type, proposed_by, starts_at").eq("id", quizId).single();
    expect(ev).toMatchObject({ status: "draft", type: "special", proposed_by: USERS.member.id, starts_at: `${Y}-12-03T18:00:00+00:00` });
    const { data: idea } = await admin.from("event_ideas").select("status, decided_by").eq("id", ideaId).single();
    expect(idea).toEqual({ status: "accepted", decided_by: USERS.events.email });
  });

  it("Events adds own events; input is validated", async () => {
    const e = await ctx(USERS.events);
    const bad = await P.createEvent(e, { cycle_id: cycleId, title: "", type: "party", starts_at: "tomorrow", helpers_needed: -1 });
    expect(bad).toMatchObject({ ok: false, error: "invalid_input" });
    expect((bad as { issues: string[] }).issues.length).toBeGreaterThanOrEqual(4);

    const hike = await P.createEvent(e, { cycle_id: cycleId, title: "Hike", type: "day_trip", starts_at: `${Y}-12-12T08:00`, ends_at: `${Y}-12-12T18:00`, helpers_needed: 1 });
    hikeId = (hike as { data: { id: string } }).data.id;
    const ghost = await P.createEvent(e, { cycle_id: cycleId, title: "Ghost tour", type: "standard", starts_at: `${Y}-12-20T20:00`, helpers_needed: 1 });
    ghostId = (ghost as { data: { id: string } }).data.id;
    expect(hike.ok && ghost.ok).toBe(true);
    expect((await P.createEvent(await ctx(USERS.comms), { cycle_id: cycleId, title: "X", type: "standard", starts_at: `${Y}-12-20T20:00`, helpers_needed: 1 })).ok).toBe(false);
  });

  it("an event's date must be in its cycle's month (review C2)", async () => {
    const e = await ctx(USERS.events);
    // November is the month the December cycle is planned in, not its events' month.
    const early = await P.createEvent(e, { cycle_id: cycleId, title: "Too early", type: "standard", starts_at: `${Y}-11-28T19:00`, helpers_needed: 1 });
    expect(early).toMatchObject({ ok: false, error: "failed" });
    expect((early as { message: string }).message).toMatch(/December/);
    // 1 January 00:30 in Berlin is still 31 December in UTC: Berlin decides.
    expect((await P.createEvent(e, { cycle_id: cycleId, title: "New Year", type: "standard", starts_at: `${Y + 1}-01-01T00:30`, helpers_needed: 1 })).ok).toBe(false);
    // Straight to the database, and moving an existing event out of the month.
    const events = await as(USERS.events);
    const direct = await events.from("events").insert({ cycle_id: cycleId, title: "Sneaky", starts_at: `${Y}-11-30T18:00:00Z` });
    expect(direct.error?.code).toBe("22023");
    expect((await events.from("events").update({ starts_at: `${Y + 1}-01-02T18:00:00Z` }).eq("id", hikeId)).error?.code).toBe("22023");
    expect((await P.acceptIdea(e, { idea_id: ideaId, cycle_id: cycleId, type: "special", starts_at: `${Y}-11-03T19:00` })).ok).toBe(false);
    // The cycle's month cannot change under its events.
    expect((await events.from("planning_cycles").update({ month: `${Y}-11-01` }).eq("id", cycleId)).error?.code).toBe("22023");
    const { data } = await admin.from("events").select("title").eq("cycle_id", cycleId).order("title");
    expect(data!.map((r) => r.title)).toEqual(["Ghost tour", "Hike", "Pub quiz (planning test)"]);
  });

  it("the cycle status cannot be changed directly, only through the actions", async () => {
    const { error } = await (await as(USERS.events)).from("planning_cycles").update({ status: "confirmed" }).eq("id", cycleId);
    expect(error?.code).toBe("42501");
  });

  it("opening the form needs Events and a future deadline", async () => {
    expect((await P.openForm(await ctx(USERS.member), { cycle_id: cycleId, closes_at: local(daysFromNow(3)) })).ok).toBe(false);
    expect(await P.openForm(await ctx(USERS.events), { cycle_id: cycleId, closes_at: "2020-01-01T10:00" })).toMatchObject({ ok: false });
    expect((await P.openForm(await ctx(USERS.events), { cycle_id: cycleId, closes_at: local(daysFromNow(3)) })).ok).toBe(true);
    const { data } = await admin.from("events").select("status").eq("cycle_id", cycleId);
    expect(data!.every((e) => e.status === "scheduled")).toBe(true);
  });

  const submit = async (u: SeedUser, choices: Array<{ event_id: string; oc_rank: 1 | 2 | 3 | 4 | 5 | null; helper_rank: 1 | 2 | 3 | 4 | 5 | null }>) =>
    P.submitVolunteerForm(await ctx(u), { cycle_id: cycleId, choices });

  it("volunteers answer once; the form locks after submitting", async () => {
    expect((await submit(USERS.oc, [{ event_id: hikeId, oc_rank: 1, helper_rank: null }])).ok).toBe(true);
    const first = await admin.rpc("cycle_signups", { cycle: cycleId });
    // The service role is not Events: nothing.
    expect(first.data).toEqual([]);
    const events = await as(USERS.events);
    const t1 = (await events.rpc("cycle_signups", { cycle: cycleId })).data!.find((s) => s.event_id === hikeId)!.submitted_at;

    // A second submission is refused, through the action and straight to the database.
    const again = await submit(USERS.oc, [{ event_id: hikeId, oc_rank: 2, helper_rank: 1 }]);
    expect(again).toMatchObject({ ok: false, error: "failed" });
    expect((again as { message: string }).message).toMatch(/already submitted/);
    const direct = await (await as(USERS.oc)).rpc("submit_volunteer_form", { cycle: cycleId, choices: [], note: "" });
    expect(direct.error?.code).toBe("23505");
    const rows = (await events.rpc("cycle_signups", { cycle: cycleId })).data!;
    expect(rows.filter((s) => s.profile_id === USERS.oc.id)).toEqual([expect.objectContaining({ event_id: hikeId, oc_rank: 1, helper_rank: null, submitted_at: t1 })]);
  });

  it("Events clears one person's answers (logged); they submit again with a new time", async () => {
    expect(await P.clearVolunteerResponse(await ctx(USERS.oc), { cycle_id: cycleId, profile_id: USERS.oc.id, reason: "x" })).toMatchObject({ ok: false, error: "forbidden" });
    for (const u of [USERS.oc, USERS.comms, USERS.executive, USERS.admin]) {
      expect((await (await as(u)).rpc("clear_volunteer_response", { cycle: cycleId, profile: USERS.oc.id, reason: "x" })).error?.code, u.email).toBe("42501");
    }
    expect(await P.clearVolunteerResponse(await ctx(USERS.events), { cycle_id: cycleId, profile_id: USERS.oc.id, reason: " " })).toMatchObject({ ok: false, error: "invalid_input" });
    const before = (await (await as(USERS.events)).rpc("cycle_responses", { cycle: cycleId })).data!.find((r) => r.profile_id === USERS.oc.id)!;
    expect(before.events).toBe(1);
    expect((await P.clearVolunteerResponse(await ctx(USERS.events), { cycle_id: cycleId, profile_id: USERS.oc.id, reason: "Picked the wrong role" })).ok).toBe(true);
    const { data: log } = await admin.from("activity_log").select("actor_email, action, event_id, details").eq("cycle_id", cycleId).eq("entity", "volunteer_responses");
    expect(log).toEqual([
      expect.objectContaining({ actor_email: USERS.events.email, action: "clear", event_id: null, details: expect.objectContaining({ email: USERS.oc.email, events: 1, reason: "Picked the wrong role" }) }),
    ]);
    // Clearing twice: nothing to clear.
    expect((await P.clearVolunteerResponse(await ctx(USERS.events), { cycle_id: cycleId, profile_id: USERS.oc.id, reason: "again" })).ok).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    expect((await submit(USERS.oc, [
      { event_id: hikeId, oc_rank: 2, helper_rank: 1 },
      { event_id: quizId, oc_rank: null, helper_rank: 1 },
    ])).ok).toBe(true);
    const after = (await (await as(USERS.events)).rpc("cycle_responses", { cycle: cycleId })).data!.find((r) => r.profile_id === USERS.oc.id)!;
    expect(after.events).toBe(2);
    expect(Date.parse(after.submitted_at)).toBeGreaterThan(Date.parse(before.submitted_at));

    await submit(USERS.helper, [
      { event_id: hikeId, oc_rank: null, helper_rank: 1 },
      { event_id: quizId, oc_rank: null, helper_rank: 2 },
    ]);
    await submit(USERS.volunteer1, [{ event_id: quizId, oc_rank: null, helper_rank: 1 }]);
    // Volunteers see only their own answers; members cannot list responses.
    expect((await (await as(USERS.helper)).from("volunteer_responses").select("profile_id").eq("cycle_id", cycleId)).data).toEqual([{ profile_id: USERS.helper.id }]);
    expect((await (await as(USERS.helper)).rpc("cycle_responses", { cycle: cycleId })).data).toEqual([]);
  });

  it("refuses events of other cycles and garbage", async () => {
    const other = await createCycle({ status: "form_open" });
    const { data: foreign } = await admin.from("events").insert({ title: "Foreign", starts_at: daysFromNow(90), cycle_id: other.id, status: "scheduled" }).select("id").single();
    expect(await submit(USERS.member, [{ event_id: foreign!.id, oc_rank: 1, helper_rank: null }])).toMatchObject({ ok: false });
    expect(await P.submitVolunteerForm(await ctx(USERS.member), { cycle_id: cycleId, choices: [{ event_id: hikeId, oc_rank: 7, helper_rank: null }] })).toMatchObject({ ok: false, error: "invalid_input" });
    await admin.from("events").delete().eq("id", foreign!.id);
    await admin.from("planning_cycles").delete().eq("id", other.id);
  });

  it("an event whose proposer is its OC takes no OC answers, and the proposer cannot help on it", async () => {
    const ocVote = await submit(USERS.volunteer2, [{ event_id: quizId, oc_rank: 1, helper_rank: null }]);
    expect(ocVote).toMatchObject({ ok: false });
    expect((ocVote as { message: string }).message).toMatch(/OC already/);
    expect(await submit(USERS.member, [{ event_id: quizId, oc_rank: null, helper_rank: 1 }])).toMatchObject({ ok: false });
    // Refused before anything is saved: both can still submit.
    const events = await as(USERS.events);
    const rows = (await events.rpc("cycle_signups", { cycle: cycleId })).data!;
    expect(rows.some((r) => r.profile_id === USERS.volunteer2.id || r.profile_id === USERS.member.id)).toBe(false);
  });

  it("stores each volunteer's limits; the allocation history is for Events and executives", async () => {
    const events = await as(USERS.events);
    const rows = (await events.rpc("cycle_signups", { cycle: cycleId })).data!;
    // The form's defaults: no limit on events, at most one OC role.
    expect(rows.find((r) => r.profile_id === USERS.oc.id)).toMatchObject({ max_events: null, max_oc: 1 });
    expect(await P.submitVolunteerForm(await ctx(USERS.member), { cycle_id: cycleId, choices: [{ event_id: hikeId, oc_rank: null, helper_rank: 4 }], max_events: 0 })).toMatchObject({ ok: false, error: "invalid_input" });
    const history = (await events.rpc("allocation_history", { cycle: cycleId })).data!;
    expect(history.map((h) => h.profile_id).sort()).toEqual([...new Set(rows.map((r) => r.profile_id))].sort());
    expect(history.every((h) => typeof h.recent_events === "number" && typeof h.unplaced_last_cycle === "boolean")).toBe(true);
    expect((await (await as(USERS.member)).rpc("allocation_history", { cycle: cycleId })).data).toEqual([]);
  });

  it("the form closes at its deadline (pg_cron job)", async () => {
    await admin.from("planning_cycles").update({ form_closes_at: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", cycleId);
    expect(await submit(USERS.member, [{ event_id: hikeId, oc_rank: 1, helper_rank: null }])).toMatchObject({ ok: false });
    const { error } = await admin.rpc("test_close_due_forms");
    expect(error).toBeNull();
    const { data } = await admin.from("planning_cycles").select("status").eq("id", cycleId).single();
    expect(data!.status).toBe("form_closed");
  });

  it("only Events runs the allocation; it follows the priorities", async () => {
    expect(await P.runAllocation(await ctx(USERS.member), { cycle_id: cycleId })).toMatchObject({ ok: false, error: "forbidden" });
    expect((await (await as(USERS.comms)).rpc("save_allocation", { cycle: cycleId, rows: [] })).error?.code).toBe("42501");

    const r = await P.runAllocation(await ctx(USERS.events), { cycle_id: cycleId });
    expect(r.ok).toBe(true);
    const res = (r as { data: { events: Record<string, { status: string; ocIds: string[]; helperIds: string[] }> } }).data;
    // Quiz: proposer (member) is OC by default. Helpers in rounds: volunteer1 in round 1, oc@ (already the hike's OC) in round 2.
    expect(res.events[quizId]).toMatchObject({ status: "staffed", ocIds: [USERS.member.id], helperIds: [USERS.volunteer1.id, USERS.oc.id] });
    // Hike: oc@ wanted OC (2), helper@ helper (1).
    expect(res.events[hikeId]).toMatchObject({ status: "staffed", ocIds: [USERS.oc.id], helperIds: [USERS.helper.id] });
    expect(res.events[ghostId]).toMatchObject({ status: "dropped" });

    // Until confirmation, members do not see the roster (but see their own assignment).
    const { data: asHelper } = await (await as(USERS.helper)).from("assignments").select("profile_id").eq("event_id", hikeId);
    expect(asHelper).toEqual([{ profile_id: USERS.helper.id }]);
  });

  it("Events adjusts the roster (move, assign, remove)", async () => {
    const e = await ctx(USERS.events);
    const { data: helperRow } = await admin.from("assignments").select("id").eq("event_id", hikeId).eq("profile_id", USERS.helper.id).single();
    // Members cannot touch assignments, not even through the action.
    expect(await P.moveAssignment(await ctx(USERS.helper), { assignment_id: helperRow!.id, event_id: quizId, role: "oc" })).toMatchObject({ ok: false, error: "forbidden" });

    expect((await P.assign(e, { event_id: ghostId, profile_id: USERS.volunteer2.id, role: "oc" })).ok).toBe(true);
    expect((await P.moveAssignment(e, { assignment_id: helperRow!.id, event_id: ghostId, role: "helper" })).ok).toBe(true);
    const { data: ghost } = await admin.from("assignments").select("profile_id, role, source").eq("event_id", ghostId).order("role");
    expect(ghost).toEqual([
      { profile_id: USERS.helper.id, role: "helper", source: "manual" },
      { profile_id: USERS.volunteer2.id, role: "oc", source: "manual" },
    ]);
  });

  it("only Events confirms; statuses follow the staffing; the roster becomes public", async () => {
    expect(await P.confirmAllocation(await ctx(USERS.oc), { cycle_id: cycleId })).toMatchObject({ ok: false, error: "forbidden" });
    for (const u of [USERS.member, USERS.comms, USERS.finance, USERS.treasurer, USERS.executive, USERS.admin]) {
      expect((await (await as(u)).rpc("confirm_allocation", { cycle: cycleId })).error?.code, u.email).toBe("42501");
    }
    expect((await P.confirmAllocation(await ctx(USERS.events), { cycle_id: cycleId })).ok).toBe(true);
    const { data } = await admin.from("events").select("id, status").eq("cycle_id", cycleId);
    const status = Object.fromEntries(data!.map((e) => [e.id, e.status]));
    expect(status[quizId]).toBe("confirmed");
    expect(status[hikeId]).toBe("understaffed"); // its helper moved away
    expect(status[ghostId]).toBe("confirmed");
    const { data: seen } = await (await as(USERS.helper)).from("assignments").select("profile_id").eq("event_id", quizId);
    expect(seen).toHaveLength(3);
    // A confirmed cycle cannot be confirmed again.
    expect((await P.confirmAllocation(await ctx(USERS.events), { cycle_id: cycleId })).ok).toBe(false);
  });

  it("the OC decides whether an under-staffed event runs", async () => {
    const asHelper = await (await as(USERS.helper)).from("events").update({ status: "cancelled" }, { count: "exact" }).eq("id", hikeId);
    expect(asHelper.count ?? 0).toBe(0);
    // Not by writing the status (review 2026-10-29 A1): through the decision, which is stored.
    expect((await (await as(USERS.oc)).from("events").update({ status: "confirmed" }).eq("id", hikeId)).error?.code).toBe("42501");
    expect((await (await as(USERS.oc)).rpc("decide_understaffed", { event: hikeId, decision: "run" })).error).toBeNull();
    const { data: decided } = await admin.from("events").select("status, understaffed_decision").eq("id", hikeId).single();
    expect(decided).toEqual({ status: "confirmed", understaffed_decision: "run" });
    // But not the title (Events only).
    const title = await (await as(USERS.oc)).from("events").update({ title: "Renamed" }).eq("id", hikeId);
    expect(title.error?.code).toBe("42501");
  });

  it("the OC changes location, price and capacity, but not the date (review B3)", async () => {
    const oc = await ctx(USERS.oc);
    expect((await P.updateEvent(oc, { id: hikeId, location: "Kampenwand car park", price_cents: 1200, capacity: 20 })).ok).toBe(true);
    expect(await P.updateEvent(oc, { id: hikeId, starts_at: `${Y}-12-13T08:00` })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await P.updateEvent(oc, { id: hikeId, ends_at: `${Y}-12-12T20:00` })).toMatchObject({ ok: false, error: "forbidden" });
    // Straight to the database too.
    for (const patch of [{ starts_at: `${Y}-12-13T07:00:00Z` }, { ends_at: `${Y}-12-12T19:00:00Z` }]) {
      const { error } = await (await as(USERS.oc)).from("events").update(patch).eq("id", hikeId);
      expect(error?.code, JSON.stringify(patch)).toBe("42501");
    }
    const { data } = await admin.from("events").select("starts_at, location, price_cents, capacity").eq("id", hikeId).single();
    expect(data).toEqual({ starts_at: `${Y}-12-12T07:00:00+00:00`, location: "Kampenwand car park", price_cents: 1200, capacity: 20 });
    // Events moves it.
    expect((await P.updateEvent(await ctx(USERS.events), { id: hikeId, starts_at: `${Y}-12-12T09:00` })).ok).toBe(true);
  });

  it("every step is in the activity log", async () => {
    const { data } = await admin.from("activity_log").select("entity, action").eq("cycle_id", cycleId);
    expect(data!.length).toBeGreaterThan(0);
    const { data: forEvent } = await admin.from("activity_log").select("entity, action").eq("event_id", quizId);
    expect(forEvent!.map((r) => `${r.entity}.${r.action}`)).toEqual(expect.arrayContaining(["events.insert", "assignments.insert", "events.update"]));
  });
});

describe("server actions check authorization on the server", () => {
  it("refuse members without a session or without the rules accepted", async () => {
    expect(await P.proposeIdea({ supabase: admin, viewer: null }, { title: "x", proposed_date: "2026-12-01" })).toMatchObject({ ok: false, error: "unauthenticated" });
    expect(await P.proposeIdea(await ctx(USERS.newcomer), { title: "x", proposed_date: "2026-12-01" })).toMatchObject({ ok: false, error: "unauthenticated" });
  });

  it("use the roles from the database, not what a client claims", async () => {
    // A context claiming the Events role for a plain member: the role check
    // passes, but the database still refuses (RLS and definer checks).
    const lying = { ...(await ctx(USERS.member)), viewer: { ...(await ctx(USERS.member)).viewer!, roles: ["events" as const] } };
    const r = await P.createCycle(lying, { month: "2999-01" });
    expect(r).toMatchObject({ ok: false, error: "forbidden" });
  });
});
