// `npm run seed:demo` – a realistic month in the LOCAL database to click
// through: a confirmed month with Chat spaces requested, the next month's
// volunteer form open, ideas for the month after, an event happening now
// (attendance open) and a past event ready for hand-in with receipts.
// Run it again to start over: it replaces only what it created before
// (everything created_by demo@esnmesa.org). Never touches .env.local.
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENV } from "./local-supabase.mjs";

const db = createClient(LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL, LOCAL_ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DEMO = "demo@esnmesa.org";
const U = {
  member: "a0000000-0000-4000-8000-000000000001",
  oc: "a0000000-0000-4000-8000-000000000002",
  helper: "a0000000-0000-4000-8000-000000000003",
  volunteer1: "a0000000-0000-4000-8000-00000000000a",
  volunteer2: "a0000000-0000-4000-8000-00000000000b",
};

const check = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
const day = 86_400_000;
const at = (offsetDays, hour = 19) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setUTCHours(hour - 1, 0, 0, 0); // Berlin winter time
  return d.toISOString();
};
const monthStart = (offset) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
};

async function wipe() {
  // Everything in the demo's cycles goes, including events added there by
  // hand while clicking through (they would block deleting the cycles), and
  // demo events outside them.
  const cycles = check(await db.from("planning_cycles").select("id").eq("created_by", DEMO), "cycles").map((c) => c.id);
  const own = check(await db.from("events").select("id").eq("created_by", DEMO), "events").map((e) => e.id);
  const inCycles = cycles.length ? check(await db.from("events").select("id").in("cycle_id", cycles), "cycle events").map((e) => e.id) : [];
  const ids = [...new Set([...own, ...inCycles])];
  if (ids.length) {
    // Finance records keep events from being deleted: remove those first.
    const claims = check(await db.from("reimbursements").select("id, receipt_id").in("event_id", ids), "claims");
    if (claims.length) check(await db.from("reimbursements").delete().in("id", claims.map((c) => c.id)), "delete claims");
    check(await db.from("receipts").delete().in("event_id", ids), "delete receipts");
    check(await db.from("events").delete().in("id", ids), "delete events");
  }
  check(await db.from("event_ideas").delete().like("title", "[demo]%"), "delete ideas");
  if (cycles.length) check(await db.from("planning_cycles").delete().in("id", cycles), "delete cycles");
  return ids.length;
}

async function cycle(month, status, extra = {}) {
  await db.from("planning_cycles").delete().eq("month", month).eq("created_by", DEMO);
  const existing = check(await db.from("planning_cycles").select("id").eq("month", month).maybeSingle(), "cycle lookup");
  if (existing) return existing.id; // a real cycle of that month: use it
  return check(await db.from("planning_cycles").insert({ month, status, created_by: DEMO, ...extra }).select("id").single(), "cycle").id;
}

async function event(e, staff = []) {
  const row = check(await db.from("events").insert({ created_by: DEMO, location: "Munich", ...e }).select("id").single(), `event ${e.title}`);
  if (staff.length) {
    check(await db.from("assignments").insert(staff.map(([profile_id, role]) => ({ event_id: row.id, profile_id, role, source: "auto" }))), "assignments");
  }
  return row.id;
}

async function main() {
  const removed = await wipe();

  // This month: confirmed roster, Chat spaces requested (pg_cron runs the jobs while dev:local is up).
  const now = await cycle(monthStart(0), "confirmed", { description_deadline: at(3, 20), confirmed_at: new Date().toISOString(), confirmed_by: "events@esnmesa.org" });
  const quiz = await event({ cycle_id: now, title: "Pub Quiz Night", type: "standard", status: "confirmed", starts_at: at(5), helpers_needed: 2, price_cents: 500 }, [[U.oc, "oc"], [U.helper, "helper"], [U.volunteer2, "helper"]]);
  const hike = await event({ cycle_id: now, title: "Hike to the Kampenwand", type: "day_trip", status: "understaffed", starts_at: at(9, 8), ends_at: at(9, 18), helpers_needed: 2 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  const museum = await event({ cycle_id: now, title: "Museum Night", type: "special", status: "confirmed", starts_at: at(12), helpers_needed: 1, price_cents: 1500 }, [[U.volunteer1, "oc"], [U.member, "helper"]]);
  const alps = await event({ cycle_id: now, title: "Weekend in the Alps", type: "weekend_trip", status: "confirmed", starts_at: at(16, 8), ends_at: at(18, 18), helpers_needed: 1 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  for (const id of [quiz, hike, museum, alps]) {
    check(await db.from("events").update({ chat_space_requested_at: new Date().toISOString() }).eq("id", id), "space");
    check(await db.rpc("enqueue_job", { job_kind: "chat.create_space", job_payload: { event_id: id }, key: `chat.create_space:${id}` }), "job");
  }
  // Happening right now: the attendance list is open (QR code, kiosk, live names).
  const cafe = await event({ cycle_id: now, title: "Language Café", type: "standard", status: "confirmed", starts_at: new Date(Date.now() + 30 * 60_000).toISOString(), helpers_needed: 1 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  for (const [first_name, last_name, nationality] of [["Giulia", "Rossi", "IT"], ["Lucas", "Martin", "FR"], ["Ana", "García", "ES"]]) {
    check(await db.rpc("sign_in", { event: cafe, first_name, last_name, notice_version: "2026-10-23", terms_version: "2026-10-23", nationality, university: "LMU", exchange_program: "Erasmus+", esn_card: true }), "sign-in");
  }
  const { public_token: cafeToken } = check(await db.from("attendance_lists").select("public_token").eq("event_id", cafe).single(), "token");

  // Last week: done, list signed off, receipts in Finance's queue.
  const crawl = await event({ cycle_id: now, title: "Pub Crawl Maxvorstadt", type: "standard", status: "confirmed", starts_at: at(-6, 20), helpers_needed: 1, price_cents: 0 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  check(await db.from("attendance_lists").update({ signed_off_at: at(-5, 12), signed_off_by: "oc@esnmesa.org", headcount: 23 }).eq("event_id", crawl), "sign-off");
  const { data: v1 } = await db.from("reimbursement_policies").select("id, version").eq("version", 1).single();
  const rules = check(await db.from("reimbursement_rules").select("id, expense_kind, event_type").eq("policy_id", v1.id), "rules");
  const ruleId = (kind, type) => rules.find((r) => r.expense_kind === kind && r.event_type === type).id;
  for (const [claimant, role, kind, type, vendor, amount, suggested, status, payout] of [
    [U.helper, "helper", "ticket", "standard", "Augustiner Keller", 2500, 800, "not_submitted", { iban: "DE89370400440532013000", account_holder: "Hugo Helper" }],
    [U.oc, "oc", "ticket", "standard", "Schelling-Salon", 1400, 1400, "beleg_received", { paypal_email: "olga@example.com" }],
    [U.oc, "oc", "ancillary", "any", "Decorations shop", 3150, 3150, "beleg_received", null],
  ]) {
    const receipt = check(await db.from("receipts").insert({ event_id: crawl, claimant_id: claimant, expense_kind: kind, vendor, amount_cents: amount, purchased_on: at(-6).slice(0, 10), ...(status !== "not_submitted" ? { beleg_received_at: at(-2, 10), beleg_received_by: "finance@esnmesa.org" } : {}) }).select("id").single(), "receipt");
    const claim = check(await db.from("reimbursements").insert({ receipt_id: receipt.id, event_id: crawl, claimant_id: claimant, claimant_role: role, category: kind === "ancillary" ? "ancillary_costs" : "team_costs", policy_id: v1.id, policy_version: 1, rule_id: ruleId(kind, type), suggested_cents: suggested, flags: suggested < amount ? ["capped"] : [], status, payout_method: payout ? (payout.iban ? "bank" : "paypal") : null }).select("id").single(), "claim");
    if (payout) check(await db.from("payout_details").insert({ reimbursement_id: claim.id, ...payout }), "payout");
  }

  // A published description to start templates from.
  check(
    await db.from("descriptions").upsert({
      event_id: museum,
      status: "published",
      published_at: new Date().toISOString(),
      fields: { title: "Museum Night", hook: "a night at the museum", intro: "Explore Munich's museums after dark. Tickets included!", program: "Guided tour\nFree time", bring: "Curiosity 🤓", closing: "see you there!", venue: "Pinakothek", price: "15", time: "19:00", esnType: "438", esnObjectives: "424,426" },
      approved_fields: { title: "Museum Night", hook: "a night at the museum", intro: "Explore Munich's museums after dark. Tickets included!", program: "Guided tour\nFree time", bring: "Curiosity 🤓", closing: "see you there!", venue: "Pinakothek", price: "15", time: "19:00", esnType: "438", esnObjectives: "424,426" },
    }),
    "description"
  );

  // Next month: the volunteer form is open.
  const next = await cycle(monthStart(1), "form_open", { form_closes_at: at(4, 23) });
  for (const [title, type, offset] of [
    ["Language Café", "standard", 35],
    ["International Dinner", "special", 40],
    ["Day Trip to Salzburg", "day_trip", 44],
  ]) {
    await event({ cycle_id: next, title, type, status: "scheduled", starts_at: at(offset), helpers_needed: 2 });
  }

  // The month after: planning, with ideas waiting.
  await cycle(monthStart(2), "planning");
  const ideaDate = monthStart(2).slice(0, 8) + "12";
  check(
    await db.from("event_ideas").insert([
      { title: "[demo] Bouldering evening", proposed_date: ideaDate, pitch: "Beginner-friendly bouldering with rental shoes.", helpers_needed: 2, proposer_id: U.member, wants_to_oc: true },
      { title: "[demo] Karaoke night", proposed_date: ideaDate, pitch: "Sing your heart out!", helpers_needed: 1, proposer_id: U.volunteer1, wants_to_oc: false },
    ]),
    "ideas"
  );

  console.log(`Replaced ${removed} demo events. Sign in with "Local test sign-in" (npm run dev:local).`);
  console.log(`  Quiz:   http://localhost:3000/events/${quiz}`);
  console.log(`  Hike:   http://localhost:3000/events/${hike} (under-staffed)`);
  console.log(`  Alps:   http://localhost:3000/events/${alps}`);
  console.log(`  Crawl:  http://localhost:3000/events/${crawl}/hand-in (receipts; Finance: /team/finance)`);
  console.log(`  Café:   http://localhost:3000/events/${cafe}/attendance (list open)  form: http://localhost:3000/event/${cafeToken}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  console.error("Is the local stack running? npm run supabase:start");
  process.exit(1);
});
