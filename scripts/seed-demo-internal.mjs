// Demo data for internal events, office hours, cash boxes, the ledger and
// the leaderboard (round 2026-10-30), used by scripts/seed-demo.mjs: the
// semester around today planned as HR would – office hours every Wednesday,
// Stammtisch every Thursday, Tuesday Talks on the 1st and 3rd Tuesday, the
// executive board on the 1st Monday – with staff, an office hour running now
// (cash box counting), a signed-off one, an event's drinks cash box and
// Finance's ledger. All rows carry created_by = demo@esnmesa.org.

const DEMO = "demo@esnmesa.org";
const DAY = 86_400_000;

const check = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

const berlinDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
/** "2026-11-05" at "19:00" in Berlin as ISO (the offset taken from that day). */
function berlinIso(day, time) {
  const guess = new Date(`${day}T${time}:00Z`);
  const shown = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(guess);
  const [h, m] = shown.split(":").map(Number);
  const [th, tm] = time.split(":").map(Number);
  return new Date(guess.getTime() - ((h * 60 + m) - (th * 60 + tm)) * 60_000).toISOString();
}
/** The current semester: SoSe April–September, WiSe October–March. */
function semester(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (m >= 4 && m <= 9) return { from: `${y}-04-01`, to: `${y}-09-30` };
  const start = m >= 10 ? y : y - 1;
  return { from: `${start}-10-01`, to: `${start + 1}-03-31` };
}
/** Days from `from` to `to` on `weekday` (0 = Monday), optionally only the nth of each month. */
function days(from, to, weekday, nth = null) {
  const out = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += DAY) {
    const d = new Date(t);
    if ((d.getUTCDay() + 6) % 7 !== weekday) continue;
    const n = Math.ceil(d.getUTCDate() / 7);
    if (nth && !nth.includes(n)) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function wipeInternal(db, eventIds) {
  const internal = check(await db.from("internal_events").select("id").eq("created_by", DEMO), "internal events").map((e) => e.id);
  if (internal.length) {
    check(await db.from("finance_entries").delete().in("internal_event_id", internal), "internal ledger");
    check(await db.from("cash_reports").delete().in("internal_event_id", internal), "internal cash boxes");
    check(await db.from("internal_events").delete().in("id", internal), "delete internal events");
  }
  check(await db.from("finance_entries").delete().eq("created_by", DEMO), "demo ledger");
  if (eventIds.length) {
    check(await db.from("finance_entries").delete().in("event_id", eventIds), "event ledger");
    check(await db.from("cash_reports").delete().in("event_id", eventIds), "event cash boxes");
  }
}

export async function seedInternal(db, U, { crawl, alps, games }) {
  const today = berlinDay(new Date().toISOString());
  const sem = semester(today);
  const series = () => crypto.randomUUID();
  const { data: kinds } = await db.from("internal_kind_settings").select("kind, default_title, default_start, default_minutes, helpers_needed");
  const kindOf = Object.fromEntries((kinds ?? []).map((k) => [k.kind, k]));
  const plan = (kind, list, extra = {}) => {
    const k = kindOf[kind];
    const id = series();
    return list.map((day) => {
      const starts = berlinIso(day, (extra.time ?? k.default_start).slice(0, 5));
      return {
        kind,
        title: extra.title ?? k.default_title,
        starts_at: starts,
        ends_at: new Date(Date.parse(starts) + (extra.minutes ?? k.default_minutes) * 60_000).toISOString(),
        location: extra.location ?? "",
        note: extra.note ?? "",
        presentation_url: extra.presentation_url ?? null,
        helpers_needed: kind === "office_hour" || kind === "stammtisch" ? k.helpers_needed : 0,
        series_id: id,
        created_by: DEMO,
      };
    });
  };
  // Office hours: every Wednesday, plus one running now (so the cash box can be tried).
  const now = Date.now();
  const rows = [
    ...plan("office_hour", days(sem.from, sem.to, 2), { location: "ESN office, Leopoldstraße 15" }),
    ...plan("stammtisch", days(sem.from, sem.to, 3), { location: "Café Kosmos" }),
    ...plan("tuesday_talk", days(sem.from, sem.to, 1, [1, 3]), { presentation_url: "https://docs.google.com/presentation/d/demo-tuesday-talk" }),
    ...plan("board_meeting", days(sem.from, sem.to, 0, [1]), { location: "ESN office", presentation_url: "https://docs.google.com/presentation/d/demo-board" }),
    {
      kind: "internal",
      title: "Team bowling",
      starts_at: berlinIso(berlinDay(new Date(now + 8 * DAY).toISOString()), "19:30"),
      ends_at: null,
      location: "Bowling Arena Nord",
      note: "Just for fun – we pay the first round.",
      capacity: 12,
      created_by: DEMO,
    },
    {
      kind: "office_hour",
      title: "Office hour",
      starts_at: new Date(now - 30 * 60_000).toISOString(),
      ends_at: new Date(now + 90 * 60_000).toISOString(),
      location: "ESN office, Leopoldstraße 15",
      helpers_needed: 1,
      created_by: DEMO,
    },
  ];
  // A bulk insert sends every column of any row: give all rows the same keys.
  const full = rows.map((r) => ({ ends_at: null, location: "", note: "", presentation_url: null, capacity: null, helpers_needed: 0, series_id: null, ...r }));
  const inserted = check(await db.from("internal_events").insert(full).select("id, kind, starts_at, title"), "internal events");
  const byKind = (kind) => inserted.filter((r) => r.kind === kind).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const people = [];
  const staff = (id, oc, helpers) => {
    people.push({ internal_event_id: id, profile_id: oc, role: "oc" });
    for (const h of helpers) people.push({ internal_event_id: id, profile_id: h, role: "helper" });
  };
  const office = byKind("office_hour");
  const past = office.filter((r) => Date.parse(r.starts_at) < now - 3 * 3_600_000);
  const nowOffice = office.find((r) => Math.abs(Date.parse(r.starts_at) - (now - 30 * 60_000)) < 60_000);
  const coming = office.filter((r) => Date.parse(r.starts_at) > now);
  const crew = [U.volunteer1, U.volunteer2, U.member, U.helper];
  past.forEach((r, i) => staff(r.id, crew[i % crew.length], [crew[(i + 1) % crew.length]]));
  staff(nowOffice.id, U.oc, [U.helper]);
  coming.slice(0, 3).forEach((r, i) => staff(r.id, i === 0 ? U.oc : crew[i], i === 1 ? [] : [U.volunteer2]));
  const stammtisch = byKind("stammtisch").filter((r) => Date.parse(r.starts_at) > now);
  stammtisch.slice(0, 2).forEach((r, i) => staff(r.id, i ? U.volunteer1 : U.member, i ? [] : [U.volunteer2]));
  const bowling = byKind("internal")[0];
  people.push({ internal_event_id: bowling.id, profile_id: U.member, role: "attendee" }, { internal_event_id: bowling.id, profile_id: U.volunteer2, role: "attendee" });
  check(await db.from("internal_event_people").insert(people), "internal people");

  // ESNcard prices (only if Finance has not set them).
  const { data: prices } = await db.from("app_settings").select("key").in("key", ["esncard_price_internal_cents", "esncard_price_external_cents"]);
  if (!prices?.length) {
    check(await db.from("app_settings").insert([{ key: "esncard_price_internal_cents", value: 1000 }, { key: "esncard_price_external_cents", value: 1500 }]), "ESNcard prices");
  }
  // The office hour running now: counted at the start, cards being sold.
  check(await db.from("cash_reports").insert({ internal_event_id: nowOffice.id, opening_counts: { 2000: 1, 1000: 2, 200: 5 }, opening_cents: 5000, opening_counted_at: new Date(now - 25 * 60_000).toISOString(), opening_counted_by: "oc@esnmesa.org", esncards_internal: 2, esncards_external: 1, card_price_internal_cents: 1000, card_price_external_cents: 1500, created_by: "oc@esnmesa.org" }), "cash box now");
  // The last office hour: signed off (€ 5 short), waiting for Finance.
  const last = past.at(-1);
  if (last) {
    check(await db.from("cash_reports").insert({ internal_event_id: last.id, opening_counts: { 2000: 1, 1000: 2, 200: 5 }, opening_cents: 5000, opening_counted_at: last.starts_at, opening_counted_by: "volunteer1@esnmesa.org", closing_counts: { 5000: 2, 2000: 1, 1000: 1, 500: 1, 200: 5 }, closing_cents: 14500, closing_counted_at: last.starts_at, closing_counted_by: "volunteer1@esnmesa.org", esncards_internal: 3, esncards_external: 5, card_price_internal_cents: 1000, card_price_external_cents: 1500, note: "", closed_at: last.starts_at, closed_by: "volunteer1@esnmesa.org", created_by: "volunteer1@esnmesa.org" }), "cash box last");
  }
  // The pub crawl sold shots at the start: signed off by the OC.
  check(await db.from("cash_reports").insert({ event_id: crawl, opening_counts: { 1000: 3 }, opening_cents: 3000, opening_counted_by: "helper@esnmesa.org", opening_counted_at: new Date(now - 6 * DAY).toISOString(), closing_counts: { 1000: 3, 500: 4, 200: 6 }, closing_cents: 6200, closing_counted_by: "oc@esnmesa.org", closing_counted_at: new Date(now - 6 * DAY).toISOString(), note: "32 shots at € 1", closed_at: new Date(now - 6 * DAY).toISOString(), closed_by: "oc@esnmesa.org", created_by: "helper@esnmesa.org" }), "crawl cash box");

  // Finance's ledger: merch, the weekend trip's ticket sales and bus, office supplies, the board game night's sponsor.
  const cats = Object.fromEntries(check(await db.from("finance_categories").select("id, name"), "categories").map((c) => [c.name, c.id]));
  const dayAgo = (n) => berlinDay(new Date(now - n * DAY).toISOString());
  check(
    await db.from("finance_entries").insert(
      ([
      { direction: "expense", category_id: cats["Merchandise"], amount_cents: 45000, booked_on: dayAgo(12), description: "60 MESA hoodies", counterparty: "Spreadshirt", payment_method: "bank", beleg_ref: "2026-031", beleg_received: true, created_by: DEMO },
      { direction: "income", category_id: cats["Event revenue"], event_id: alps, amount_cents: 186000, booked_on: dayAgo(9), description: "Ticket sales (31 × € 60)", counterparty: "pretix", payment_method: "bank", created_by: DEMO },
      { direction: "expense", category_id: cats["Event costs"], event_id: alps, amount_cents: 98000, booked_on: dayAgo(7), description: "Bus rental", counterparty: "Busreisen Huber", payment_method: "bank", beleg_ref: "2026-034", beleg_received: false, created_by: DEMO },
      { direction: "expense", category_id: cats["Office and supplies"], amount_cents: 2390, booked_on: dayAgo(4), description: "Printer paper and name badges", counterparty: "Müller", payment_method: "bank", beleg_ref: "2026-035", beleg_received: true, created_by: DEMO },
      { direction: "income", category_id: cats["Sponsoring and grants"], event_id: games, amount_cents: 15000, booked_on: dayAgo(21), description: "Games café sponsoring", counterparty: "Spielwiese", payment_method: "bank", created_by: DEMO },
      ]).map((e) => ({ event_id: null, counterparty: "", beleg_ref: "", beleg_received: false, note: "", ...e }))
    ),
    "ledger"
  );

  // A newbie (the newbies group) for the leaderboard, who helped at the board game night.
  check(await db.from("assignments").insert({ event_id: games, profile_id: U.volunteer2, role: "helper", source: "replacement" }), "newbie helper");
  await db.from("role_members").upsert({ email: "volunteer2@esnmesa.org", role: "newbie", source: "manual" }, { onConflict: "email,role,source", ignoreDuplicates: true });

  return { officeNow: nowOffice.id, semester: sem };
}
