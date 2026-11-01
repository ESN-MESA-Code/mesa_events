// "Get inspired" (brief 2026-10-29, D): the bot archive import (history
// events, idempotent, out of every workflow) and inspiration_events() –
// what every member may see of previous events, and nothing more.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TAG, USERS, admin, anonClient, as, createEvent, hoursFromNow } from "../helpers/local";
import { actionContext } from "./actionContext";
import * as P from "@/lib/actions/planning";
import { importArchive, recordsFromFile } from "../../scripts/bot-archive.mjs";

const FIXTURE = "tests/fixtures/bot-archive/WiSe_25-26.csv";
const records = recordsFromFile(FIXTURE, readFileSync(FIXTURE, "utf8"));
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const recent = { date: yesterday, time: "19:00", title: "Archive yesterday", venue: "Somewhere", price: "FREE", description: "", esnLink: "", esnData: "", publishedBy: "", updated: "", eventId: "spaces/TESTARCHIVERECENT" };
const refs = ["spaces/TESTARCHIVEQUIZ1", "spaces/TESTARCHIVEHIKE1", "spaces/TESTARCHIVEQUIZ2", "spaces/TESTARCHIVERECENT"];
let platform: string;
let future: string;

beforeAll(async () => {
  await admin.from("events").delete().in("archive_ref", refs);
  // A platform event that happened, with a list headcount and a photo folder; one still ahead.
  platform = (await createEvent({ title: "Inspiring dinner", status: "completed", starts_at: hoursFromNow(-48), oc: USERS.oc, helpers: [USERS.helper] })).id;
  future = (await createEvent({ title: "Inspiring future", starts_at: hoursFromNow(48), oc: USERS.oc })).id;
  for (const id of [platform, future]) {
    await admin.from("descriptions").upsert({ event_id: id, status: "published", published_at: new Date().toISOString(), fields: { title: "x" }, approved_fields: { title: id === platform ? "Inspiring dinner" : "Inspiring future", hook: "a dinner", intro: "Food from everywhere." } });
  }
  await admin.from("attendance_lists").update({ signed_off_at: new Date().toISOString(), signed_off_by: USERS.oc.email, headcount: 42 }).eq("event_id", platform);
  await admin.from("event_photo_folders").upsert({ event_id: platform, folder_id: "insp", folder_url: "https://drive.google.com/drive/folders/insp", folder_path: "x/y", photo_count: 5 });
});
afterAll(async () => {
  await admin.from("jobs").delete().in("event_id", [platform, future]);
  await admin.from("events").delete().in("archive_ref", refs);
  await admin.from("events").delete().in("id", [platform, future]);
});

describe("import of the bot's Sheet", () => {
  it("imports past rows as history, skips the future, and updates on a second run", async () => {
    const first = await importArchive(admin, [...records, recent], { createdBy: TEST_TAG });
    expect(first).toMatchObject({ imported: 4, updated: 0 });
    expect(first.skipped).toEqual([expect.stringMatching(/not past yet .*Future event/)]);
    const again = await importArchive(admin, [...records, recent], { createdBy: TEST_TAG });
    expect(again).toMatchObject({ imported: 0, updated: 4 });
    const { data: events } = await admin.from("events").select("title, status, cycle_id, source, type, helpers_needed").in("archive_ref", refs).order("starts_at");
    expect(events).toHaveLength(4);
    expect(events!.every((e) => e.status === "completed" && e.cycle_id === null && e.source === "bot_archive" && e.helpers_needed === 0)).toBe(true);
    expect(events!.map((e) => e.type)).toEqual(["standard", "day_trip", "standard", "standard"]);
    const { data: quiz } = await admin.from("events").select("id, descriptions(status, approved_fields), event_reports(intl_participants), esn_uploads(activity_url), assignments(id)").eq("archive_ref", refs[0]).single();
    expect(quiz).toMatchObject({ descriptions: { status: "published", approved_fields: { hook: "a night of trivia" } }, event_reports: { intl_participants: 34 }, esn_uploads: { activity_url: "https://activities.esn.org/activity/pub-quiz-mesa-1111" }, assignments: [] });
  });

  it("history stays out of the workflows: Comms overview, photo jobs, staffing", async () => {
    const { data: rows } = await (await as(USERS.comms)).rpc("description_overview");
    const { data: ids } = await admin.from("events").select("id").in("archive_ref", refs);
    const archived = new Set(ids!.map((e) => e.id));
    expect((rows ?? []).filter((r) => archived.has(r.event_id))).toEqual([]);
    await admin.rpc("schedule_photo_jobs");
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).in("event_id", [...archived]);
    expect(count).toBe(0);
    expect(((await (await as(USERS.member)).rpc("open_slots")).data ?? []).filter((s) => archived.has(s.event_id))).toEqual([]);
  });
});

describe("inspiration_events()", () => {
  it("members see past published events with headcount and photo folder – nothing more", async () => {
    const { data, error } = await (await as(USERS.member)).rpc("inspiration_events");
    expect(error).toBeNull();
    const byTitle = new Map((data ?? []).map((e) => [e.title, e]));
    expect(byTitle.get("Inspiring dinner")).toMatchObject({ headcount: 42, photo_folder_url: "https://drive.google.com/drive/folders/insp", hook: "a dinner", source: "platform", helpers_needed: 2 });
    expect(byTitle.get("Pub Quiz")).toMatchObject({ headcount: 39, source: "bot_archive", helpers_needed: null, venue: "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich" });
    expect(byTitle.has("Inspiring future")).toBe(false);
    expect(Object.keys(byTitle.get("Pub Quiz")!).sort()).toEqual(["category_id", "ends_at", "event_id", "format_id", "headcount", "helpers_needed", "hook", "intro", "photo_folder_url", "price", "source", "starts_at", "title", "type", "venue"]);
    const text = JSON.stringify(data);
    for (const u of [USERS.oc, USERS.helper]) {
      expect(text).not.toContain(u.email);
      expect(text).not.toContain(u.name);
    }
  });

  it("not for visitors or members who have not accepted the rules", async () => {
    expect((await anonClient().rpc("inspiration_events")).error).not.toBeNull();
    expect((await (await as(USERS.newcomer)).rpc("inspiration_events")).data).toEqual([]);
  });

  it("'Propose this again' keeps the type suggestion with the idea", async () => {
    const r = await P.proposeIdea(await actionContext(USERS.member), { title: "Pub Quiz", proposed_date: "2099-11-05", pitch: "Again!", helpers_needed: 2, wants_to_oc: true, type_suggestion: "special" });
    if (!r.ok) throw new Error(r.message);
    const { data } = await admin.from("event_ideas").select("type_suggestion").eq("id", r.data.id).single();
    expect(data!.type_suggestion).toBe("special");
    await admin.from("event_ideas").delete().eq("id", r.data.id);
  });
});
