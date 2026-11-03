// The cycle's fixed timeline in the database (round 2026-11-02): the same
// dates as lib/timeline.ts, ideas closing on the 7th for the month after,
// the form opening by itself on the 10th, the description deadline
// defaulting to the 20th (the reminders before it: tests/db/remind.test.ts).
import { afterAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle, createEvent } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";
import * as A from "@/lib/actions/admin";
import { addMonths, monthOf } from "@/lib/dates";
import { cycleTimeline, firstOpenIdeaMonth } from "@/lib/timeline";

const cycles: string[] = [];
const ideaTitle = `Timeline idea ${crypto.randomUUID().slice(0, 8)}`;
afterAll(async () => {
  await admin.from("event_ideas").delete().eq("title", ideaTitle);
  for (const id of cycles) {
    await admin.from("events").delete().eq("cycle_id", id);
    await admin.from("planning_cycles").delete().eq("id", id);
  }
});

/** A test cycle (far ahead) with one scheduled event on the 12th, and its timeline. */
async function cycleWithEvent(status: "planning" | "allocated") {
  const cycle = await createCycle({ status });
  cycles.push(cycle.id);
  const event = await createEvent({ cycle_id: cycle.id, status: status === "planning" ? "draft" : "scheduled", starts_at: `${cycle.month.slice(0, 8)}12T18:00:00Z`, oc: USERS.oc, helpers: [USERS.helper], helpers_needed: 1 });
  return { cycle, event, timeline: cycleTimeline(cycle.month) };
}

describe("the cycle timeline", () => {
  it("has the same dates in SQL and in lib/timeline.ts", async () => {
    for (const month of ["2026-12-01", "2027-01-01", "2027-04-01", "2027-11-01"]) {
      const { data } = await admin.rpc("cycle_timeline", { month });
      const t = cycleTimeline(month);
      expect(data!.map((r) => [r.ideas_due, r.form_opens, r.form_closes, r.descriptions_due].map((x) => new Date(x).toISOString()))[0]).toEqual([t.ideasDue, t.formOpens, t.formCloses, t.descriptionsDue]);
    }
  });

  it("refuses a timeline out of order (database and action)", async () => {
    const member = await as(USERS.admin);
    const { error } = await member.from("app_settings").update({ value: { ideas_due: 12, form_opens: 10, form_closes: 15, descriptions_due: 20 } }).eq("key", "cycle_timeline");
    expect(error?.message).toMatch(/in order/);
    const r = await A.updateSetting(await actionContext(USERS.admin), { key: "cycle_timeline", value: { ideas_due: 7, form_opens: 10, form_closes: 15, descriptions_due: 30 } });
    expect(r.ok).toBe(false);
  });
});

describe("ideas close on the 7th for the month after", () => {
  const now = Date.now();
  const thisMonth = monthOf(new Date(now).toISOString());
  const closed = `${thisMonth.slice(0, 8)}20`;
  const open = `${firstOpenIdeaMonth(now).slice(0, 8)}05`;

  it("a member cannot propose for a closed month; any later month is fine", async () => {
    const member = await actionContext(USERS.member);
    const refused = await P.proposeIdea(member, { title: ideaTitle, proposed_date: closed });
    expect(refused.ok ? "" : refused.message).toMatch(/^Ideas for .+ closed on .+ – pick a date in .+ or later$/);
    expect((await P.proposeIdea(member, { title: ideaTitle, proposed_date: open })).ok).toBe(true);
    const nextYear = `${addMonths(thisMonth, 13).slice(0, 8)}10`;
    const r = await P.proposeIdea(member, { title: ideaTitle, proposed_date: nextYear });
    expect(r.ok).toBe(true);
    // Moving their own idea into a closed month is refused too.
    const { error } = await (await as(USERS.member)).from("event_ideas").update({ proposed_date: closed }).eq("id", (r as { data: { id: string } }).data.id);
    expect(error?.message).toMatch(/closed on/);
  });

  it("the Events team is not bound", async () => {
    expect((await P.proposeIdea(await actionContext(USERS.events), { title: ideaTitle, proposed_date: closed })).ok).toBe(true);
  });
});

describe("the form opens by itself", () => {
  it("on its day, with the events on the schedule, closing on the 15th", async () => {
    const { cycle, event, timeline } = await cycleWithEvent("planning");
    const empty = await createCycle({ status: "planning" });
    cycles.push(empty.id);
    // The day before: nothing.
    await admin.rpc("open_due_forms", { at: new Date(Date.parse(timeline.formOpens) - 3_600_000).toISOString() });
    expect((await admin.from("planning_cycles").select("status").eq("id", cycle.id).single()).data!.status).toBe("planning");
    // On the day.
    const { data: n } = await admin.rpc("open_due_forms", { at: new Date(Date.parse(timeline.formOpens) + 60_000).toISOString() });
    expect(n).toBeGreaterThanOrEqual(1);
    const { data: c } = await admin.from("planning_cycles").select("status, form_closes_at").eq("id", cycle.id).single();
    expect(c!.status).toBe("form_open");
    expect(new Date(c!.form_closes_at!).toISOString()).toBe(timeline.formCloses);
    expect((await admin.from("events").select("status").eq("id", event.id).single()).data!.status).toBe("scheduled");
    // An empty schedule stays planning.
    await admin.rpc("open_due_forms", { at: new Date(Date.parse(cycleTimeline(empty.month).formOpens) + 60_000).toISOString() });
    expect((await admin.from("planning_cycles").select("status").eq("id", empty.id).single()).data!.status).toBe("planning");
    // Members cannot run it.
    expect((await (await as(USERS.events)).rpc("open_due_forms", {})).error).not.toBeNull();
  });
});

describe("descriptions", () => {
  it("confirming the roster sets the deadline to the 20th; the OC is reminded before it", async () => {
    const { cycle, event, timeline } = await cycleWithEvent("allocated");
    const { error } = await (await as(USERS.events)).rpc("confirm_allocation", { cycle: cycle.id });
    expect(error).toBeNull();
    const { data: c } = await admin.from("planning_cycles").select("description_deadline").eq("id", cycle.id).single();
    expect(new Date(c!.description_deadline!).toISOString()).toBe(timeline.descriptionsDue);

    // The automatic reminders (round 2026-11-03): from 3 days before (the default), by day.
    const daysBefore = (n: number) => `${new Date(Date.parse(timeline.descriptionsDue) - n * 86_400_000).toISOString().slice(0, 10)}T11:00:00Z`;
    await admin.rpc("send_oc_reminders", { at: daysBefore(5) });
    expect((await admin.from("jobs").select("id").eq("event_id", event.id).eq("kind", "chat.remind_oc")).data).toHaveLength(0);
    await admin.rpc("send_oc_reminders", { at: daysBefore(1) });
    const { data: jobs } = await admin.from("jobs").select("kind, payload").eq("event_id", event.id).eq("kind", "chat.remind_oc");
    expect(jobs).toHaveLength(1);
    expect(jobs![0].payload).toMatchObject({ about: "description" });
    // Once a day.
    await admin.rpc("send_oc_reminders", { at: daysBefore(1) });
    expect((await admin.from("jobs").select("id").eq("event_id", event.id).eq("kind", "chat.remind_oc")).data).toHaveLength(1);
    await admin.from("jobs").delete().eq("event_id", event.id);
  });
});
