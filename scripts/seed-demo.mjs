// `npm run seed:demo` – a realistic month in the LOCAL database to click
// through: confirmed events around today with Chat spaces requested (each in
// the cycle of the month it takes place in), the following month's volunteer
// form open, ideas for the month after, an event happening now (attendance
// open), a past event ready for hand-in with receipts, Drive photos and an
// event report (ready for ESN Activities), and one three weeks ago that is
// handed in and uploaded to ESN Activities, plus history from the bot's
// Sheet for "Get inspired" on /ideas.
// Run it again to start over: it replaces what it created before (everything
// created_by demo@esnmesa.org, and whatever was added to its cycles). Never
// touches .env.local.
import { createClient } from "@supabase/supabase-js";
import { LOCAL_ENV } from "./local-supabase.mjs";
import { importArchive } from "./bot-archive.mjs";

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
// A cycle's month is the month its events take place in (Berlin): "2026-11-01".
const berlinMonth = (iso) => `${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(new Date(iso))}-01`;
const addMonths = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
/** 19:00 (Berlin winter time) on `day` of `month`. */
const onDay = (month, day, hour = 19) => new Date(`${month.slice(0, 8)}${String(day).padStart(2, "0")}T${String(hour - 1).padStart(2, "0")}:00:00Z`).toISOString();

async function wipe() {
  // Everything in the demo's cycles goes, including events added there by
  // hand while clicking through (they would block deleting the cycles), and
  // demo events outside them.
  const cycles = check(await db.from("planning_cycles").select("id").eq("created_by", DEMO), "cycles").map((c) => c.id);
  const own = check(await db.from("events").select("id").eq("created_by", DEMO), "events").map((e) => e.id);
  const inCycles = cycles.length ? check(await db.from("events").select("id").in("cycle_id", cycles), "cycle events").map((e) => e.id) : [];
  const ids = [...new Set([...own, ...inCycles])];
  if (ids.length) {
    // Their folders in the fake photo drive (with the "uploaded" files).
    const folders = check(await db.from("event_photo_folders").select("folder_id").in("event_id", ids).not("folder_id", "is", null), "photo folders");
    if (folders.length) check(await db.from("fake_drive_folders").delete().in("id", folders.map((f) => f.folder_id)), "delete drive folders");
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

// The fake photo drive (lib/google/fakes.ts DbDriveClient, root
// "fake-photos-root"): <semester>/<yyyy-MM-dd Title> as lib/photos.ts names it.
const berlinDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
function semesterFolder(dateIso) {
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  const yy = (n) => String(n % 100).padStart(2, "0");
  if (m >= 4 && m <= 9) return `SoSe_${yy(y)}`;
  return m >= 10 ? `WiSe_${yy(y)}-${yy(y + 1)}` : `WiSe_${yy(y - 1)}-${yy(y)}`;
}
async function fakeFolder(parent, name) {
  const existing = check(await db.from("fake_drive_folders").select("id").eq("parent_id", parent).eq("name", name).maybeSingle(), "folder lookup");
  if (existing) return existing.id;
  const id = `fakefolder-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  check(await db.from("fake_drive_folders").insert({ id, parent_id: parent, name }), "folder");
  return id;
}
/** The event's folder with `files` photos the team "uploaded", counted. */
async function photoFolder(eventId, startsAt, title, files, countedAt) {
  const date = berlinDay(startsAt);
  const semester = semesterFolder(date);
  const name = `${date} ${title}`;
  const id = await fakeFolder(await fakeFolder("fake-photos-root", semester), name);
  if (files) check(await db.from("fake_drive_files").insert(Array.from({ length: files }, (_, i) => ({ id: `${id}-${i + 1}`, folder_id: id, file_name: `IMG_${4811 + i}.jpg` }))), "photos");
  check(
    await db.from("event_photo_folders").upsert({ event_id: eventId, folder_id: id, folder_url: `https://drive.google.com/drive/folders/${id}`, folder_path: `${semester}/${name}`, photo_count: files, counted_at: countedAt }),
    "photo folder"
  );
}

async function main() {
  const removed = await wipe();

  // The weeks around today: confirmed rosters, Chat spaces requested (pg_cron
  // runs the jobs while dev:local is up). Each event belongs to the cycle of
  // the month it takes place in – near the end of a month that is two cycles.
  const confirmed = new Map();
  const cycleOf = async (iso) => {
    const month = berlinMonth(iso);
    if (!confirmed.has(month)) {
      confirmed.set(month, await cycle(month, "confirmed", { confirmed_at: new Date().toISOString(), confirmed_by: "events@esnmesa.org" }));
    }
    return confirmed.get(month);
  };
  const ev = async (e, staff) => event({ ...e, cycle_id: await cycleOf(e.starts_at) }, staff);
  const quiz = await ev({ title: "Pub Quiz Night", type: "standard", status: "confirmed", starts_at: at(5), helpers_needed: 2, price_cents: 500 }, [[U.oc, "oc"], [U.helper, "helper"], [U.volunteer2, "helper"]]);
  const hike = await ev({ title: "Hike to the Kampenwand", type: "day_trip", status: "understaffed", starts_at: at(9, 8), ends_at: at(9, 18), helpers_needed: 2 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  const museum = await ev({ title: "Museum Night", type: "special", status: "confirmed", starts_at: at(12), helpers_needed: 1, price_cents: 1500 }, [[U.volunteer1, "oc"], [U.member, "helper"]]);
  const alps = await ev({ title: "Weekend in the Alps", type: "weekend_trip", status: "confirmed", starts_at: at(16, 8), ends_at: at(18, 18), helpers_needed: 1 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  for (const id of [quiz, hike, museum, alps]) {
    check(await db.from("events").update({ chat_space_requested_at: new Date().toISOString() }).eq("id", id), "space");
    check(await db.rpc("enqueue_job", { job_kind: "chat.create_space", job_payload: { event_id: id }, key: `chat.create_space:${id}` }), "job");
  }
  // Happening right now: the attendance list is open (QR code, kiosk, live names).
  const cafe = await ev({ title: "Language Café", type: "standard", status: "confirmed", starts_at: new Date(Date.now() + 30 * 60_000).toISOString(), helpers_needed: 1 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  for (const [first_name, last_name, nationality] of [["Giulia", "Rossi", "IT"], ["Lucas", "Martin", "FR"], ["Ana", "García", "ES"]]) {
    check(await db.rpc("sign_in", { event: cafe, first_name, last_name, notice_version: "2026-10-23", terms_version: "2026-10-23", nationality, university: "LMU", exchange_program: "Erasmus+", esn_card: true }), "sign-in");
  }
  const { public_token: cafeToken } = check(await db.from("attendance_lists").select("public_token").eq("event_id", cafe).single(), "token");

  // Last week: done, list signed off, receipts in Finance's queue.
  const crawl = await ev({ title: "Pub Crawl Maxvorstadt", type: "standard", status: "confirmed", starts_at: at(-6, 20), helpers_needed: 1, price_cents: 0 }, [[U.oc, "oc"], [U.helper, "helper"]]);
  check(await db.from("attendance_lists").update({ signed_off_at: at(-5, 12), signed_off_by: "oc@esnmesa.org", headcount: 23 }).eq("event_id", crawl), "sign-off");
  // The team uploaded 14 photos to its Drive folder (fake), counted since.
  await photoFolder(crawl, at(-6, 20), "Pub Crawl Maxvorstadt", 14, at(-4, 10));
  // Published, and the OC wrote the event report: ready for ESN Activities.
  const crawlFields = { title: "Pub Crawl Maxvorstadt", dateIso: at(-6, 20).slice(0, 10), time: "20:00", venue: "Schelling-Salon, Schellingstraße 54, 80799 München", price: "free", hook: "a night out in Maxvorstadt", intro: "Four bars, one evening, lots of new friends. We start at the Schelling-Salon and walk together.", program: "Meet at the Schelling-Salon\nFour bars", bring: "Your ESNcard", closing: "celebrate with you", esnType: "10", esnObjectives: "413,426" };
  check(await db.from("descriptions").upsert({ event_id: crawl, status: "published", published_at: at(-8, 12), published_by: "comms@esnmesa.org", fields: crawlFields, approved_fields: crawlFields }), "crawl description");
  check(await db.from("event_reports").upsert({ event_id: crawl, intl_participants: 20, local_participants: 3, organizers: 2, goals_reached: true, went_well: "Great mood, everyone stayed until the last bar.", could_be_better: "Book the first bar earlier.", created_by: "oc@esnmesa.org", updated_by: "oc@esnmesa.org" }), "crawl report");

  // Three weeks ago: handed in and on ESN Activities.
  const games = await ev({ title: "Board Game Night", type: "standard", status: "completed", starts_at: at(-20, 19), helpers_needed: 1, price_cents: 0 }, [[U.volunteer1, "oc"], [U.member, "helper"]]);
  check(await db.from("attendance_lists").update({ signed_off_at: at(-19, 10), signed_off_by: "volunteer1@esnmesa.org", headcount: 31 }).eq("event_id", games), "games sign-off");
  await photoFolder(games, at(-20, 19), "Board Game Night", 22, at(-18, 10));
  const gamesFields = { title: "Board Game Night", dateIso: at(-20, 19).slice(0, 10), time: "19:00", venue: "Café Gans am Wasser, Siegfriedstraße 24, 80803 München", price: "free", hook: "an evening of board games", intro: "Bring your favourite game or learn a new one. Snacks are on us!", program: "Games for everyone\nSnacks", bring: "A game if you like", closing: "play with you", esnType: "10", esnObjectives: "413,426" };
  check(await db.from("descriptions").upsert({ event_id: games, status: "published", published_at: at(-24, 12), published_by: "comms@esnmesa.org", fields: gamesFields, approved_fields: gamesFields }), "games description");
  check(await db.from("event_reports").upsert({ event_id: games, intl_participants: 27, local_participants: 4, organizers: 2, goals_reached: true, went_well: "Full house, many new faces.", created_by: "volunteer1@esnmesa.org", updated_by: "volunteer1@esnmesa.org" }), "games report");
  check(await db.from("esn_uploads").upsert({ event_id: games, activity_url: "https://activities.esn.org/activity/board-game-night-mesa-12345", via: "manual", uploaded_by: "comms@esnmesa.org", uploaded_at: at(-15, 11) }), "games upload");
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

  // The description deadline lies before each cycle's first event (the
  // database refuses a later one from the app): in three days, or two days
  // before the first event if that is earlier.
  for (const id of confirmed.values()) {
    const first = check(await db.from("events").select("starts_at").eq("cycle_id", id).order("starts_at").limit(1).maybeSingle(), "first event");
    const latest = first ? Date.parse(first.starts_at) - 2 * day : Infinity;
    const deadline = new Date(Math.min(Date.parse(at(3, 20)), latest)).toISOString();
    check(await db.from("planning_cycles").update({ description_deadline: deadline }).eq("id", id).eq("created_by", DEMO), "deadline");
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

  // History from the description bot's Sheet, for "Get inspired" on /ideas
  // (as `npm run import:bot-archive` would bring it in).
  const description = (hook, intro) => `Dear Internationals,\n\nAre you ready for ${hook}? 🎉\n\n${intro}\n\nWe can’t wait to see you there! ✨`;
  const report = (intl, local, positive) => JSON.stringify({ intl, local, coord: 3, reached: true, positive });
  const history = [
    ["2025-10-02", "19:00", "Pub Quiz", "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich", "€ 5.00", description("a night of trivia", "Teams of four battle it out over six rounds. Prizes for the best three teams!"), report(34, 5, "Great mix of teams.")],
    ["2026-02-12", "19:00", "Pub Quiz #2", "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich", "€ 5.00", description("round two of trivia", "The quiz is back, with a music round."), report(28, 3, "Even more teams than last time.")],
    ["2026-06-18", "19:00", "Pub Quiz 2026", "Shamrock Munich, Trautenwolfstraße 6, 80802 Munich", "€ 5.00", description("the summer quiz", "Trivia in the beer garden."), ""],
    ["2025-10-18", "08:00", "Hike to the Herzogstand", "Herzogstand, 82432 Walchensee", "FREE", description("a day in the mountains", "We take the train to Walchensee and hike up together. Views guaranteed."), JSON.stringify({ types: ["9"], intl: 21, local: 2, coord: 2, reached: true, positive: "Sunny and clear." })],
    ["2025-09-27", "11:00", "Oktoberfest together", "Theresienwiese, 80336 München", "FREE", description("the Wiesn", "We meet at the Bavaria statue and find a table together."), report(61, 4, "Huge turnout, everyone found a seat.")],
    ["2026-01-22", "18:30", "International Dinner", "Studentenwohnheim, Kaulbachstraße 49, 80539 München", "€ 3.00", description("food from all over the world", "Everyone brings a dish from home. We share everything."), report(52, 6, "So many dishes!")],
    ["2026-04-16", "18:00", "Bouldering evening", "Boulderwelt München Ost (Hanne-Hiob-Straße 4, 81671 München)", "€ 12.50", description("an evening on the wall", "Beginner-friendly bouldering with rental shoes. Our volunteers show you the basics."), report(17, 1, "Everyone made it to the top of something.")],
    ["2025-12-11", "18:00", "Christmas market walk", "Marienplatz, 80331 München", "FREE", description("Glühwein and lights", "We walk from Marienplatz to the medieval market. Mugs not included."), ""],
  ].map(([date, time, title, venue, price, text, esnData], i) => ({ date, time, title, venue, price, description: text, esnLink: "", esnData, publishedBy: "pr@esnmesa.org", updated: "", eventId: `spaces/DEMOARCHIVE${i}` }));
  const imported = await importArchive(db, history, { createdBy: DEMO });

  // The month after those: the volunteer form is open.
  const formMonth = addMonths([...confirmed.keys()].sort().at(-1), 1);
  // The form closes in four days, and on the month's first day at the latest.
  const formLatest = Date.parse(onDay(formMonth, 1, 24)) - 60_000;
  const next = await cycle(formMonth, "form_open", { form_closes_at: new Date(Math.min(Date.parse(at(4, 23)), formLatest)).toISOString() });
  for (const [title, type, day] of [
    ["Language Café", "standard", 6],
    ["International Dinner", "special", 12],
    ["Day Trip to Salzburg", "day_trip", 19],
  ]) {
    await event({ cycle_id: next, title, type, status: "scheduled", starts_at: onDay(formMonth, day, type === "day_trip" ? 8 : 19), helpers_needed: 2 });
  }

  // And the month after: planning, with ideas waiting.
  const planningMonth = addMonths(formMonth, 1);
  await cycle(planningMonth, "planning");
  const ideaDate = planningMonth.slice(0, 8) + "12";
  check(
    await db.from("event_ideas").insert([
      { title: "[demo] Bouldering evening", proposed_date: ideaDate, pitch: "Beginner-friendly bouldering with rental shoes.", helpers_needed: 2, proposer_id: U.member, wants_to_oc: true },
      { title: "[demo] Karaoke night", proposed_date: ideaDate, pitch: "Sing your heart out!", helpers_needed: 1, proposer_id: U.volunteer1, wants_to_oc: false },
    ]),
    "ideas"
  );

  console.log(`Replaced ${removed} demo events; ${imported.imported} events of history from the bot. Sign in with "Local test sign-in" (npm run dev:local).`);
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
