// The staging demo data (lib/staging/seed.ts) against the local stack: it
// runs twice cleanly, every status the brief lists exists afterwards, the
// demo members can sign in only with their derived password, and the
// database functions behind it refuse anyone but the service role, any
// address but a demo one and – the wipe – any database not marked as a demo
// database. Afterwards the local database is as before (tests/helpers/stagingState.ts).
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANON_KEY, SUPABASE_URL, USERS, admin, anonClient, clientWithToken, signedJwt } from "../helpers/local";
import { LOCAL_SEED, demoState, restoreDemoState, type DemoState } from "../helpers/stagingState";
import { seedStaging, stagingTag, type SeedSummary } from "@/lib/staging/seed";
import { DEMO_PEOPLE, PERSONAS, demoEmail, person } from "@/lib/staging/people";
import { demoPassword } from "@/lib/staging/password";
import { isValidIban } from "@/lib/reimbursement";
import { createClient } from "@supabase/supabase-js";

const TAG = stagingTag("esnmesa.org");
let before: DemoState;
let first: SeedSummary;
let second: SeedSummary;
let eventIds: string[] = [];

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

beforeAll(async () => {
  before = await demoState(admin);
  first = await seedStaging(admin, LOCAL_SEED);
  second = await seedStaging(admin, LOCAL_SEED);
  eventIds = (await rows(admin.from("events").select("id").eq("created_by", TAG).eq("source", "platform"))).map((e) => (e as { id: string }).id);
}, 120_000);

afterAll(async () => {
  await restoreDemoState(admin, before);
}, 120_000);

describe("seed:staging", () => {
  it("runs twice cleanly: the second run replaces the first", async () => {
    expect(second.removed).toBe(first.events + first.history);
    expect(second).toEqual({ ...first, removed: second.removed });
    expect(eventIds.length).toBe(first.events);
    expect(first.events).toBeGreaterThanOrEqual(30);
    const profiles = await rows(admin.from("profiles").select("id").like("email", "%.demo@esnmesa.org"));
    expect(profiles.length).toBe(DEMO_PEOPLE.length);
    // No leftovers from the first run: one space per event that has one, one list each.
    const spaces = await rows(admin.from("events").select("chat_space_name").in("id", eventIds).not("chat_space_name", "is", null));
    const fakeSpaces = await rows(admin.from("fake_chat_spaces").select("name").like("name", "spaces/DEMO%"));
    expect(fakeSpaces.length).toBe(spaces.length);
    const lists = await rows(admin.from("attendance_lists").select("event_id").in("event_id", eventIds));
    expect(lists.length).toBe(eventIds.length);
  });

  it("has every cycle phase: three done months, now, next (adjusting), after (form open)", () => {
    expect(Object.values(first.cycles)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed", "allocated", "form_open"]);
  });

  it("has every event status, a decided and a waiting under-staffed event, a reopenable cancellation", async () => {
    for (const s of ["scheduled", "confirmed", "understaffed", "cancelled", "completed", "dropped"]) expect(first.eventStatuses[s], s).toBeGreaterThan(0);
    const events = await rows(admin.from("events").select("status, starts_at, understaffed_decision, cancelled_at").in("id", eventIds));
    expect(events.some((e) => e.status === "confirmed" && e.understaffed_decision === "run")).toBe(true);
    expect(events.some((e) => e.status === "understaffed" && !e.understaffed_decision)).toBe(true);
    // Reopenable: cancelled and not started yet.
    expect(events.some((e) => e.status === "cancelled" && Date.parse(e.starts_at) > Date.now())).toBe(true);
    // Happening today.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
    expect(events.filter((e) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(e.starts_at)) === today).length).toBeGreaterThanOrEqual(2);
    const types = await rows(admin.from("events").select("type").in("id", eventIds));
    expect(new Set(types.map((t) => t.type))).toEqual(new Set(["standard", "special", "day_trip", "weekend_trip"]));
  });

  it("has ideas in every state", () => {
    for (const s of ["proposed", "accepted", "rejected", "merged"]) expect(first.ideaStatuses[s], s).toBeGreaterThan(0);
  });

  it("has volunteer answers with ranks and times, the allocation with manual moves, drop-outs with reasons and claimed slots", async () => {
    const choices = await rows(admin.from("volunteer_choices").select("oc_rank, helper_rank").in("event_id", eventIds));
    expect(choices.some((c) => c.oc_rank === 1) && choices.some((c) => c.helper_rank === 2) && choices.some((c) => c.helper_rank === 3)).toBe(true);
    const assignments = await rows(admin.from("assignments").select("source, status").in("event_id", eventIds));
    for (const s of ["auto", "manual", "replacement", "proposer"]) expect(assignments.some((a) => a.source === s), s).toBe(true);
    expect(assignments.some((a) => a.status === "dropped_out")).toBe(true);
    const reasons = await rows(admin.from("assignment_drop_reasons").select("reason").in("event_id", eventIds));
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("has descriptions in every stage, late and missed ones", async () => {
    for (const s of ["draft", "changes_requested", "submitted", "approved", "published"]) expect(first.descriptionStages[s], s).toBeGreaterThan(0);
    const reviews = await rows(admin.from("reviews").select("decision, comment").in("event_id", eventIds));
    expect(reviews.some((r) => r.decision === "changes_requested" && r.comment.length > 20)).toBe(true);
    // As the Comms persona sees them.
    const comms = person("sofia");
    const db = await clientWithToken(signedJwt({ sub: comms.id, email: demoEmail(comms, "esnmesa.org") }));
    const overview = await rows(db.rpc("description_overview"));
    const mine = overview.filter((o) => eventIds.includes(o.event_id));
    expect(mine.some((o) => o.status === "missing")).toBe(true);
    expect(mine.some((o) => o.late)).toBe(true);
    expect(mine.some((o) => o.missed)).toBe(true);
  });

  it("has attendance lists, signed off and open", async () => {
    const lists = await rows(admin.from("attendance_lists").select("signed_off_at, headcount").in("event_id", eventIds));
    expect(lists.filter((l) => l.signed_off_at && l.headcount! > 0).length).toBeGreaterThanOrEqual(10);
    const participants = await rows(admin.from("participants").select("entry_method").in("event_id", eventIds));
    expect(participants.length).toBeGreaterThan(300);
    expect(participants.some((p) => p.entry_method === "kiosk")).toBe(true);
    const stats = await rows(admin.from("event_stats").select("question").in("event_id", eventIds));
    expect(new Set(stats.map((s) => s.question)).size).toBe(4);
  });

  it("has the hand-in: Drive folders and photo counts, reports, ESN Activities in every status", async () => {
    const folders = await rows(admin.from("event_photo_folders").select("photo_count").in("event_id", eventIds));
    expect(folders.some((f) => f.photo_count === 0) && folders.some((f) => f.photo_count! > 50)).toBe(true);
    const reports = await rows(admin.from("event_reports").select("event_id").in("event_id", eventIds));
    const uploads = await rows(admin.from("esn_uploads").select("event_id, via").in("event_id", eventIds));
    expect(uploads.some((u) => u.via === "script") && uploads.some((u) => u.via === "manual")).toBe(true);
    // Ready to upload: a report but no upload; not ready: past and no report.
    expect(reports.some((r) => !uploads.some((u) => u.event_id === r.event_id))).toBe(true);
    const past = await rows(admin.from("events").select("id").in("id", eventIds).eq("status", "completed"));
    expect(past.some((e) => !reports.some((r) => r.event_id === e.id))).toBe(true);
  });

  it("has claims in every status, batches paid and open, a pre-approval, trip budgets, an early payout above €100", async () => {
    for (const s of ["not_submitted", "beleg_received", "checked", "paid", "rejected"]) expect(first.claimStatuses[s], s).toBeGreaterThan(0);
    const claims = await rows(admin.from("reimbursements").select("id, status, early_payout, approved_cents, batch_id, payout_method").in("event_id", eventIds));
    expect(claims.some((c) => c.early_payout && c.status === "paid" && c.approved_cents! > 10_000)).toBe(true);
    const batches = await rows(admin.from("payout_batches").select("id, status").in("id", claims.map((c) => c.batch_id).filter(Boolean) as string[]));
    expect(batches.some((b) => b.status === "paid") && batches.some((b) => b.status === "open")).toBe(true);
    const pre = await rows(admin.from("preapprovals").select("status").in("event_id", eventIds));
    expect(new Set(pre.map((p) => p.status))).toEqual(new Set(["requested", "approved", "rejected"]));
    expect((await rows(admin.from("trip_budgets").select("event_id").in("event_id", eventIds))).length).toBeGreaterThanOrEqual(2);
    // Payout details only while open, official example IBANs only.
    const details = await rows(admin.from("payout_details").select("reimbursement_id, iban, paypal_email").in("reimbursement_id", claims.map((c) => c.id)));
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) {
      const claim = claims.find((c) => c.id === d.reimbursement_id)!;
      expect(["paid", "rejected"]).not.toContain(claim.status);
      if (d.iban) expect(isValidIban(d.iban), d.iban).toBe(true);
      if (d.paypal_email) expect(d.paypal_email).toMatch(/@example\.com$/);
    }
  });

  it("has an outbox (Chat spaces, messages, direct messages) and a natural activity log", async () => {
    const messages = await rows(admin.from("fake_chat_messages").select("space, text").or("space.like.spaces/DEMO%,space.like.dm:%.demo@esnmesa.org"));
    expect(messages.some((m) => m.text.includes("Welcome to the space"))).toBe(true);
    expect(messages.some((m) => m.text.includes("<users/all>"))).toBe(true);
    expect(messages.some((m) => m.space.startsWith("dm:"))).toBe(true);
    const log = await rows(admin.from("activity_log").select("actor_email, at").in("event_id", eventIds));
    expect(log.length).toBeGreaterThan(200);
    expect(log.every((l) => Date.parse(l.at) <= Date.now() + 1000)).toBe(true);
    expect(log.filter((l) => l.actor_email?.endsWith(".demo@esnmesa.org")).length).toBeGreaterThan(100);
  });

  it("has a publishing schedule: published, skipped, planned and overdue posts, a bundle, Telegram in the fake", async () => {
    const links = await rows(admin.from("publication_post_events").select("post_id, event_id").in("event_id", eventIds));
    const posts = await rows(admin.from("publication_posts").select("id, channel, status, scheduled_for, link").in("id", [...new Set(links.map((l) => l.post_id))]));
    for (const c of ["telegram", "instagram", "pretix"]) expect(posts.some((p) => p.channel === c), c).toBe(true);
    for (const s of ["planned", "published", "skipped"]) expect(posts.some((p) => p.status === s), s).toBe(true);
    expect(posts.some((p) => p.status === "planned" && Date.parse(p.scheduled_for) < Date.now())).toBe(true);
    expect(posts.some((p) => links.filter((l) => l.post_id === p.id).length > 1)).toBe(true);
    const published = posts.filter((p) => p.channel === "telegram" && p.status === "published");
    const fake = await rows(admin.from("fake_telegram_messages").select("message_id").gte("message_id", 90_000).lte("message_id", 90_999));
    expect(fake.length).toBe(published.length);
    const planned = posts.filter((p) => p.channel === "telegram" && p.status === "planned").map((p) => `telegram.publish_post:${p.id}:1`);
    const jobs = await rows(admin.from("jobs").select("status").in("idempotency_key", planned));
    expect(jobs.length).toBe(planned.length);
  });

  it("has history from the bot archive for \"Get inspired\"", async () => {
    expect(first.history).toBeGreaterThanOrEqual(10);
    const history = await rows(admin.from("events").select("title, status, cycle_id").eq("created_by", TAG).eq("source", "bot_archive"));
    expect(history.length).toBe(first.history);
    expect(history.every((h) => h.status === "completed" && h.cycle_id === null)).toBe(true);
    // The same event in several years: "+N earlier".
    expect(history.filter((h) => h.title === "Pub Quiz Night").length).toBeGreaterThanOrEqual(2);
  });

  it("has a member per role, a newcomer who has not accepted the rules", async () => {
    const roles = await rows(admin.from("role_members").select("role").like("email", "%.demo@esnmesa.org"));
    expect(new Set(roles.map((r) => r.role))).toEqual(new Set(["events", "comms", "finance", "treasurer", "executive", "admin"]));
    const noor = demoEmail(person("noor"), "esnmesa.org");
    expect((await rows(admin.from("organiser_acknowledgements").select("email").eq("email", noor))).length).toBe(0);
  });
});

describe("demo members", () => {
  it("sign in with the derived password only (the seeded local password does not work)", async () => {
    const email = demoEmail(person(PERSONAS.find((p) => p.key === "events")!.person), "esnmesa.org");
    const auth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }).auth;
    expect((await auth.signInWithPassword({ email, password: "local-test-password" })).error).not.toBeNull();
    const ok = await auth.signInWithPassword({ email, password: demoPassword(email, LOCAL_SEED.serviceRoleKey) });
    expect(ok.error).toBeNull();
    expect(ok.data.user?.app_metadata.provider).toBe("google");
  });

  it("can only be created by the service role, and only with demo addresses", async () => {
    const args = (email: string) => ({ user_id: "d5000000-0000-4000-8000-0000000000ff", user_email: email, user_name: "X", user_password: "x".repeat(40) });
    const member = await clientWithToken(signedJwt({ sub: USERS.admin.id, email: USERS.admin.email }));
    expect((await member.rpc("staging_upsert_demo_user", args("someone.demo@esnmesa.org"))).error?.code).toBe("42501");
    expect((await anonClient().rpc("staging_upsert_demo_user", args("someone.demo@esnmesa.org"))).error).not.toBeNull();
    for (const email of ["events@esnmesa.org", "demo@esnmesa.org", "someone.demo@other.org", "someone.demox@esnmesa.org"]) {
      const { error } = await admin.rpc("staging_upsert_demo_user", args(email));
      expect(error?.message, email).toMatch(/Only demo addresses/);
    }
    expect((await admin.rpc("staging_upsert_demo_user", { ...args("someone.demo@esnmesa.org"), user_password: "short" })).error?.message).toMatch(/at least 32/);
  });
});

describe("the wipe (Reset demo data)", () => {
  it("is for the service role only", async () => {
    const member = await clientWithToken(signedJwt({ sub: USERS.admin.id, email: USERS.admin.email }));
    expect((await member.rpc("staging_wipe")).error?.code).toBe("42501");
    expect((await anonClient().rpc("staging_wipe")).error).not.toBeNull();
    expect((await member.rpc("staging_wipe_plan")).error?.code).toBe("42501");
  });

  it("has a decision for every table", async () => {
    const plan = await rows(admin.rpc("staging_wipe_plan"));
    expect(plan.filter((p) => p.action === "unlisted").map((p) => p.table_name)).toEqual([]);
    expect(plan.find((p) => p.table_name === "profiles")?.action).toBe("keep");
    expect(plan.find((p) => p.table_name === "events")?.action).toBe("wipe");
  });

  // Inside a transaction that is rolled back, straight in the database
  // container: nothing is lost on the shared local stack.
  const psql = (sql: string) => spawnSync("docker", ["exec", "-i", "supabase_db_mesa-events", "psql", "-q", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA"], { input: sql, encoding: "utf8" });
  const docker = spawnSync("docker", ["inspect", "supabase_db_mesa-events"], { encoding: "utf8" }).status === 0;

  it.skipIf(!docker)("empties the workflow tables and keeps members (rolled back)", () => {
    const res = psql(`begin;
      set local lock_timeout = '10s';
      select public.staging_wipe() is not null;
      select (select count(*) from public.events) || ',' || (select count(*) from public.jobs) || ',' || (select count(*) from public.profiles where email like '%.demo@esnmesa.org') || ',' || (select count(*) from public.reimbursement_policies) || ',' || (select count(*) from public.role_members where email like '%.demo@esnmesa.org');
      rollback;`);
    expect(res.stderr).toBe("");
    const [, counts] = res.stdout.trim().split("\n");
    const [events, jobs, demoProfiles, policies, demoRoles] = counts!.split(",").map(Number);
    expect([events, jobs, demoRoles]).toEqual([0, 0, 0]);
    expect(demoProfiles).toBe(DEMO_PEOPLE.length);
    expect(policies).toBe(1);
  });

  it.skipIf(!docker)("refuses a database that is not marked as a demo database (rolled back)", () => {
    const res = psql(`begin;
      delete from private.config where key = 'environment';
      select public.staging_wipe();
      rollback;`);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/Not a demo database/);
    const upsert = psql(`begin;
      update private.config set value = 'production' where key = 'environment';
      select public.staging_upsert_demo_user('d5000000-0000-4000-8000-0000000000ff', 'x.demo@esnmesa.org', 'X', repeat('x', 40));
      rollback;`);
    expect(upsert.stderr).toMatch(/Not a demo database/);
  });
});
