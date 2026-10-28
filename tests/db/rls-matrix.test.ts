// Row Level Security matrix: every table × every role × select / insert /
// update / delete, including cross-event access (OC and helper of event A
// against event B), anonymous visitors and members who have not accepted the
// confidentiality rules. Each case says exactly who may do it; everyone else
// must be refused (an error, or no row affected).
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, admin } from "../helpers/local";
import { MEMBERS, NOBODY, ROLES, TEAM, buildWorld, clientFor, destroyWorld, type Role, type World } from "./world";
import { SPECS_EXTRA, cleanupExtra } from "./rls-specs";
import type { Database } from "@/types/database";

export type Table = keyof Database["public"]["Tables"];
export type Match = Record<string, string | number | boolean>;

export interface RowCase {
  name: string;
  /** Creates the row (service role) and returns how to find it. */
  make: (w: World) => Promise<Match>;
  allowed: Role[];
}

export interface Spec {
  table: Table;
  select: RowCase[];
  insert: { name?: string; payload: (w: World, role: Role) => Promise<Record<string, unknown>> | Record<string, unknown>; allowed: Role[]; match: (p: Record<string, unknown>) => Match }[];
  update: (RowCase & { patch: (w: World) => Record<string, unknown> })[];
  delete: RowCase[];
}

const uid = () => crypto.randomUUID();
/** A month no other test uses (years 3000–8999); removed again after the run. */
const uniqueMonth = () => `${3000 + crypto.randomInt(6000)}-${String(1 + crypto.randomInt(12)).padStart(2, "0")}-01`;
const letters = () => Array.from(crypto.randomBytes(12), (b) => String.fromCharCode(97 + (b % 26))).join("");
const ins = async (table: Table, row: Record<string, unknown>, key = "id"): Promise<Match> => {
  const { data, error } = await admin.from(table).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return { [key]: (data as Record<string, string>)[key] };
};

/** An assignment on its own draft event (so cases do not collide). */
async function freshAssignment(): Promise<Match> {
  const event = await ins("events", { title: "RLS assignment", starts_at: new Date(Date.now() + 864e6).toISOString() });
  return ins("assignments", { event_id: event.id, profile_id: USERS.member.id, role: "helper" });
}

const FOUNDATION: Spec[] = [
  {
    table: "planning_cycles",
    select: [
      { name: "confirmed cycle", make: async (w) => ({ id: w.cycle.id }), allowed: MEMBERS },
      {
        name: "cycle still in planning",
        make: async () => ins("planning_cycles", { month: uniqueMonth(), status: "planning" }),
        allowed: TEAM,
      },
    ],
    insert: [
      {
        payload: () => ({ id: uid(), month: uniqueMonth() }),
        allowed: ["events"],
        match: (p) => ({ id: p.id as string }),
      },
    ],
    update: [{ name: "set the description deadline", make: async (w) => ({ id: w.cycle.id }), patch: () => ({ description_deadline: new Date().toISOString() }), allowed: ["events"] }],
    delete: [{ name: "cycle", make: async () => ins("planning_cycles", { month: uniqueMonth() }), allowed: NOBODY }],
  },
  {
    table: "event_series",
    select: [{ name: "series", make: async () => ins("event_series", { title: "Language café" }), allowed: MEMBERS }],
    insert: [{ payload: () => ({ id: uid(), title: "New series" }), allowed: ["events"], match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "rename", make: async () => ins("event_series", { title: "S" }), patch: () => ({ title: "Renamed" }), allowed: ["events"] }],
    delete: [{ name: "series", make: async () => ins("event_series", { title: "S" }), allowed: NOBODY }],
  },
  {
    table: "events",
    select: [
      { name: "event A (confirmed)", make: async (w) => ({ id: w.eventA.id }), allowed: MEMBERS },
      { name: "event B (confirmed, other staff)", make: async (w) => ({ id: w.eventB.id }), allowed: MEMBERS },
      { name: "draft event", make: async (w) => ({ id: w.eventD.id }), allowed: TEAM },
    ],
    insert: [{ payload: () => ({ id: uid(), title: "New", starts_at: new Date(Date.now() + 864e5).toISOString() }), allowed: ["events"], match: (p) => ({ id: p.id as string }) }],
    update: [
      { name: "details of event A", make: async (w) => ({ id: w.eventA.id }), patch: () => ({ location: `Venue ${uid().slice(0, 4)}` }), allowed: ["events", "oc"] },
      { name: "details of event B", make: async (w) => ({ id: w.eventB.id }), patch: () => ({ location: `Venue ${uid().slice(0, 4)}` }), allowed: ["events"] },
      { name: "type of event A (Events only)", make: async (w) => ({ id: w.eventA.id }), patch: () => ({ type: "special" }), allowed: ["events"] },
    ],
    delete: [{ name: "event", make: async () => ins("events", { title: "Del", starts_at: new Date().toISOString() }), allowed: NOBODY }],
  },
  {
    table: "assignments",
    select: [
      { name: "helper of A (published roster)", make: async (w) => ({ event_id: w.eventA.id, profile_id: USERS.helper.id }), allowed: MEMBERS },
      {
        name: "OC of P (roster not confirmed)",
        make: async (w) => ({ event_id: w.eventP.id, profile_id: USERS.volunteer1.id }),
        allowed: TEAM,
      },
    ],
    insert: [
      {
        payload: (w) => ({ id: uid(), event_id: w.eventD.id, profile_id: USERS.member.id, role: "helper" }),
        allowed: ["events"],
        match: (p) => ({ id: p.id as string }),
      },
    ],
    update: [
      {
        name: "drop the helper of A out",
        make: async () => freshAssignment(),
        patch: () => ({ status: "dropped_out", dropped_at: new Date().toISOString() }),
        allowed: ["events"],
      },
    ],
    delete: [{ name: "assignment", make: async () => freshAssignment(), allowed: ["events"] }],
  },
  {
    // Drop-out reasons: the event's OC and the Events team only (review B2).
    table: "assignment_drop_reasons",
    select: [
      {
        name: "reason of a helper of A",
        make: async (w) => {
          const a = await ins("assignments", { event_id: w.eventA.id, profile_id: USERS.volunteer2.id, role: "helper", status: "dropped_out", dropped_at: new Date().toISOString() });
          return ins("assignment_drop_reasons", { assignment_id: a.id, event_id: w.eventA.id, reason: "ill" }, "assignment_id");
        },
        allowed: ["events", "oc"],
      },
    ],
    insert: [{ payload: async () => ({ assignment_id: (await freshAssignment()).id, event_id: (await admin.from("events").select("id").eq("title", "RLS assignment").limit(1).single()).data!.id, reason: "x" }), allowed: NOBODY, match: (p) => ({ assignment_id: p.assignment_id as string }) }],
    update: [
      {
        name: "reason",
        make: async () => {
          const a = await freshAssignment();
          const { data } = await admin.from("assignments").select("event_id").eq("id", a.id as string).single();
          return ins("assignment_drop_reasons", { assignment_id: a.id, event_id: data!.event_id, reason: "x" }, "assignment_id");
        },
        patch: () => ({ reason: "changed" }),
        allowed: NOBODY,
      },
    ],
    delete: [
      {
        name: "reason",
        make: async () => {
          const a = await freshAssignment();
          const { data } = await admin.from("assignments").select("event_id").eq("id", a.id as string).single();
          return ins("assignment_drop_reasons", { assignment_id: a.id, event_id: data!.event_id, reason: "x" }, "assignment_id");
        },
        allowed: NOBODY,
      },
    ],
  },
  {
    table: "profiles",
    select: [{ name: "a profile", make: async () => ({ id: USERS.oc.id }), allowed: MEMBERS }],
    insert: [{ payload: () => ({ id: uid(), email: `rlstest-x${uid().slice(0, 6)}@esnmesa.org` }), allowed: NOBODY, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "a profile", make: async () => ({ id: USERS.member.id }), patch: () => ({ full_name: "Hacked" }), allowed: NOBODY }],
    delete: [{ name: "a profile", make: async () => ({ id: USERS.signout.id }), allowed: NOBODY }],
  },
  {
    table: "role_members",
    select: [
      { name: "Events' own role", make: async () => ({ email: USERS.events.email, role: "events" }), allowed: ["events", "admin"] },
      { name: "Treasurer role", make: async () => ({ email: USERS.treasurer.email, role: "treasurer" }), allowed: ["treasurer", "admin"] },
    ],
    insert: [
      { name: "manual", payload: () => ({ email: `rlstest-m${uid().slice(0, 6)}@esnmesa.org`, role: "events", source: "manual" }), allowed: ["admin"], match: (p) => ({ email: p.email as string }) },
      { name: "pretend group row", payload: () => ({ email: `rlstest-g${uid().slice(0, 6)}@esnmesa.org`, role: "events", source: "group" }), allowed: NOBODY, match: (p) => ({ email: p.email as string }) },
    ],
    update: [{ name: "role", make: async () => ({ email: USERS.events.email, role: "events" }), patch: () => ({ role: "admin" }), allowed: NOBODY }],
    delete: [
      { name: "manual role", make: async () => ins("role_members", { email: `rlstest-d${uid().slice(0, 6)}@esnmesa.org`, role: "comms", source: "manual" }, "email"), allowed: ["admin"] },
      { name: "group role", make: async () => ins("role_members", { email: `rlstest-e${uid().slice(0, 6)}@esnmesa.org`, role: "comms", source: "group" }, "email"), allowed: NOBODY },
    ],
  },
  {
    table: "app_settings",
    select: [{ name: "a setting", make: async () => ({ key: "default_helpers_needed" }), allowed: MEMBERS }],
    insert: [{ payload: () => ({ key: `zzrls${letters()}`, value: 1 }), allowed: ["admin"], match: (p) => ({ key: p.key as string }) }],
    update: [{ name: "a setting", make: async () => ({ key: "chat_notifications" }), patch: () => ({ value: true }), allowed: ["admin"] }],
    delete: [{ name: "a setting", make: async () => ins("app_settings", { key: `zzrls${letters()}`, value: 1 }, "key"), allowed: NOBODY }],
  },
  {
    table: "activity_log",
    select: [
      {
        name: "entry of event A",
        make: async (w) => ins("activity_log", { event_id: w.eventA.id, entity: "events", action: "test" }),
        allowed: ["events", "executive", "admin", "oc", "helper"],
      },
      { name: "entry of event B", make: async (w) => ins("activity_log", { event_id: w.eventB.id, entity: "events", action: "test" }), allowed: ["events", "executive", "admin"] },
      // Claims: Finance (and executives, read-only), never the claim's event staff (review B1, C4).
      { name: "claim entry of event A", make: async (w) => ins("activity_log", { event_id: w.eventA.id, entity: "reimbursements", action: "test" }), allowed: ["finance", "treasurer", "executive"] },
      { name: "idea entry of event A", make: async (w) => ins("activity_log", { event_id: w.eventA.id, entity: "event_ideas", action: "test" }), allowed: ["events", "executive", "admin"] },
    ],
    insert: [{ payload: (w) => ({ event_id: w.eventA.id, entity: "x", action: "forged" }), allowed: NOBODY, match: () => ({ action: "forged" }) }],
    update: [{ name: "entry", make: async (w) => ins("activity_log", { event_id: w.eventA.id, entity: "e", action: "t" }), patch: () => ({ action: "changed" }), allowed: NOBODY }],
    delete: [{ name: "entry", make: async (w) => ins("activity_log", { event_id: w.eventA.id, entity: "e", action: "t" }), allowed: NOBODY }],
  },
  {
    table: "jobs",
    select: [{ name: "a job", make: async () => ins("jobs", { kind: "system.noop", idempotency_key: `rls.${uid()}` }), allowed: ["admin"] }],
    insert: [{ payload: () => ({ kind: "system.noop", idempotency_key: `rls.ins.${uid()}` }), allowed: NOBODY, match: (p) => ({ idempotency_key: p.idempotency_key as string }) }],
    update: [{ name: "a job", make: async () => ins("jobs", { kind: "system.noop", idempotency_key: `rls.${uid()}` }), patch: () => ({ status: "done" }), allowed: NOBODY }],
    delete: [{ name: "a job", make: async () => ins("jobs", { kind: "system.noop", idempotency_key: `rls.${uid()}` }), allowed: NOBODY }],
  },
  {
    table: "organiser_acknowledgements",
    select: [{ name: "member's acceptance", make: async () => ({ email: USERS.member.email }), allowed: ["member"] }],
    insert: [{ payload: () => ({ email: USERS.newcomer.email, version: "2026-10-23" }), allowed: NOBODY, match: (p) => ({ email: p.email as string }) }],
    update: [{ name: "member's acceptance", make: async () => ({ email: USERS.member.email }), patch: () => ({ version: "2000-01-01" }), allowed: NOBODY }],
    delete: [{ name: "member's acceptance", make: async () => ({ email: USERS.signout.email }), allowed: NOBODY }],
  },
  ...(["fake_directory_members", "fake_chat_spaces", "fake_chat_members", "fake_chat_messages", "fake_drive_files"] as const).map(
    (table): Spec => ({
      table,
      select: [],
      insert: [{ payload: () => ({}), allowed: NOBODY, match: () => ({}) }],
      update: [],
      delete: [],
    })
  ),
];

const SPECS: Spec[] = [...FOUNDATION, ...SPECS_EXTRA];

let world: World;
beforeAll(async () => {
  world = await buildWorld();
});
afterAll(async () => {
  await cleanupExtra();
  await admin.from("role_members").delete().like("email", "rlstest-%");
  await admin.from("activity_log").delete().in("action", ["test", "t", "changed", "forged"]);
  await admin.from("jobs").delete().like("idempotency_key", "rls.%");
  await admin.from("events").delete().in("title", ["RLS assignment", "New", "Del"]);
  await admin.from("app_settings").delete().like("key", "zzrls%");
  await admin.from("planning_cycles").delete().gte("month", "3000-01-01");
  await destroyWorld(world);
});

async function visible(role: Role, table: Table, match: Match) {
  const c = await clientFor(role);
  const { data, error } = await c.from(table).select("*").match(match);
  return !error && (data?.length ?? 0) > 0;
}

describe.each(SPECS.map((s) => [s.table, s] as const))("%s", (_table, spec) => {
  for (const row of spec.select) {
    it.each(ROLES.map((r) => [r, row.allowed.includes(r)] as const))(`select ${row.name}: %s → %s`, async (role, allowed) => {
      const match = await row.make(world);
      expect(await visible(role, spec.table, match)).toBe(allowed);
    });
  }

  for (const [i, ins] of spec.insert.entries()) {
    it.each(ROLES.map((r) => [r, ins.allowed.includes(r)] as const))(`insert${ins.name ? ` ${ins.name}` : i ? ` #${i}` : ""}: %s → %s`, async (role, allowed) => {
      const payload = await ins.payload(world, role);
      const c = await clientFor(role);
      const { error } = await c.from(spec.table).insert(payload as never);
      if (!error && Object.keys(payload).length) await admin.from(spec.table).delete().match(ins.match(payload));
      expect(!error).toBe(allowed);
    });
  }

  for (const up of spec.update) {
    it.each(ROLES.map((r) => [r, up.allowed.includes(r)] as const))(`update ${up.name}: %s → %s`, async (role, allowed) => {
      const match = await up.make(world);
      const c = await clientFor(role);
      const { error, count } = await c.from(spec.table).update(up.patch(world) as never, { count: "exact" }).match(match);
      expect(!error && count === 1).toBe(allowed);
    });
  }

  for (const del of spec.delete) {
    it.each(ROLES.map((r) => [r, del.allowed.includes(r)] as const))(`delete ${del.name}: %s → %s`, async (role, allowed) => {
      const match = await del.make(world);
      const c = await clientFor(role);
      const { error, count } = await c.from(spec.table).delete({ count: "exact" }).match(match);
      expect(!error && count === 1).toBe(allowed);
    });
  }
});
