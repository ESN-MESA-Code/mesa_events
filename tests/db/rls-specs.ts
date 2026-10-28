// RLS matrix cases of the tables added after the foundation (planning,
// chat, descriptions, attendance, reimbursements). See rls-matrix.test.ts.
import crypto from "node:crypto";
import { USERS, admin } from "../helpers/local";
import { MEMBERS, NOBODY, ROLE_USER, TEAM, type Role, type World } from "./world";
import type { Match, Spec } from "./rls-matrix.test";

const uid = () => crypto.randomUUID();
const userOf = (role: Role) => (role === "anon" ? USERS.member : ROLE_USER[role]);

export async function insertRow(table: string, row: Record<string, unknown>, key = "id"): Promise<Match> {
  const { data, error } = await admin.from(table as never).insert(row as never).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return { [key]: (data as Record<string, string>)[key] };
}

const idea = () => insertRow("event_ideas", { title: "RLS idea", proposed_date: "2027-01-10", proposer_id: USERS.member.id });

async function response(w: World): Promise<string> {
  const { data } = await admin.from("volunteer_responses").select("id").eq("cycle_id", w.cycle.id).eq("profile_id", USERS.member.id).maybeSingle();
  if (data) return data.id;
  return (await insertRow("volunteer_responses", { cycle_id: w.cycle.id, profile_id: USERS.member.id })).id as string;
}

async function choice(w: World): Promise<Match> {
  const response_id = await response(w);
  await admin.from("volunteer_choices").upsert({ response_id, event_id: w.eventA.id, helper_rank: 1 });
  return { response_id, event_id: w.eventA.id };
}

export const SPECS_EXTRA: Spec[] = [
  {
    table: "event_ideas",
    select: [{ name: "member's idea", make: () => idea(), allowed: ["member", ...TEAM] }],
    insert: [
      {
        name: "own idea",
        payload: (_w, role) => ({ id: uid(), title: "RLS new idea", proposed_date: "2027-01-11", proposer_id: userOf(role).id }),
        allowed: MEMBERS,
        match: (p) => ({ id: p.id as string }),
      },
      {
        name: "idea in someone else's name",
        payload: () => ({ id: uid(), title: "RLS forged idea", proposed_date: "2027-01-11", proposer_id: USERS.executive.id }),
        allowed: ["executive"],
        match: (p) => ({ id: p.id as string }),
      },
    ],
    update: [
      { name: "pitch of member's open idea", make: () => idea(), patch: () => ({ pitch: "changed" }), allowed: ["member", "events"] },
      { name: "accept member's idea", make: () => idea(), patch: () => ({ status: "rejected" }), allowed: ["events"] },
    ],
    delete: [{ name: "member's open idea", make: () => idea(), allowed: ["member"] }],
  },
  {
    table: "volunteer_responses",
    select: [{ name: "member's response", make: async (w) => ({ id: await response(w) }), allowed: ["member", "events", "executive"] }],
    insert: [{ payload: (w, role) => ({ id: uid(), cycle_id: w.draftCycle.id, profile_id: userOf(role).id }), allowed: NOBODY, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "member's response", make: async (w) => ({ id: await response(w) }), patch: () => ({ note: "x" }), allowed: NOBODY }],
    delete: [{ name: "member's response", make: async (w) => ({ id: await response(w) }), allowed: NOBODY }],
  },
  {
    table: "volunteer_choices",
    select: [{ name: "member's choice", make: (w) => choice(w), allowed: ["member", "events", "executive"] }],
    insert: [{ payload: async (w) => ({ response_id: await response(w), event_id: w.eventB.id, oc_rank: 1 }), allowed: NOBODY, match: (p) => ({ event_id: p.event_id as string, response_id: p.response_id as string }) }],
    update: [{ name: "member's choice", make: (w) => choice(w), patch: () => ({ oc_rank: 3 }), allowed: NOBODY }],
    delete: [{ name: "member's choice", make: (w) => choice(w), allowed: NOBODY }],
  },
];

SPECS_EXTRA.push({
  table: "event_chat_members",
  select: [{ name: "member of A's space", make: async (w) => { await admin.from("event_chat_members").upsert({ event_id: w.eventA.id, email: USERS.oc.email }); return { event_id: w.eventA.id, email: USERS.oc.email }; }, allowed: NOBODY }],
  insert: [{ payload: (w) => ({ event_id: w.eventA.id, email: "intruder@esnmesa.org" }), allowed: NOBODY, match: (p) => ({ email: p.email as string }) }],
  update: [{ name: "member of A's space", make: async (w) => { await admin.from("event_chat_members").upsert({ event_id: w.eventA.id, email: USERS.oc.email }); return { event_id: w.eventA.id, email: USERS.oc.email }; }, patch: () => ({ email: "x@esnmesa.org" }), allowed: NOBODY }],
  delete: [{ name: "member of A's space", make: async (w) => { await admin.from("event_chat_members").upsert({ event_id: w.eventA.id, email: USERS.helper.email }); return { event_id: w.eventA.id, email: USERS.helper.email }; }, allowed: NOBODY }],
});

const STAFF_A: Role[] = [...TEAM, "oc", "helper"];
async function descriptionOf(eventId: string, published = false): Promise<Match> {
  await admin.from("descriptions").upsert({ event_id: eventId, fields: { title: "RLS" }, ...(published ? { status: "published", published_at: new Date().toISOString() } : { status: "draft", published_at: null }) });
  return { event_id: eventId };
}
const versionOf = (eventId: string) => insertRow("description_versions", { event_id: eventId, version: 1, kind: "submitted", fields: {} });
const reviewOf = (eventId: string) => insertRow("reviews", { event_id: eventId, reviewer: USERS.comms.email, decision: "approved", version: 1 });

SPECS_EXTRA.push(
  {
    table: "descriptions",
    select: [
      { name: "draft of event A", make: (w) => descriptionOf(w.eventA.id), allowed: STAFF_A },
      { name: "published description of event B", make: (w) => descriptionOf(w.eventB.id, true), allowed: MEMBERS },
    ],
    insert: [{ payload: (w) => ({ event_id: w.eventD.id, fields: {} }), allowed: NOBODY, match: (p) => ({ event_id: p.event_id as string }) }],
    update: [
      { name: "draft of event A", make: (w) => descriptionOf(w.eventA.id), patch: () => ({ status: "approved" }), allowed: NOBODY },
      { name: "published of event B", make: (w) => descriptionOf(w.eventB.id, true), patch: () => ({ fields: { title: "x" } }), allowed: NOBODY },
    ],
    delete: [{ name: "draft of event A", make: (w) => descriptionOf(w.eventA.id), allowed: NOBODY }],
  },
  {
    table: "description_versions",
    select: [
      { name: "version of event A", make: (w) => versionOf(w.eventA.id), allowed: STAFF_A },
      { name: "version of event B", make: (w) => versionOf(w.eventB.id), allowed: TEAM },
    ],
    insert: [{ payload: (w) => ({ event_id: w.eventA.id, version: 9, kind: "published", fields: {} }), allowed: NOBODY, match: () => ({ version: 9 }) }],
    update: [{ name: "version of event A", make: (w) => versionOf(w.eventA.id), patch: () => ({ text: "forged" }), allowed: NOBODY }],
    delete: [{ name: "version of event A", make: (w) => versionOf(w.eventA.id), allowed: NOBODY }],
  },
  {
    table: "reviews",
    select: [
      { name: "review of event A", make: (w) => reviewOf(w.eventA.id), allowed: STAFF_A },
      { name: "review of event B", make: (w) => reviewOf(w.eventB.id), allowed: TEAM },
    ],
    insert: [{ payload: (w) => ({ id: uid(), event_id: w.eventA.id, reviewer: "x@esnmesa.org", decision: "approved", version: 1 }), allowed: NOBODY, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "review of event A", make: (w) => reviewOf(w.eventA.id), patch: () => ({ decision: "changes_requested" }), allowed: NOBODY }],
    delete: [{ name: "review of event A", make: (w) => reviewOf(w.eventA.id), allowed: NOBODY }],
  }
);

const participantOf = (eventId: string) =>
  insertRow("participants", { event_id: eventId, first_name: "RLS", last_name: "Test", notice_version: "2026-10-23", terms_version: "2026-10-23" });
async function statOf(eventId: string): Promise<Match> {
  await admin.from("event_stats").upsert({ event_id: eventId, question: "esn_card", answer: "yes", total: 1 });
  return { event_id: eventId, question: "esn_card", answer: "yes" };
}

SPECS_EXTRA.push(
  {
    table: "attendance_lists",
    select: [
      { name: "list of event A", make: async (w) => ({ event_id: w.eventA.id }), allowed: STAFF_A },
      { name: "list of event B", make: async (w) => ({ event_id: w.eventB.id }), allowed: TEAM },
    ],
    insert: [{ payload: (w) => ({ event_id: w.eventD.id }), allowed: NOBODY, match: (p) => ({ event_id: p.event_id as string }) }],
    update: [
      { name: "risk notice of event A", make: async (w) => ({ event_id: w.eventA.id }), patch: () => ({ risk_notice: "Careful" }), allowed: ["oc", "helper", "events"] },
      { name: "risk notice of event B", make: async (w) => ({ event_id: w.eventB.id }), patch: () => ({ risk_notice: "Careful" }), allowed: ["events"] },
    ],
    delete: [{ name: "list of event A", make: async (w) => ({ event_id: w.eventA.id }), allowed: NOBODY }],
  },
  {
    table: "participants",
    select: [
      { name: "sign-in at event A (open list)", make: (w) => participantOf(w.eventA.id), allowed: ["oc", "helper", "events", "executive"] },
      { name: "sign-in at event B (open list)", make: (w) => participantOf(w.eventB.id), allowed: ["events", "executive"] },
    ],
    insert: [
      {
        payload: (w) => ({ id: uid(), event_id: w.eventA.id, first_name: "X", last_name: "Y", notice_version: "2026-10-23", terms_version: "2026-10-23" }),
        allowed: NOBODY,
        match: (p) => ({ id: p.id as string }),
      },
    ],
    update: [{ name: "sign-in at event A", make: (w) => participantOf(w.eventA.id), patch: () => ({ first_name: "Changed" }), allowed: NOBODY }],
    delete: [{ name: "sign-in at event A", make: (w) => participantOf(w.eventA.id), allowed: NOBODY }],
  },
  {
    table: "event_stats",
    select: [{ name: "counts of event A", make: (w) => statOf(w.eventA.id), allowed: NOBODY }],
    insert: [{ payload: (w) => ({ event_id: w.eventA.id, question: "nationality", answer: "XX", total: 9 }), allowed: NOBODY, match: () => ({ answer: "XX" }) }],
    update: [{ name: "counts of event A", make: (w) => statOf(w.eventA.id), patch: () => ({ total: 999 }), allowed: NOBODY }],
    delete: [{ name: "counts of event A", make: (w) => statOf(w.eventA.id), allowed: NOBODY }],
  }
);

export async function cleanupExtra() {
  await admin.from("event_ideas").delete().like("title", "RLS%");
}
