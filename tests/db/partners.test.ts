// Partners on ideas and several OCs per event (round 2026-11-04): the
// proposer names partners as co-OC or helper, they say yes or no, the ones who
// said yes are fixed on the event; the form, the allocation and the roster
// handle several OCs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin, as, createCycle } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";

const ctx = actionContext;
const Y = 2100 + Math.floor(Math.random() * 800);
const TITLE = "Karaoke night (partners test)";

describe("partners on ideas, several OCs", () => {
  let cycleId: string;
  let ideaId: string;
  let eventId: string;

  beforeAll(async () => {
    cycleId = (await createCycle({ month: `${Y}-11-01` })).id;
  });
  afterAll(async () => {
    await admin.from("events").delete().eq("cycle_id", cycleId);
    await admin.from("event_ideas").delete().eq("title", TITLE);
    await admin.from("planning_cycles").delete().eq("id", cycleId);
  });

  it("the proposer names partners; only they, the partners and the teams see them", async () => {
    const r = await P.proposeIdea(await ctx(USERS.member), {
      title: TITLE,
      proposed_date: `${Y}-11-10`,
      helpers_needed: 2,
      partners: [
        { profile_id: USERS.volunteer1.id, role: "oc" },
        { profile_id: USERS.volunteer2.id, role: "helper" },
      ],
    });
    expect(r.ok).toBe(true);
    ideaId = (r as { data: { id: string } }).data.id;
    // The partner sees the idea and their request; an outsider sees neither.
    expect((await (await as(USERS.volunteer1)).from("event_ideas").select("id").eq("id", ideaId)).data).toHaveLength(1);
    expect((await (await as(USERS.volunteer1)).from("idea_partners").select("role, status").eq("idea_id", ideaId)).data).toEqual(
      expect.arrayContaining([{ role: "oc", status: "invited" }])
    );
    expect((await (await as(USERS.helper)).from("idea_partners").select("profile_id").eq("idea_id", ideaId)).data).toEqual([]);
    // Nobody else names partners, and nobody writes the table directly.
    expect((await (await as(USERS.helper)).rpc("set_idea_partners", { idea: ideaId, partners: [] })).error?.code).toBe("42501");
    expect((await (await as(USERS.member)).from("idea_partners").update({ status: "accepted" }).eq("idea_id", ideaId).select()).data ?? []).toEqual([]);
    // The proposer is not their own partner.
    expect(await P.proposeIdea(await ctx(USERS.member), { title: TITLE, proposed_date: `${Y}-11-10`, partners: [{ profile_id: USERS.member.id, role: "oc" }] })).toMatchObject({ ok: false });
  });

  it("partners say yes or no; only the named person answers", async () => {
    expect((await (await as(USERS.helper)).rpc("respond_idea_partner", { idea: ideaId, accept: true })).error?.code).toBe("42501");
    expect((await P.respondIdeaPartner(await ctx(USERS.volunteer1), { idea_id: ideaId, accept: true })).ok).toBe(true);
    expect((await P.respondIdeaPartner(await ctx(USERS.volunteer2), { idea_id: ideaId, accept: false })).ok).toBe(true);
    const { data } = await admin.from("idea_partners").select("profile_id, status").eq("idea_id", ideaId).order("profile_id");
    expect(Object.fromEntries((data ?? []).map((p) => [p.profile_id, p.status]))).toEqual({ [USERS.volunteer1.id]: "accepted", [USERS.volunteer2.id]: "declined" });
    // Changing the partners keeps unchanged answers and asks the new ones.
    expect((await P.setIdeaPartners(await ctx(USERS.member), {
      idea_id: ideaId,
      partners: [
        { profile_id: USERS.volunteer1.id, role: "oc" },
        { profile_id: USERS.helper.id, role: "helper" },
      ],
    })).ok).toBe(true);
    const { data: after } = await admin.from("idea_partners").select("profile_id, status").eq("idea_id", ideaId);
    expect(Object.fromEntries((after ?? []).map((p) => [p.profile_id, p.status]))).toEqual({ [USERS.volunteer1.id]: "accepted", [USERS.helper.id]: "invited" });
  });

  it("accepting the idea counts the co-OCs in the OCs needed; the partners who said yes are fixed", async () => {
    const r = await P.acceptIdea(await ctx(USERS.events), { idea_id: ideaId, cycle_id: cycleId, type: "standard", starts_at: `${Y}-11-10T19:00` });
    expect(r.ok).toBe(true);
    eventId = (r as { data: { event_id: string } }).data.event_id;
    // The proposer OCs it, volunteer1 is co-OC: two OCs.
    expect((await admin.from("events").select("ocs_needed").eq("id", eventId).single()).data).toEqual({ ocs_needed: 2 });
    // Too late to name partners; still time to answer (before the roster).
    expect((await P.setIdeaPartners(await ctx(USERS.member), { idea_id: ideaId, partners: [] })).ok).toBe(false);
    expect((await P.respondIdeaPartner(await ctx(USERS.helper), { idea_id: ideaId, accept: true })).ok).toBe(true);
    const fixed = (await (await as(USERS.volunteer2)).rpc("event_fixed_people", { cycle: cycleId })).data!;
    expect(fixed.map((f) => [f.profile_id, f.role, f.source]).sort()).toEqual(
      [
        [USERS.member.id, "oc", "proposer"],
        [USERS.volunteer1.id, "oc", "partner"],
        [USERS.helper.id, "helper", "partner"],
      ].sort()
    );
  });

  it("the form takes no OC answers once the fixed OCs fill the slots, and nothing from people on the event", async () => {
    const opened = await P.openForm(await ctx(USERS.events), { cycle_id: cycleId, closes_at: `${Y}-10-25T12:00` });
    expect(opened, JSON.stringify(opened)).toMatchObject({ ok: true });
    const submit = async (u: (typeof USERS)[keyof typeof USERS], oc: 1 | null, helper: 1 | null) =>
      P.submitVolunteerForm(await ctx(u), { cycle_id: cycleId, choices: [{ event_id: eventId, oc_rank: oc, helper_rank: helper }], max_events: 2 });
    expect(await submit(USERS.oc, 1, null)).toMatchObject({ ok: false });
    expect(await submit(USERS.helper, null, 1)).toMatchObject({ ok: false });
    expect((await submit(USERS.volunteer2, null, 1)).ok).toBe(true);
  });

  it("the allocation places the fixed people and fills the rest; several OCs stay on the roster", async () => {
    expect((await P.closeForm(await ctx(USERS.events), { cycle_id: cycleId })).ok).toBe(true);
    const r = await P.runAllocation(await ctx(USERS.events), { cycle_id: cycleId });
    expect(r.ok).toBe(true);
    const ev = (r as { data: { events: Record<string, { status: string; ocIds: string[]; helperIds: string[] }> } }).data.events[eventId];
    expect(ev.status).toBe("staffed");
    expect([...ev.ocIds].sort()).toEqual([USERS.member.id, USERS.volunteer1.id].sort());
    expect([...ev.helperIds].sort()).toEqual([USERS.helper.id, USERS.volunteer2.id].sort());
    // Too late to answer now.
    expect((await P.respondIdeaPartner(await ctx(USERS.volunteer1), { idea_id: ideaId, accept: false })).ok).toBe(false);
  });

  it("making a third person OC moves the longest-serving OC to helper; with a free OC slot nobody moves", async () => {
    const e = await ctx(USERS.events);
    // Two OCs needed and two there: oc@ in, the earliest OC becomes helper.
    expect((await P.assign(e, { event_id: eventId, profile_id: USERS.oc.id, role: "oc" })).ok).toBe(true);
    let ocs = (await admin.from("assignments").select("profile_id").eq("event_id", eventId).eq("role", "oc").eq("status", "active")).data!;
    expect(ocs).toHaveLength(2);
    expect(ocs.map((o) => o.profile_id)).toContain(USERS.oc.id);
    // Three OCs needed: the next one joins without moving anyone.
    expect((await P.updateEvent(e, { id: eventId, ocs_needed: 3 })).ok).toBe(true);
    const helperToOc = ocs.length;
    expect((await P.assign(e, { event_id: eventId, profile_id: USERS.volunteer2.id, role: "oc" })).ok).toBe(true);
    ocs = (await admin.from("assignments").select("profile_id").eq("event_id", eventId).eq("role", "oc").eq("status", "active")).data!;
    expect(ocs).toHaveLength(helperToOc + 1);
  });
});
