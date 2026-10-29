// `npm run clean:test-data` – removes what the DB and E2E suites created in
// the LOCAL database (they share it with `npm run dev:local`), so the dev UI
// shows only the demo and hand-made data (review 2026-10-29 A7). The suites
// call it themselves before and after a run (global setup/teardown).
//
// Test data is recognised by its tag, never guessed:
// * cycles in test months – before 2020 or from 2040 on (no real or demo
//   cycle is there) – with everything in them;
// * events and cycles created by the test helpers
//   (created_by = tests@mesa.invalid), also outside test months;
// * ideas dated in test months.
// Dependent rows go first (claims and receipts block deleting an event),
// with the fake Google rows, jobs and log entries of what is removed; then
// jobs and fake Chat rows of events the tests deleted themselves, and
// payout batches left without claims.
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENV } from "./local-supabase.mjs";

export const TEST_TAG = "tests@mesa.invalid";
export const TEST_MONTHS = { before: "2020-01-01", from: "2040-01-01" };

const check = (res, what) => {
  if (res.error) throw new Error(`clean-test-data, ${what}: ${res.error.message}`);
  return res.data ?? [];
};

const chunks = (list, size = 100) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const berlinDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Deletes every tagged row; returns what was removed. */
export async function removeTestData(db) {
  const inTestMonths = `month.lt.${TEST_MONTHS.before},month.gte.${TEST_MONTHS.from},created_by.eq.${TEST_TAG}`;
  const cycleIds = check(await db.from("planning_cycles").select("id").or(inTestMonths), "cycles").map((c) => c.id);

  const events = new Map();
  for (const e of check(await db.from("events").select("id, title, starts_at, chat_space_name").eq("created_by", TEST_TAG), "tagged events")) events.set(e.id, e);
  for (const part of chunks(cycleIds)) {
    for (const e of check(await db.from("events").select("id, title, starts_at, chat_space_name").in("cycle_id", part), "cycle events")) events.set(e.id, e);
  }
  const eventIds = [...events.keys()];
  const ideaIds = check(
    await db.from("event_ideas").select("id").or(`proposed_date.lt.${TEST_MONTHS.before},proposed_date.gte.${TEST_MONTHS.from}`),
    "ideas"
  ).map((i) => i.id);

  // Fake Google: the events' spaces, direct messages about them, Drive folders.
  const spaces = [...events.values()].map((e) => e.chat_space_name).filter(Boolean);
  const requestIds = eventIds.map((id) => `mesa-event-${id}`);
  for (const part of chunks(spaces)) {
    check(await db.from("fake_chat_messages").delete().in("space", part), "space messages");
    check(await db.from("fake_chat_members").delete().in("space", part), "space members");
    check(await db.from("fake_chat_spaces").delete().in("name", part), "spaces");
  }
  for (const part of chunks(requestIds)) check(await db.from("fake_chat_spaces").delete().in("request_id", part), "requested spaces");
  if (eventIds.length) {
    const dms = check(await db.from("fake_chat_messages").select("name, text").like("space", "dm:%"), "direct messages");
    const about = dms.filter((m) => eventIds.some((id) => m.text.includes(`/events/${id}`))).map((m) => m.name);
    for (const part of chunks(about)) check(await db.from("fake_chat_messages").delete().in("name", part), "delete direct messages");
  }
  const folders = [...events.values()].map((e) => `${berlinDate(e.starts_at)} ${e.title}`);
  for (const part of chunks(folders)) check(await db.from("fake_drive_files").delete().in("folder", part), "drive files");

  for (const part of chunks(eventIds)) {
    check(await db.from("reimbursements").delete().in("event_id", part), "claims");
    check(await db.from("receipts").delete().in("event_id", part), "receipts");
    check(await db.from("jobs").delete().in("event_id", part), "jobs");
    check(await db.from("activity_log").delete().in("event_id", part), "event log");
    check(await db.from("events").delete().in("id", part), "events");
  }
  for (const part of chunks(ideaIds)) {
    check(await db.from("activity_log").delete().eq("entity", "event_ideas").in("entity_id", part), "idea log");
    check(await db.from("event_ideas").delete().in("id", part), "ideas");
  }
  for (const part of chunks(cycleIds)) {
    check(await db.from("activity_log").delete().in("cycle_id", part), "cycle log");
    check(await db.from("planning_cycles").delete().in("id", part), "cycles");
  }

  const orphans = await removeOrphans(db);

  // Batches whose claims were all test claims.
  const used = new Set(check(await db.from("reimbursements").select("batch_id").not("batch_id", "is", null), "batch use").map((r) => r.batch_id));
  const empty = check(await db.from("payout_batches").select("id"), "batches").map((b) => b.id).filter((id) => !used.has(id));
  for (const part of chunks(empty)) check(await db.from("payout_batches").delete().in("id", part), "empty batches");

  return { cycles: cycleIds.length, events: eventIds.length, ideas: ideaIds.length, batches: empty.length, orphans };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Ids of `ids` that are not (any more) in `table`. */
async function missing(db, table, ids) {
  const found = new Set();
  for (const part of chunks([...new Set(ids)])) for (const r of check(await db.from(table).select("id").in("id", part), `${table} lookup`)) found.add(r.id);
  return new Set(ids.filter((id) => !found.has(id)));
}

/**
 * What tests left behind when they deleted their own events: jobs and fake
 * Chat rows of events (and photos) that no longer exist. Useless for any
 * data, so removed whatever made them.
 */
async function removeOrphans(db) {
  const jobs = check(await db.from("jobs").select("id, kind, payload").is("event_id", null).or("kind.like.chat.%,kind.like.drive.%"), "orphan jobs");
  const goneEvents = await missing(db, "events", jobs.map((j) => j.payload?.event_id).filter(Boolean));
  const gonePhotos = await missing(db, "event_photos", jobs.map((j) => j.payload?.photo_id).filter(Boolean));
  const orphanJobs = jobs.filter((j) => goneEvents.has(j.payload?.event_id) || gonePhotos.has(j.payload?.photo_id)).map((j) => j.id);
  for (const part of chunks(orphanJobs)) check(await db.from("jobs").delete().in("id", part), "delete orphan jobs");

  const spaces = check(await db.from("fake_chat_spaces").select("name, request_id").like("request_id", "mesa-event-%"), "fake spaces");
  const goneSpaceEvents = await missing(db, "events", spaces.map((x) => x.request_id.slice("mesa-event-".length)));
  const orphanSpaces = spaces.filter((x) => goneSpaceEvents.has(x.request_id.slice("mesa-event-".length))).map((x) => x.name);
  for (const part of chunks(orphanSpaces)) {
    check(await db.from("fake_chat_messages").delete().in("space", part), "orphan space messages");
    check(await db.from("fake_chat_members").delete().in("space", part), "orphan space members");
    check(await db.from("fake_chat_spaces").delete().in("name", part), "orphan spaces");
  }

  const dms = check(await db.from("fake_chat_messages").select("name, text").like("space", "dm:%"), "direct messages");
  const mentioned = dms.map((m) => ({ name: m.name, ids: [...(m.text.match(/\/events\/[0-9a-f-]{36}/g) ?? [])].map((x) => x.match(UUID)[0]) }));
  const goneDmEvents = await missing(db, "events", mentioned.flatMap((m) => m.ids));
  const orphanDms = mentioned.filter((m) => m.ids.length && m.ids.every((id) => goneDmEvents.has(id))).map((m) => m.name);
  for (const part of chunks(orphanDms)) check(await db.from("fake_chat_messages").delete().in("name", part), "orphan direct messages");

  return orphanJobs.length + orphanSpaces.length + orphanDms.length;
}

// Run directly (no import.meta: Playwright loads this file through its CommonJS transform).
if (/clean-test-data\.mjs$/.test(process.argv[1] ?? "")) {
  const db = createClient(LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL, LOCAL_ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  removeTestData(db)
    .then((n) => console.log(`Removed test data: ${n.cycles} cycles, ${n.events} events, ${n.ideas} ideas, ${n.orphans} orphaned jobs and fake Chat rows, ${n.batches} empty payout batches.`))
    .catch((err) => {
      console.error(err.message ?? err);
      console.error("Is the local stack running? npm run supabase:start");
      process.exit(1);
    });
}
