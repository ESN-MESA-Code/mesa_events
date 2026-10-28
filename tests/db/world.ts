// The shared test world for the RLS matrix and other DB tests: a confirmed
// cycle with event A (OC oc@, helper helper@) and event B (OC volunteer1@,
// helper volunteer2@), an unconfirmed cycle with event P (drafting), and a
// draft event D. Built once per test file with the service role.
import { USERS, admin, as, anonClient, createCycle, createEvent, daysFromNow, type Db, type SeedUser } from "../helpers/local";

export const ROLES = ["anon", "newcomer", "member", "oc", "helper", "events", "comms", "finance", "treasurer", "executive", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Members who accepted the rules (everyone but anon and the newcomer). */
export const MEMBERS: Role[] = ["member", "oc", "helper", "events", "comms", "finance", "treasurer", "executive", "admin"];
/** public.is_team(): Events, Comms, Finance (incl. Treasurer) and executives. */
export const TEAM: Role[] = ["events", "comms", "finance", "treasurer", "executive"];
export const NOBODY: Role[] = [];

export const ROLE_USER: Record<Exclude<Role, "anon">, SeedUser> = {
  newcomer: USERS.newcomer,
  member: USERS.member,
  oc: USERS.oc,
  helper: USERS.helper,
  events: USERS.events,
  comms: USERS.comms,
  finance: USERS.finance,
  treasurer: USERS.treasurer,
  executive: USERS.executive,
  admin: USERS.admin,
};

export async function clientFor(role: Role): Promise<Db> {
  return role === "anon" ? anonClient() : as(ROLE_USER[role]);
}

export interface World {
  cycle: { id: string };
  draftCycle: { id: string };
  eventA: { id: string };
  eventB: { id: string };
  eventP: { id: string };
  eventD: { id: string };
}

export async function buildWorld(): Promise<World> {
  const cycle = await createCycle({ status: "confirmed" });
  const draftCycle = await createCycle({ status: "allocated" });
  const eventA = await createEvent({ title: "World A", cycle_id: cycle.id, oc: USERS.oc, helpers: [USERS.helper], starts_at: daysFromNow(10) });
  const eventB = await createEvent({ title: "World B", cycle_id: cycle.id, oc: USERS.volunteer1, helpers: [USERS.volunteer2], starts_at: daysFromNow(11) });
  const eventP = await createEvent({ title: "World P", cycle_id: draftCycle.id, status: "scheduled", oc: USERS.volunteer1, starts_at: daysFromNow(40) });
  const eventD = await createEvent({ title: "World D", status: "draft", starts_at: daysFromNow(50) });
  return { cycle, draftCycle, eventA, eventB, eventP, eventD };
}

export async function destroyWorld(w: World) {
  for (const e of [w.eventA, w.eventB, w.eventP, w.eventD]) await admin.from("events").delete().eq("id", e.id);
  for (const c of [w.cycle, w.draftCycle]) await admin.from("planning_cycles").delete().eq("id", c.id);
}
