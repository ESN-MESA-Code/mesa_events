// RLS matrix cases of internal events, cash boxes, the ledger and calendar
// feeds (round 2026-10-30; the boxes themselves 2026-10-31): HR and the Vice President plan; board meetings
// only for the executive board; cash boxes for their staff, Finance,
// executives (and Events / the planners); the ledger for Finance and
// executives; feeds for their owner; event categories and formats for every
// member to read and the Events team to keep (round 2026-11-01). See
// rls-matrix.test.ts.
import crypto from "node:crypto";
import { TEST_TAG, USERS, admin } from "../helpers/local";
import { MEMBERS, NOBODY, PLANNERS, ROLE_USER, type Role, type World } from "./world";
import { insertRow } from "./rls-specs";
import type { Match, Spec } from "./rls-matrix.test";

const uid = () => crypto.randomUUID();
const userOf = (role: Role) => (role === "anon" ? USERS.member : ROLE_USER[role]);
const FINANCE_READ: Role[] = ["finance", "treasurer", "executive"];
const FINANCE: Role[] = ["finance", "treasurer"];

const internalOf = (kind: string) => insertRow("internal_events", { kind, title: "RLS internal", starts_at: "2999-01-05T18:00:00Z", created_by: TEST_TAG });
async function attendeeOf(): Promise<Match> {
  const ev = await internalOf("internal");
  return insertRow("internal_event_people", { internal_event_id: ev.id, profile_id: USERS.member.id, role: "attendee" });
}
async function staffOf(): Promise<Match> {
  const ev = await internalOf("stammtisch");
  return insertRow("internal_event_people", { internal_event_id: ev.id, profile_id: USERS.volunteer1.id, role: "helper" });
}
// A member checked in to a Tuesday Talk (round 2026-11-03 (2)).
async function checkInOf(): Promise<Match> {
  const ev = await internalOf("tuesday_talk");
  await admin.from("internal_attendance").insert({ internal_event_id: ev.id as string, profile_id: USERS.member.id, via: "hr", added_by: "hr@esnmesa.org" });
  return { internal_event_id: ev.id as string, profile_id: USERS.member.id };
}
async function eventBox(w: World): Promise<Match> {
  const { data } = await admin.from("cash_reports").select("id").eq("event_id", w.eventA.id).maybeSingle();
  return data ? { id: data.id } : insertRow("cash_reports", { event_id: w.eventA.id });
}
async function officeBox(): Promise<Match> {
  const ev = await internalOf("office_hour");
  await admin.from("internal_event_people").insert({ internal_event_id: ev.id as string, profile_id: USERS.volunteer1.id, role: "oc" });
  return insertRow("cash_reports", { internal_event_id: ev.id });
}
// A physical cash box of the tests (round 2026-10-31), and a change of it.
const boxOf = () => insertRow("cash_boxes", { name: `RLS box ${uid()}`, created_by: TEST_TAG });
async function boxChangeOf(): Promise<Match> {
  const box = await boxOf();
  return insertRow("cash_box_changes", { box_id: box.id, kind: "in", counts: { "200": 1 }, cents_before: 0, cents_after: 200 });
}
const category = () => insertRow("finance_categories", { direction: "expense", name: `RLS ${uid()}` });
const eventCategory = () => insertRow("event_categories", { name: `RLS ${uid()}` });
const eventFormat = () => insertRow("event_formats", { name: `RLS ${uid()}` });
async function entryOf(): Promise<Match> {
  const cat = await category();
  return insertRow("finance_entries", { direction: "expense", category_id: cat.id, amount_cents: 100, booked_on: "2999-01-05", description: "RLS", created_by: TEST_TAG });
}
async function feedOf(): Promise<Match> {
  await admin.from("calendar_feeds").upsert({ profile_id: USERS.member.id, token_hash: crypto.randomBytes(32).toString("hex"), token_prefix: "mesa_cal_RLS" });
  return { profile_id: USERS.member.id };
}

export const SPECS_INTERNAL: Spec[] = [
  {
    table: "event_categories",
    select: [{ name: "a category", make: () => eventCategory(), allowed: MEMBERS }],
    insert: [{ payload: () => ({ id: uid(), name: `RLS ${uid()}` }), allowed: ["events"], match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "a category", make: () => eventCategory(), patch: () => ({ active: false }), allowed: ["events"] }],
    delete: [{ name: "a category", make: () => eventCategory(), allowed: NOBODY }],
  },
  {
    table: "event_formats",
    select: [{ name: "a format", make: () => eventFormat(), allowed: MEMBERS }],
    insert: [{ payload: () => ({ id: uid(), name: `RLS ${uid()}` }), allowed: ["events"], match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "a format", make: () => eventFormat(), patch: () => ({ helpers_needed: 3 }), allowed: ["events"] }],
    delete: [{ name: "a format", make: () => eventFormat(), allowed: NOBODY }],
  },
  {
    table: "internal_kind_settings",
    select: [{ name: "office hour defaults", make: async () => ({ kind: "office_hour" }), allowed: MEMBERS }],
    insert: [{ payload: () => ({ kind: "internal", default_title: "x", default_start: "10:00", default_minutes: 60 }), allowed: NOBODY, match: () => ({ default_title: "x" }) }],
    update: [{ name: "Tuesday Talk defaults", make: async () => ({ kind: "tuesday_talk" }), patch: () => ({ helpers_needed: 0 }), allowed: PLANNERS }],
    delete: [{ name: "internal defaults", make: async () => ({ kind: "internal" }), allowed: NOBODY }],
  },
  {
    table: "internal_events",
    select: [
      { name: "a Tuesday Talk", make: () => internalOf("tuesday_talk"), allowed: MEMBERS },
      { name: "an executive board meeting", make: () => internalOf("board_meeting"), allowed: ["executive", ...PLANNERS] },
    ],
    insert: [{ payload: () => ({ id: uid(), kind: "stammtisch", title: "RLS new", starts_at: "2999-01-06T18:00:00Z", created_by: TEST_TAG }), allowed: PLANNERS, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "a Stammtisch", make: () => internalOf("stammtisch"), patch: () => ({ note: "changed" }), allowed: PLANNERS }],
    delete: [{ name: "a Stammtisch", make: () => internalOf("stammtisch"), allowed: PLANNERS }],
  },
  {
    table: "internal_event_people",
    select: [{ name: "member signed up to an internal event", make: () => attendeeOf(), allowed: MEMBERS }],
    insert: [
      {
        name: "OC of a Stammtisch",
        payload: async () => ({ id: uid(), internal_event_id: (await internalOf("stammtisch")).id, profile_id: USERS.member.id, role: "oc" }),
        allowed: PLANNERS,
        match: (p) => ({ id: p.id as string }),
      },
      {
        name: "signing oneself up straight to the table",
        payload: async (_w, role) => ({ id: uid(), internal_event_id: (await internalOf("internal")).id, profile_id: userOf(role).id, role: "attendee" }),
        allowed: PLANNERS,
        match: (p) => ({ id: p.id as string }),
      },
    ],
    update: [{ name: "helper of a Stammtisch", make: () => staffOf(), patch: () => ({ role: "oc" }), allowed: PLANNERS }],
    delete: [{ name: "helper of a Stammtisch", make: () => staffOf(), allowed: PLANNERS }],
  },
  {
    // Written only through the check-in functions; read by the member themself, the planners and the board.
    table: "internal_attendance",
    select: [{ name: "a member's own check-in", make: () => checkInOf(), allowed: ["member", "executive", ...PLANNERS] }],
    insert: [
      {
        name: "checking oneself in straight to the table",
        payload: async (_w, role) => ({ internal_event_id: (await internalOf("tuesday_talk")).id, profile_id: userOf(role).id, via: "qr", added_by: "x" }),
        allowed: NOBODY,
        match: (p) => ({ internal_event_id: p.internal_event_id as string, profile_id: p.profile_id as string }),
      },
    ],
    update: [{ name: "a check-in", make: () => checkInOf(), patch: () => ({ removed_at: new Date().toISOString() }), allowed: NOBODY }],
    delete: [{ name: "a check-in", make: () => checkInOf(), allowed: NOBODY }],
  },
  {
    table: "cash_reports",
    select: [
      { name: "cash box of event A", make: (w) => eventBox(w), allowed: ["oc", "helper", "events", ...FINANCE_READ] },
      { name: "cash box of an office hour", make: () => officeBox(), allowed: [...FINANCE_READ, ...PLANNERS] },
    ],
    insert: [{ payload: (w) => ({ id: uid(), event_id: w.eventB.id }), allowed: NOBODY, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "cash box of event A", make: (w) => eventBox(w), patch: () => ({ closing_cents: 999999 }), allowed: NOBODY }],
    delete: [{ name: "cash box of an office hour", make: () => officeBox(), allowed: NOBODY }],
  },
  {
    table: "cash_boxes",
    select: [{ name: "a cash box", make: () => boxOf(), allowed: MEMBERS }],
    insert: [{ payload: () => ({ id: uid(), name: `RLS box ${uid()}` }), allowed: NOBODY, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "a cash box", make: () => boxOf(), patch: () => ({ cents: 999 }), allowed: NOBODY }],
    delete: [{ name: "a cash box", make: () => boxOf(), allowed: NOBODY }],
  },
  {
    table: "cash_box_changes",
    select: [{ name: "money put into a box", make: () => boxChangeOf(), allowed: FINANCE_READ }],
    insert: [{ payload: async () => ({ id: uid(), box_id: (await boxOf()).id, kind: "in", cents_before: 0, cents_after: 1 }), allowed: NOBODY, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "money put into a box", make: () => boxChangeOf(), patch: () => ({ cents_after: 1 }), allowed: NOBODY }],
    delete: [{ name: "money put into a box", make: () => boxChangeOf(), allowed: NOBODY }],
  },
  {
    table: "finance_categories",
    select: [{ name: "a category", make: () => category(), allowed: FINANCE_READ }],
    insert: [{ payload: () => ({ id: uid(), direction: "income", name: `RLS ${uid()}` }), allowed: FINANCE, match: (p) => ({ id: p.id as string }) }],
    update: [{ name: "a category", make: () => category(), patch: () => ({ active: false }), allowed: FINANCE }],
    delete: [{ name: "a category", make: () => category(), allowed: NOBODY }],
  },
  {
    table: "finance_entries",
    select: [{ name: "an entry", make: () => entryOf(), allowed: FINANCE_READ }],
    insert: [
      {
        payload: async () => ({ id: uid(), direction: "expense", category_id: (await category()).id, amount_cents: 1, booked_on: "2999-01-05", description: "RLS", created_by: TEST_TAG }),
        allowed: FINANCE,
        match: (p) => ({ id: p.id as string }),
      },
    ],
    update: [{ name: "an entry", make: () => entryOf(), patch: () => ({ amount_cents: 2 }), allowed: FINANCE }],
    delete: [{ name: "an entry", make: () => entryOf(), allowed: FINANCE }],
  },
  {
    table: "calendar_feeds",
    select: [{ name: "member's feed", make: () => feedOf(), allowed: ["member"] }],
    insert: [{ payload: (_w, role) => ({ profile_id: userOf(role).id, token_hash: "1".repeat(64), token_prefix: "x" }), allowed: NOBODY, match: (p) => ({ profile_id: p.profile_id as string }) }],
    update: [{ name: "member's feed", make: () => feedOf(), patch: () => ({ token_hash: "2".repeat(64) }), allowed: NOBODY }],
    delete: [{ name: "member's feed", make: () => feedOf(), allowed: NOBODY }],
  },
];

export async function cleanupInternal(w: World) {
  await admin.from("finance_entries").delete().eq("description", "RLS");
  await admin.from("finance_categories").delete().like("name", "RLS %");
  await admin.from("event_categories").delete().like("name", "RLS %");
  await admin.from("event_formats").delete().like("name", "RLS %");
  await admin.from("cash_reports").delete().eq("event_id", w.eventA.id);
  const { data: rows } = await admin.from("internal_events").select("id").in("title", ["RLS internal", "RLS new"]);
  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length) {
    await admin.from("cash_reports").delete().in("internal_event_id", ids);
    await admin.from("internal_events").delete().in("id", ids);
  }
  await admin.from("calendar_feeds").delete().eq("token_prefix", "mesa_cal_RLS");
  await admin.from("cash_boxes").delete().like("name", "RLS box %");
}
