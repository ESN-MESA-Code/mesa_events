// Event categories and formats (round 2026-11-01): a format brings its
// category, only the Events team sorts events, accepting an idea keeps its
// category and format, sorting past events in bulk, merging formats, and
// Get inspired returning both.
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TAG, USERS, admin, as, createCycle, createEvent, daysFromNow, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";
import * as F from "@/lib/actions/formats";

const tag = crypto.randomUUID().slice(0, 8);
const name = (s: string) => `Test ${s} ${tag}`;
let hiking: string;
let party: string;
let format: string;
const events: string[] = [];
const cycles: string[] = [];

beforeAll(async () => {
  const { data: cats } = await admin.from("event_categories").select("id, name").in("name", ["Hiking & Outdoors", "Party & Nightlife"]);
  hiking = cats!.find((c) => c.name === "Hiking & Outdoors")!.id;
  party = cats!.find((c) => c.name === "Party & Nightlife")!.id;
  format = (await admin.from("event_formats").insert({ name: name("Partnachklamm hike"), category_id: hiking, type: "day_trip", helpers_needed: 3, location: "Garmisch", meeting_point: "München Hauptbahnhof" }).select("id").single()).data!.id;
});
afterAll(async () => {
  await admin.from("event_ideas").delete().like("title", `%${tag}%`);
  if (events.length) await admin.from("events").delete().in("id", events);
  await admin.from("events").delete().like("title", `%${tag}%`);
  if (cycles.length) await admin.from("planning_cycles").delete().in("id", cycles);
  await admin.from("event_formats").delete().like("name", `%${tag}%`);
});

describe("the seed", () => {
  it("16 categories, every member reads them", async () => {
    const { data } = await (await as(USERS.member)).from("event_categories").select("name, emoji, esn_type").eq("active", true);
    expect(data!.length).toBeGreaterThanOrEqual(16);
    expect(data!.find((c) => c.name === "Rally & Scavenger hunt")).toMatchObject({ emoji: "🧭", esn_type: "10" });
  });
});

describe("a format brings its category", () => {
  it("on insert without a category, and when the format changes", async () => {
    const a = (await admin.from("events").insert({ title: name("run 1"), starts_at: daysFromNow(30), format_id: format }).select("id, category_id").single()).data!;
    events.push(a.id);
    expect(a.category_id).toBe(hiking);
    const b = (await admin.from("events").insert({ title: name("run 2"), starts_at: daysFromNow(31), category_id: party }).select("id").single()).data!;
    events.push(b.id);
    const { data: moved } = await admin.from("events").update({ format_id: format }).eq("id", b.id).select("category_id").single();
    expect(moved!.category_id).toBe(hiking);
    // A category given with the format wins.
    const { data: both } = await admin.from("events").update({ format_id: null, category_id: party }).eq("id", b.id).select("category_id").single();
    expect(both!.category_id).toBe(party);
  });

  it("ideas too", async () => {
    const r = await P.proposeIdea(await actionContext(USERS.member), { title: name("idea"), proposed_date: "2099-06-07", format_id: format });
    if (!r.ok) throw new Error(r.message);
    const { data } = await admin.from("event_ideas").select("category_id, format_id").eq("id", r.data.id).single();
    expect(data).toEqual({ category_id: hiking, format_id: format });
  });
});

describe("only the Events team sorts events", () => {
  it("the OC changes the place, not the category or format", async () => {
    const ev = await createEvent({ title: name("OC event"), oc: USERS.oc });
    events.push(ev.id);
    const oc = await as(USERS.oc);
    expect((await oc.from("events").update({ category_id: party }).eq("id", ev.id)).error?.message).toMatch(/Only the Events team changes the category and format/);
    expect((await oc.from("events").update({ location: "Elsewhere" }).eq("id", ev.id)).error).toBeNull();
    const r = await P.updateEvent(await actionContext(USERS.oc), { id: ev.id, format_id: format });
    expect(r.ok).toBe(false);
    const e = await P.updateEvent(await actionContext(USERS.events), { id: ev.id, format_id: format });
    expect(e.ok).toBe(true);
    expect((await admin.from("events").select("category_id").eq("id", ev.id).single()).data!.category_id).toBe(hiking);
  });

  it("members do not write categories or formats", async () => {
    const r = await F.createFormat(await actionContext(USERS.member), { name: name("nope"), category_id: null, type: "standard", helpers_needed: 2 });
    expect(r.ok).toBe(false);
    expect((await (await as(USERS.member)).from("event_formats").insert({ name: name("nope") })).error).not.toBeNull();
    const sort = await (await as(USERS.member)).rpc("sort_past_events", { items: [] });
    expect(sort.error?.message).toMatch(/Only the Events team/);
  });
});

describe("accepting an idea", () => {
  it("keeps the idea's category and format, and the format's place and meeting point", async () => {
    const cycle = await createCycle({ status: "planning" });
    cycles.push(cycle.id);
    const r = await P.proposeIdea(await actionContext(USERS.member), { title: name("accept me"), proposed_date: `${cycle.month.slice(0, 7)}-10`, format_id: format });
    if (!r.ok) throw new Error(r.message);
    const a = await P.acceptIdea(await actionContext(USERS.events), { idea_id: r.data.id, cycle_id: cycle.id, type: "day_trip", starts_at: `${cycle.month.slice(0, 7)}-10T09:00` });
    if (!a.ok) throw new Error(a.message);
    events.push(a.data.event_id);
    const { data } = await admin.from("events").select("category_id, format_id, location, meeting_point").eq("id", a.data.event_id).single();
    expect(data).toEqual({ category_id: hiking, format_id: format, location: "Garmisch", meeting_point: "München Hauptbahnhof" });
  });

  it("the Events team may pick another category on accepting", async () => {
    const cycle = await createCycle({ status: "planning" });
    cycles.push(cycle.id);
    const r = await P.proposeIdea(await actionContext(USERS.member), { title: name("a party"), proposed_date: `${cycle.month.slice(0, 7)}-11` });
    if (!r.ok) throw new Error(r.message);
    const a = await P.acceptIdea(await actionContext(USERS.events), { idea_id: r.data.id, cycle_id: cycle.id, type: "standard", starts_at: `${cycle.month.slice(0, 7)}-11T20:00`, category_id: party });
    if (!a.ok) throw new Error(a.message);
    events.push(a.data.event_id);
    expect((await admin.from("events").select("category_id, format_id").eq("id", a.data.event_id).single()).data).toEqual({ category_id: party, format_id: null });
  });
});

describe("sorting past events and merging formats", () => {
  it("one call: a new format for a group, a category for one-offs; a known name joins its format", async () => {
    const past: string[] = [];
    for (const t of ["Language Café", "Language Café", "Pub crawl"]) {
      const { data } = await admin.from("events").insert({ title: name(t), starts_at: hoursFromNow(-24 * (past.length + 2)), status: "completed", created_by: TEST_TAG }).select("id").single();
      past.push(data!.id);
    }
    events.push(...past);
    const { data: lang } = await admin.from("event_categories").select("id").eq("name", "Language & Meet-ups").single();
    const r = await F.sortPastEvents(await actionContext(USERS.events), {
      items: [
        { event_ids: past.slice(0, 2), category_id: lang!.id, format_id: null, new_format: { name: name("Language Café"), type: "standard", helpers_needed: 2, location: null } },
        { event_ids: [past[2]], category_id: party, format_id: null, new_format: null },
      ],
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.data.sorted).toBe(3);
    const { data: rows } = await admin.from("events").select("id, category_id, format_id").in("id", past);
    const byId = new Map(rows!.map((e) => [e.id, e]));
    const langFormat = byId.get(past[0])!.format_id;
    expect(langFormat).not.toBeNull();
    expect(byId.get(past[1])).toMatchObject({ format_id: langFormat, category_id: lang!.id });
    expect(byId.get(past[2])).toMatchObject({ format_id: null, category_id: party });
    expect((await admin.from("event_formats").select("category_id").eq("id", langFormat!).single()).data!.category_id).toBe(lang!.id);

    // The same name again (other case) joins the existing format.
    const again = await F.sortPastEvents(await actionContext(USERS.events), { items: [{ event_ids: [past[2]], category_id: null, format_id: null, new_format: { name: name("language café").toLowerCase(), type: "standard", helpers_needed: 2, location: null } }] });
    if (!again.ok) throw new Error(again.message);
    expect((await admin.from("events").select("format_id").eq("id", past[2]).single()).data!.format_id).toBe(langFormat);

    // Merging: the runs move, the old format is hidden.
    const m = await F.mergeFormats(await actionContext(USERS.events), { from: langFormat!, into: format });
    if (!m.ok) throw new Error(m.message);
    expect(m.data.moved).toBe(3);
    expect((await admin.from("event_formats").select("active").eq("id", langFormat!).single()).data!.active).toBe(false);
    expect((await F.mergeFormats(await actionContext(USERS.events), { from: format, into: format })).ok).toBe(false);
  });

  it("Get inspired returns category and format", async () => {
    const ev = await createEvent({ title: name("inspiring"), status: "completed", starts_at: hoursFromNow(-30) });
    events.push(ev.id);
    await admin.from("events").update({ format_id: format }).eq("id", ev.id);
    await admin.from("descriptions").upsert({ event_id: ev.id, status: "published", published_at: new Date().toISOString(), fields: { title: "x" }, approved_fields: { title: name("inspiring") } });
    const { data } = await (await as(USERS.member)).rpc("inspiration_events");
    expect(data!.find((e) => e.event_id === ev.id)).toMatchObject({ category_id: hiking, format_id: format });
  });
});
