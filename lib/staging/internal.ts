// The staging demo's internal side (round 2026-11-01), called by
// seedStaging() (lib/staging/seed.ts): office hours every Wednesday,
// Stammtisch every Thursday, Tuesday Talks on the 1st and 3rd Tuesday, the
// executive board on the 1st Monday and internal events members sign up to –
// over the seed's six months, with staff, open slots, full and cancelled
// dates. Then the cash boxes with their history (Finance's money in and out,
// a recount, a removed box), cash reports of office hours, Stammtisch and ESN
// events in every state (counting now, counted but not signed off, signed
// off, checked, booked), Finance's ledger, saved payout details, calendar
// links and ESN Activities tokens. removeStagingData() takes it out again.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { addMonths, berlinDate, berlinInputToIso } from "@/lib/dates";
import type { EventKey } from "@/lib/staging/content";
import { EVENTS } from "@/lib/staging/content";

type Db = SupabaseClient<Database>;
type Kind = Database["public"]["Enums"]["internal_kind"];

interface Random {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  uuid(): string;
  hex(n: number): string;
}

/** An ESN event of the seed, as far as the internal side needs it. */
export interface EventRef {
  id: string;
  plan: EventKey;
  title: string;
  startsAt: string;
  endsAt: string | null;
  oc: string | null;
  helpers: string[];
  attendance: number | null;
}

export interface InternalContext {
  rng: Random;
  now: number;
  /** The seed's months: -3 … 2 from the current one ("yyyy-MM-01"). */
  months: Map<number, string>;
  email: (key: string) => string;
  pid: (key: string) => string;
  event: (key: string) => EventRef;
  /** Official example IBANs. */
  ibans: readonly string[];
}

export interface InternalSummary {
  internalEvents: Record<string, number>;
  cashReports: Record<string, number>;
  ledgerEntries: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OFFICE = "ESN office, Leopoldstraße 15, 80802 München";
const KOSMOS = "Café Kosmos, Dachauer Straße 7, 80335 München";
const DENOMINATIONS = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10] as const;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`Staging seed – ${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
const json = (v: unknown) => v as NonNullable<Json>;
const iso = (ms: number) => new Date(ms).toISOString();
const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Notes and coins for an amount, largest first: {"5000": 1, "200": 4}. */
export function cashCounts(cents: number): Record<string, number> {
  const out: Record<string, number> = {};
  let rest = cents;
  for (const d of DENOMINATIONS) {
    const n = Math.floor(rest / d);
    if (n > 0) out[String(d)] = n;
    rest -= n * d;
  }
  return out;
}

/** Days from `from` to `to` on `weekday` (0 = Monday), optionally only the nth of their month. */
function weekdays(from: string, to: string, weekday: number, nth?: number[]): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += DAY) {
    const d = new Date(t);
    if ((d.getUTCDay() + 6) % 7 !== weekday) continue;
    if (nth && !nth.includes(Math.ceil(d.getUTCDate() / 7))) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Christmas break: no office hours, Stammtisch or talks. */
const inBreak = (day: string) => day.slice(5) >= "12-21" || day.slice(5) <= "01-06";

const TALKS = [
  "How the month works: ideas, the volunteer form, the roster",
  "Writing event descriptions people read",
  "Getting your money back: receipts, Belege and claims",
  "Safety at events and first aid basics",
  "ESN Germany and the National Platform",
  "Instagram and Telegram: what works for us",
  "Being an OC on a weekend trip",
  "Inclusion: events everyone can join",
  "ESN Activities and why the reports matter",
  "Planning the summer semester",
  "Conflict at events: what to do",
  "Sustainability at ESN MESA",
];

const BOARD_AGENDA = [
  "Budget of the semester, the summer events' reports, open board positions.",
  "Semester start: welcome week, ESNcard stock, the volunteer kick-off.",
  "Oktoberfest review, National Platform delegates, the Christmas dinner.",
  "Mid-semester check: finances, new members, the winter trips.",
  "Christmas party, handover of the treasury, the summer semester's calendar.",
  "Semester planning, elections at the general assembly.",
];

export async function seedInternalStaging(db: Db, ctx: InternalContext): Promise<InternalSummary> {
  const { rng, now, months, email, pid, event } = ctx;
  const finance = email("priya");
  const treasurer = email("mateo");
  const planner = email("ines");
  const today = berlinDate(iso(now));
  const at = (day: string, time: string) => Date.parse(berlinInputToIso(`${day}T${time}`));
  const monthDay = (k: number, day: number) => `${months.get(k)!.slice(0, 8)}${String(day).padStart(2, "0")}`;
  const from = months.get(-3)!;
  const to = plusDays(addMonths(months.get(2)!, 1), -1);

  // ── Internal events ───────────────────────────────────────────────────────
  const kinds = check(await db.from("internal_kind_settings").select("kind, default_title, default_start, default_minutes, helpers_needed"), "internal kinds");
  const kindOf = new Map(kinds.map((k) => [k.kind, k]));
  type Row = Database["public"]["Tables"]["internal_events"]["Insert"] & { id: string; starts_at: string; kind: Kind; title: string };
  const rows: Row[] = [];
  const add = (kind: Kind, start: number, extra: Partial<Row> & { minutes?: number | null } = {}): Row => {
    const k = kindOf.get(kind)!;
    const { minutes, ...rest } = extra;
    const length = minutes === null ? null : (minutes ?? k.default_minutes);
    const row: Row = {
      id: rng.uuid(),
      kind,
      title: k.default_title,
      starts_at: iso(start),
      ends_at: length === null ? null : iso(start + length * 60_000),
      location: "",
      note: "",
      presentation_url: null,
      capacity: null,
      helpers_needed: kind === "office_hour" || kind === "stammtisch" ? k.helpers_needed : 0,
      status: "scheduled",
      series_id: null,
      created_by: planner,
      created_at: iso(Math.min(now - HOUR, start - 21 * DAY)),
      ...rest,
    };
    rows.push(row);
    return row;
  };
  const series = (kind: Kind, days: string[], extra: (day: string, i: number) => Partial<Row>) => {
    const id = rng.uuid();
    const start = kindOf.get(kind)!.default_start.slice(0, 5);
    return days.filter((d) => !inBreak(d)).map((d, i) => add(kind, at(d, start), { series_id: id, ...extra(d, i) }));
  };

  const officeHours = series("office_hour", weekdays(from, to, 2), () => ({ location: OFFICE }));
  // An extra office hour running right now: the cash box is being counted.
  const officeNow = add("office_hour", Math.floor((now - 30 * 60_000) / 60_000) * 60_000, { location: OFFICE, note: "Extra office hour for the ESNcard rush after the welcome week." });
  const stammtisch = series("stammtisch", weekdays(from, to, 3), () => ({ location: KOSMOS }));
  const talks = series("tuesday_talk", weekdays(from, to, 1, [1, 3]), (_, i) => ({
    title: `Tuesday Talk: ${TALKS[i % TALKS.length]}`,
    location: "Online (Google Meet)",
    presentation_url: `https://docs.google.com/presentation/d/staging-tuesday-talk-${i + 1}`,
  }));
  series("board_meeting", weekdays(from, to, 0, [1]), (d, i) => ({
    location: OFFICE,
    note: `Agenda: ${BOARD_AGENDA[i % BOARD_AGENDA.length]}`,
    presentation_url: `https://docs.google.com/presentation/d/staging-board-${d.slice(0, 7)}`,
  }));

  // One upcoming date of each regular series is cancelled.
  const upcoming = (list: Row[]) => list.filter((r) => Date.parse(r.starts_at) > now + 2 * HOUR);
  const cancelOne = (list: Row[], index: number, note: string) => {
    const r = upcoming(list)[index];
    if (r) Object.assign(r, { status: "cancelled", note });
  };
  cancelOne(officeHours, 3, "No office hour this week – the office is used for the board's workshop.");
  cancelOne(talks, 1, "Moved – the speaker is ill. New date follows.");
  cancelOne(stammtisch, 4, "Café Kosmos is closed for a private party.");

  // Internal events: members sign up themselves.
  const soon = (days: number, time: string) => at(plusDays(today, days), time);
  const kickoff = add("internal", at(monthDay(-1, 8), "19:00"), { title: "Volunteer Kick-off Winter Semester", location: "LMU Hauptgebäude, Hörsaal A 014, Geschwister-Scholl-Platz 1, 80539 München", note: "Who we are, how a month works, how to become an OC. Pizza afterwards.", minutes: 150 });
  const bowling = add("internal", soon(8, "19:30"), { title: "Team Bowling Night", location: "Bowling Arena Nord, Ingolstädter Straße 172, 80939 München", note: "Just for fun – the first round is on us.", capacity: 12, minutes: null });
  const firstAid = add("internal", soon(12, "10:00"), { title: "First Aid Course for Trip Leaders", location: "Malteser Ausbildungszentrum, Streitfeldstraße 1, 81673 München", note: "Required for OCs of day and weekend trips. MESA pays the fee; the certificate is valid for two years.", capacity: 15, minutes: 480 });
  const hike = add("internal", soon(10, "08:30"), { title: "Team Hike to the Wendelstein", location: "München Hauptbahnhof, meeting point at the Starnberger Bahnhof", note: "Cancelled – too much snow on the trail. We try again in spring.", status: "cancelled", capacity: 20, minutes: 600 });
  const dumplings = add("internal", at(monthDay(1, 3), "18:30"), { title: "Dumpling Cooking Night", location: "Shared kitchen, Studentenstadt Freimann, Christoph-Probst-Straße 10, 80805 München", note: "We cook together and eat everything. Bring a container for leftovers.", capacity: 8, minutes: 180 });
  const xmasParty = add("internal", at(monthDay(1, 18), "19:00"), { title: "Volunteer Christmas Party", location: "Import Export, Dachauer Straße 114, 80636 München", note: "Thank you for the semester! Food and the first drinks are on ESN MESA.", capacity: 40, minutes: 300 });
  const brunch = add("internal", at(monthDay(2, 10), "11:00"), { title: "Welcome Back Brunch", location: KOSMOS, note: "First get-together after the break.", minutes: 150 });

  check(await db.from("internal_events").insert(rows), "internal events");

  // ── People ────────────────────────────────────────────────────────────────
  const people: Database["public"]["Tables"]["internal_event_people"]["Insert"][] = [];
  const staff = (r: Row, oc: string | null, helpers: string[]) => {
    const when = iso(Math.min(now - HOUR, Date.parse(r.starts_at) - 10 * DAY));
    if (oc) people.push({ internal_event_id: r.id, profile_id: pid(oc), role: "oc", created_at: when, created_by: planner });
    for (const h of helpers) people.push({ internal_event_id: r.id, profile_id: pid(h), role: "helper", created_at: when, created_by: planner });
  };
  const attend = (r: Row, keys: string[]) => {
    keys.forEach((k, i) => people.push({ internal_event_id: r.id, profile_id: pid(k), role: "attendee", created_at: iso(Math.min(now - HOUR, Date.parse(r.created_at!) + (i + 1) * 5 * HOUR)), created_by: email(k) }));
  };
  const isPast = (r: Row) => Date.parse(r.starts_at) < now - 2 * HOUR;
  const OFFICE_CREW = ["tomasz", "lea", "hiro", "giulia", "pedro", "anna", "chloe", "kwame", "marta", "emil", "felix", "hannah", "zeynep", "rafael"];
  const pair = (crew: string[], i: number): [string, string] => {
    const oc = crew[i % crew.length]!;
    let helper = crew[(i + 1 + rng.int(0, 3)) % crew.length]!;
    if (helper === oc) helper = crew[(i + 5) % crew.length]!;
    return [oc, helper];
  };
  const pastOffice = officeHours.filter(isPast);
  pastOffice.forEach((r, i) => {
    const [oc, helper] = pair(OFFICE_CREW, i);
    staff(r, oc, [helper]);
  });
  staff(officeNow, "hannah", ["hiro"]);
  // Coming office hours: staffed, a helper missing, nobody yet.
  const nextOffice = upcoming(officeHours).filter((r) => r.status === "scheduled");
  if (nextOffice[0]) staff(nextOffice[0], "chloe", ["kwame"]);
  if (nextOffice[1]) staff(nextOffice[1], "tomasz", []);
  if (nextOffice[3]) staff(nextOffice[3], "hiro", ["pedro"]);
  const STAMM_CREW = ["felix", "liam", "sara", "rafael", "giulia", "arjun", "ana"];
  const pastStamm = stammtisch.filter(isPast);
  pastStamm.forEach((r, i) => {
    const [oc, helper] = pair(STAMM_CREW, i);
    staff(r, oc, [helper]);
  });
  const nextStamm = upcoming(stammtisch).filter((r) => r.status === "scheduled");
  if (nextStamm[0]) staff(nextStamm[0], "felix", ["sara"]);
  if (nextStamm[1]) staff(nextStamm[1], "liam", []);
  attend(kickoff, ["hiro", "pedro", "marta", "emil", "hannah", "kwame", "giulia", "liam", "sara", "arjun", "mei", "fatima", "nikos", "ana", "camila", "yusuf", "thanh", "noor"]);
  attend(bowling, ["hannah", "kwame", "giulia", "liam", "sara", "arjun", "hiro", "pedro", "marta", "emil", "mei"]);
  attend(firstAid, ["chloe", "tomasz", "diego", "oskar", "zeynep", "lea"]);
  attend(hike, ["oskar", "emil", "fatima", "nikos", "anna"]);
  attend(dumplings, ["mei", "thanh", "hiro", "kwame", "giulia", "anna", "lea", "camila"]);
  attend(xmasParty, ["chloe", "tomasz", "diego", "kwame", "giulia", "hannah", "lea", "sofia", "amara", "priya", "felix", "liam", "sara", "rafael", "zeynep", "hiro", "pedro", "marta", "emil", "isabel", "ana", "ingrid"]);
  attend(brunch, ["hannah", "lea", "mei"]);
  check(await db.from("internal_event_people").insert(people), "internal people");
  const staffOf = (r: Row) => ({
    oc: people.find((p) => p.internal_event_id === r.id && p.role === "oc")?.profile_id ?? null,
    helper: people.find((p) => p.internal_event_id === r.id && p.role === "helper")?.profile_id ?? null,
  });
  const idToKey = new Map([...OFFICE_CREW, ...STAMM_CREW, "hannah", "hiro"].map((k) => [pid(k), k]));
  const keyOfId = (id: string | null) => (id ? (idToKey.get(id) ?? null) : null);

  // ── ESNcard prices (only if Finance has not set them) ─────────────────────
  const prices = check(await db.from("app_settings").select("key, value").in("key", ["esncard_price_internal_cents", "esncard_price_external_cents"]), "ESNcard prices");
  if (prices.length < 2) {
    check(
      await db.from("app_settings").upsert(
        [
          { key: "esncard_price_internal_cents", value: 1000, updated_by: finance },
          { key: "esncard_price_external_cents", value: 1500, updated_by: finance },
        ],
        { onConflict: "key", ignoreDuplicates: true }
      ),
      "ESNcard prices"
    );
  }
  const priceOf = async (key: string, fallback: number) => {
    const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
    return typeof data?.value === "number" ? data.value : fallback;
  };
  const cardInternal = await priceOf("esncard_price_internal_cents", 1000);
  const cardExternal = await priceOf("esncard_price_external_cents", 1500);

  // ── Cash boxes ────────────────────────────────────────────────────────────
  const defaults = check(await db.from("cash_boxes").select("id, default_for").is("removed_at", null).not("default_for", "is", null), "cash boxes");
  const boxFor = async (kind: "office_hour" | "event", name: string, position: number) => {
    const found = defaults.find((b) => b.default_for === kind);
    if (found) return found.id;
    const id = rng.uuid();
    check(await db.from("cash_boxes").insert({ id, name, default_for: kind, position, created_by: finance }), `cash box ${name}`);
    return id;
  };
  const officeBox = await boxFor("office_hour", "Office hour cash box", 0);
  const eventBox = await boxFor("event", "Events cash box", 1);
  const stammBox = rng.uuid();
  const tinBox = rng.uuid();
  check(
    await db.from("cash_boxes").insert([
      { id: stammBox, name: "Stammtisch float", position: 2, created_by: finance, created_at: iso(at(monthDay(-2, 15), "11:00")) },
      { id: tinBox, name: "Old tin box", position: 3, created_by: finance, created_at: iso(at(monthDay(-3, 1), "10:00")), removed_at: iso(at(monthDay(-3, 20), "16:00")), removed_by: finance },
    ]),
    "extra cash boxes"
  );

  const reports: Database["public"]["Tables"]["cash_reports"]["Insert"][] = [];
  const changes: Database["public"]["Tables"]["cash_box_changes"]["Insert"][] = [];
  const ledger: Database["public"]["Tables"]["finance_entries"]["Insert"][] = [];
  const categories = check(await db.from("finance_categories").select("id, name, direction"), "finance categories");
  const category = (direction: "income" | "expense", name: string) => {
    const c = categories.find((x) => x.direction === direction && x.name === name);
    if (!c) throw new Error(`Staging seed: no finance category "${name}"`);
    return c.id;
  };
  const content = new Map<string, number>([[officeBox, 0], [eventBox, 0], [stammBox, 0], [tinBox, 0]]);
  const change = (box: string, kind: "in" | "out" | "recount" | "report", when: number, after: number, note: string, by: string, report?: string, counts?: Record<string, number>) => {
    if (when > now) return;
    const before = content.get(box)!;
    changes.push({
      id: rng.uuid(), box_id: box, kind, counts: json(counts ?? cashCounts(kind === "in" || kind === "out" ? Math.abs(after - before) : after)),
      cents_before: before, cents_after: after, cash_report_id: report ?? null, note, created_at: iso(when), created_by: by,
    });
    content.set(box, after);
  };

  type ReportState = "counting" | "counted" | "signed_off" | "checked" | "booked";
  interface Counted {
    box: string;
    target: { event_id: string } | { internal_event_id: string };
    start: number;
    end: number;
    oc: string;
    helper: string | null;
    takings: number;
    short?: number;
    cards?: [number, number];
    note: string;
    state: ReportState;
    category: string;
    title: string;
  }
  const count = (c: Counted) => {
    const id = rng.uuid();
    const opening = content.get(c.box)!;
    const closing = opening + c.takings - (c.short ?? 0);
    const counter = c.helper ?? c.oc;
    const closedAt = c.end + 10 * 60_000;
    const checkedAt = Math.min(now - HOUR, closedAt + rng.int(20, 50) * HOUR);
    // A bulk insert sends every column of any row: all rows get the same keys.
    const row: Database["public"]["Tables"]["cash_reports"]["Insert"] = {
      id, cash_box_id: c.box, event_id: null, internal_event_id: null, ...c.target,
      closing_counts: json({}), closing_cents: null, closing_counted_at: null, closing_counted_by: null,
      closed_at: null, closed_by: null, checked_at: null, checked_by: null,
      opening_counts: json(cashCounts(opening)), opening_cents: opening, opening_counted_at: iso(c.start + 5 * 60_000), opening_counted_by: email(counter),
      esncards_internal: c.cards?.[0] ?? 0, esncards_external: c.cards?.[1] ?? 0,
      card_price_internal_cents: c.cards ? cardInternal : null, card_price_external_cents: c.cards ? cardExternal : null,
      note: c.note, created_at: iso(c.start), created_by: email(counter),
    };
    if (c.state !== "counting") {
      Object.assign(row, { closing_counts: json(cashCounts(closing)), closing_cents: closing, closing_counted_at: iso(c.end - 5 * 60_000), closing_counted_by: email(c.oc) });
    }
    if (["signed_off", "checked", "booked"].includes(c.state)) {
      Object.assign(row, { closed_at: iso(closedAt), closed_by: email(c.oc) });
      change(c.box, "report", closedAt, closing, "", email(c.oc), id, cashCounts(closing));
    }
    if (["checked", "booked"].includes(c.state)) Object.assign(row, { checked_at: iso(checkedAt), checked_by: finance });
    if (c.state === "booked" && closing > opening) {
      ledger.push({
        id: rng.uuid(), direction: "income", category_id: c.category, ...("event_id" in c.target ? { event_id: c.target.event_id } : { internal_event_id: c.target.internal_event_id }),
        cash_report_id: id, amount_cents: closing - opening, booked_on: berlinDate(iso(c.start)), description: `Cash box: ${c.title}`.slice(0, 300),
        payment_method: "cash", created_at: iso(checkedAt + HOUR), created_by: finance,
      });
    }
    reports.push(row);
    return { id, state: c.state };
  };
  const reportStates: Record<string, number> = {};
  const tally = (r: { state: ReportState }) => (reportStates[r.state] = (reportStates[r.state] ?? 0) + 1);

  // The removed tin box: emptied into the new office hour box, then removed.
  content.set(tinBox, 1850);
  change(tinBox, "recount", at(monthDay(-3, 1), "10:05"), 1850, "Found in the office cupboard.", finance);
  change(tinBox, "out", at(monthDay(-3, 19), "15:00"), 0, "Emptied – the coins went into the office hour box.", finance);
  change(officeBox, "in", at(monthDay(-3, 19), "15:05"), 1850 + 3150, "Float for the office hour box: the tin box's coins and € 31.50 from the bank.", finance);

  // Office hours: in time order, with Finance's deposits, change and a recount in between.
  const officeIncome = category("income", "ESNcard sales");
  const signedOffice = pastOffice.filter((r) => Date.parse(r.starts_at) > at(monthDay(-3, 19), "16:00"));
  const n = signedOffice.length;
  signedOffice.forEach((r, i) => {
    const start = Date.parse(r.starts_at);
    if (i === Math.floor(n / 3)) change(officeBox, "in", start - 20 * HOUR, content.get(officeBox)! + 2000, "Coins for change: 10 × € 2 from the bank.", finance);
    if (r.starts_at >= `${months.get(-1)!}` && !changes.some((c) => c.kind === "recount" && c.box_id === officeBox)) {
      change(officeBox, "recount", start - 22 * HOUR, content.get(officeBox)! + 200, "Recount at the semester start – € 2 more than the history says.", finance);
    }
    const { oc, helper } = staffOf(r);
    const fromEnd = n - 1 - i;
    // The newest: signed off, waiting for Finance; then checked but not booked; one nobody counted; one € 5 short.
    if (fromEnd === 2) return;
    const state: ReportState = fromEnd === 0 ? "signed_off" : fromEnd === 1 ? "checked" : "booked";
    const cards: [number, number] = [rng.int(0, 4), rng.int(1, 5)];
    const short = fromEnd === 4 ? 500 : 0;
    tally(count({
      box: officeBox, target: { internal_event_id: r.id }, start, end: Date.parse(r.ends_at!), oc: keyOfId(oc)!, helper: keyOfId(helper),
      takings: cards[0] * cardInternal + cards[1] * cardExternal, short, cards,
      note: short ? "€ 5 short – probably wrong change for a € 20 note." : cards[0] + cards[1] > 4 ? "Busy – a queue at the door." : "",
      state, category: officeIncome, title: r.title,
    }));
    if (i % 4 === 3 && content.get(officeBox)! > 6000) change(officeBox, "out", start + 2 * DAY, 5000, "Deposited at the bank (Stadtsparkasse, Leopoldstraße).", finance);
  });
  // Now: the box was counted at the start, cards are being sold.
  tally(count({
    box: officeBox, target: { internal_event_id: officeNow.id }, start: Date.parse(officeNow.starts_at), end: Date.parse(officeNow.ends_at!), oc: "hannah", helper: "hiro",
    takings: 0, cards: [2, 1], note: "", state: "counting", category: officeIncome, title: officeNow.title,
  }));

  // Stammtisch float: two evenings with welcome shots.
  const takingsIncome = category("income", "Cash box takings");
  change(stammBox, "in", at(monthDay(-2, 15), "11:05"), 3000, "Float: 15 × € 2 coins.", finance, undefined, { "200": 15 });
  pastStamm.slice(-2).forEach((r, i) => {
    const { oc, helper } = staffOf(r);
    tally(count({
      box: stammBox, target: { internal_event_id: r.id }, start: Date.parse(r.starts_at), end: Date.parse(r.ends_at!), oc: keyOfId(oc)!, helper: keyOfId(helper),
      takings: (14 + i * 9) * 200, note: `Welcome shots at € 2 (${14 + i * 9} sold).`, state: i === 0 ? "booked" : "signed_off", category: takingsIncome, title: r.title,
    }));
  });

  // ESN events with drinks or snacks from the events box.
  change(eventBox, "in", at(monthDay(-3, 2), "10:00"), 3000, "Float for the events box.", finance);
  const eventCash: Array<[string, number, string, ReportState]> = [
    ["beerGarden", 4600, "46 pretzels at € 1.", "booked"],
    ["potluck", 7800, "Drinks at € 1.50 (52 sold).", "booked"],
    ["welcomeBrunch", 3900, "Coffee and juice at € 1.", "booked"],
    ["pubQuiz", 5400, "Quiz sheets at € 1, 54 players.", "checked"],
    ["karaoke", 2900, "Song requests at € 1 for the charity jar.", "signed_off"],
    ["languageCafePast", 1800, "Cookies at € 1.", "counted"],
    ["languageCafeNow", 0, "", "counting"],
  ];
  for (const [key, takings, note, state] of eventCash) {
    const e = event(key);
    if (!e.oc) continue;
    const start = Date.parse(e.startsAt);
    const end = e.endsAt ? Date.parse(e.endsAt) : start + 3 * HOUR;
    tally(count({ box: eventBox, target: { event_id: e.id }, start, end, oc: e.oc, helper: e.helpers[0] ?? null, takings, note, state, category: takingsIncome, title: e.title }));
    if (key === "welcomeBrunch") change(eventBox, "out", end + 3 * DAY, 3000, "Takings of the summer events deposited at the bank.", finance);
  }

  check(await db.from("cash_reports").insert(reports), "cash reports");
  check(await db.from("cash_box_changes").insert(changes), "cash box changes");
  for (const [box, cents] of content) {
    if (box === tinBox) continue;
    check(await db.from("cash_boxes").update({ counts: json(cashCounts(cents)), cents }).eq("id", box), "cash box content");
  }

  // ── The ledger ────────────────────────────────────────────────────────────
  type Entry = { direction: "income" | "expense"; cat: string; amount: number; when: number; description: string; counterparty?: string; method?: "bank" | "cash" | "paypal" | "card" | "other"; beleg?: string; received?: boolean; note?: string; event?: string };
  const entries: Entry[] = [
    { direction: "income", cat: "Membership fees", amount: 6000, when: at(monthDay(-3, 20), "10:00"), description: "Membership fees summer semester, late payers (6 × € 10)", counterparty: "Members (bank transfer)" },
    { direction: "income", cat: "Membership fees", amount: 38000, when: at(monthDay(-1, 15), "10:00"), description: "Membership fees winter semester (38 × € 10)", counterparty: "Members (bank transfer)" },
    { direction: "income", cat: "Sponsoring and grants", amount: 150000, when: at(monthDay(-1, 3), "10:00"), description: "Erasmus+ grant via the LMU International Office", counterparty: "LMU München", beleg: "Grant letter 2026/17", received: true },
    { direction: "income", cat: "Sponsoring and grants", amount: 15000, when: now - 3 * DAY, description: "Sponsoring of the board game night", counterparty: "Spielwiese Café", event: "boardGames", beleg: "Agreement 2026-11", received: true },
    { direction: "income", cat: "Other income", amount: 23400, when: at(monthDay(-1, 9), "17:00"), description: "Merch sales at the welcome week", counterparty: "Welcome week stand", method: "cash" },
    { direction: "income", cat: "Event revenue", amount: (EVENTS.prague.priceCents ?? 0) * 18, when: now - 2 * DAY, description: "Presale, 18 tickets", counterparty: "pretix", event: "prague", note: "Second payout after the sign-up closes." },
    { direction: "expense", cat: "ESNcards", amount: 62500, when: at(monthDay(-1, 2), "10:00"), description: "250 ESNcards", counterparty: "ESN Germany e.V.", beleg: "ESN-DE-2026-1182", received: true },
    { direction: "expense", cat: "Merchandise", amount: 45000, when: at(monthDay(-2, 12), "10:00"), description: "60 MESA hoodies", counterparty: "Spreadshirt", beleg: "2026-031", received: true },
    { direction: "expense", cat: "Merchandise", amount: 8900, when: at(monthDay(-1, 20), "10:00"), description: "500 stickers", counterparty: "Sticker Mule", method: "card", beleg: "2026-047", received: false, note: "Invoice only as PDF so far – print it for the folder." },
    { direction: "expense", cat: "Office and supplies", amount: 3499, when: at(monthDay(-2, 14), "10:00"), description: "Cash box with coin tray (Stammtisch float)", counterparty: "Amazon", method: "card", beleg: "2026-038", received: true },
    { direction: "expense", cat: "Office and supplies", amount: 2390, when: at(monthDay(-1, 6), "10:00"), description: "Printer paper and name badges", counterparty: "Müller", method: "cash", beleg: "2026-041", received: true },
    { direction: "expense", cat: "Travel and conferences", amount: 26700, when: at(monthDay(-1, 24), "10:00"), description: "National Platform Bonn – trains for 3 delegates", counterparty: "DB Fernverkehr", beleg: "2026-050", received: true, note: "Delegates: Elif, Jonas, Amara." },
    { direction: "expense", cat: "Other spending", amount: 3500, when: at(monthDay(-2, 25), "10:00"), description: "Flowers for the International Office farewell", counterparty: "Blumen Rauch", method: "cash", beleg: "2026-040", received: true },
    { direction: "expense", cat: "Bank and payment fees", amount: 312, when: at(monthDay(-1, 28), "10:00"), description: "PayPal fees of the claim payouts", counterparty: "PayPal", method: "paypal" },
    { direction: "expense", cat: "Event costs", amount: 98400, when: Date.parse(event("neuschwanstein").startsAt) - 7 * DAY, description: "Group train tickets and castle tour", counterparty: "Bayerische Schlösserverwaltung", event: "neuschwanstein", beleg: "2026-028", received: true },
    { direction: "expense", cat: "Event costs", amount: 252000, when: Date.parse(event("constance").startsAt) - 14 * DAY, description: "Hostel Lindau, 3 nights for 28 people", counterparty: "Jugendherberge Lindau", event: "constance", beleg: "2026-030", received: true },
    { direction: "expense", cat: "Event costs", amount: 89000, when: Date.parse(event("salzburg").startsAt) - 10 * DAY, description: "Coach Munich–Salzburg and back", counterparty: "Busreisen Huber", event: "salzburg", beleg: "2026-036", received: true },
    { direction: "expense", cat: "Event costs", amount: 120000, when: Date.parse(event("oktoberfest").startsAt) - 30 * DAY, description: "Table reservation with food vouchers", counterparty: "Festzelt Tradition", event: "oktoberfest", beleg: "2026-039", received: true },
    { direction: "expense", cat: "Event costs", amount: 168000, when: Date.parse(event("vienna").startsAt) - 20 * DAY, description: "Hostel Vienna, group booking", counterparty: "Wombat's City Hostel", event: "vienna", beleg: "2026-043", received: true },
    { direction: "expense", cat: "Event costs", amount: 30800, when: Date.parse(event("bouldering").startsAt), description: "Group entry, 22 people", counterparty: "Boulderwelt München Ost", event: "bouldering", method: "card", received: false, note: "The OC has the card slip – Beleg still missing." },
    { direction: "expense", cat: "Event costs", amount: 95000, when: now - 5 * DAY, description: "Hostel Prague, 50 % deposit", counterparty: "Czech Inn Hostel", event: "prague", received: false, note: "Invoice promised by e-mail – ask again." },
  ];
  // Ticket sales of the paid trips, paid out by pretix a week later.
  for (const key of ["neuschwanstein", "constance", "salzburg", "kampenwand", "oktoberfest", "vienna", "pubQuiz"] as const) {
    const e = event(key);
    const price = EVENTS[e.plan].priceCents ?? 0;
    if (!price || !e.attendance) continue;
    entries.push({ direction: "income", cat: "Event revenue", amount: price * e.attendance, when: Math.min(now - DAY, Date.parse(e.startsAt) + 7 * DAY), description: `Ticket sales (${e.attendance} × € ${(price / 100).toFixed(2)})`, counterparty: "pretix", event: key });
  }
  // The account fee at the end of each month.
  for (const k of [-3, -2, -1, 0]) entries.push({ direction: "expense", cat: "Bank and payment fees", amount: 990, when: at(monthDay(k, 28), "08:00"), description: "Account fee", counterparty: "Stadtsparkasse München", beleg: "Bank statement", received: true });

  for (const e of entries.filter((x) => x.when <= now)) {
    ledger.push({
      id: rng.uuid(), direction: e.direction, category_id: category(e.direction, e.cat), event_id: e.event ? event(e.event).id : null,
      amount_cents: e.amount, booked_on: berlinDate(iso(e.when)), description: e.description, counterparty: e.counterparty ?? "", payment_method: e.method ?? "bank",
      beleg_ref: e.beleg ?? "", beleg_received: e.received ?? false, note: e.note ?? "", created_at: iso(Math.min(now - HOUR, e.when + 2 * HOUR)), created_by: e.direction === "expense" && e.amount > 50000 ? treasurer : finance,
    });
  }
  // A bulk insert sends every column of any row: give all rows the same keys.
  const full = ledger.map((l) => ({ event_id: null, internal_event_id: null, cash_report_id: null, counterparty: "", beleg_ref: "", beleg_received: false, note: "", ...l }));
  check(await db.from("finance_entries").insert(full), "ledger");

  // ── Personal settings: saved payout details, calendar links, ESN tokens ──
  const savedPayouts = [
    { profile_id: pid("chloe"), account_holder: "Chloé Dubois", iban: ctx.ibans[4]!, paypal_email: null },
    { profile_id: pid("diego"), account_holder: "Diego Fernández", iban: ctx.ibans[5]!, paypal_email: null },
    { profile_id: pid("lea"), account_holder: "Léa Fontaine", iban: ctx.ibans[0]!, paypal_email: null },
    { profile_id: pid("kwame"), account_holder: null, iban: null, paypal_email: "kwame.mensah@example.com" },
    { profile_id: pid("tomasz"), account_holder: null, iban: null, paypal_email: "tomasz.nowicki@example.com" },
  ];
  check(await db.from("profile_payout_details").upsert(savedPayouts, { onConflict: "profile_id" }), "saved payout details");
  // As saving in the app does (set_my_payout_details): the saved details reach the member's open claims
  // that have none yet, so no demo claim asks for an IBAN its owner has saved.
  const { data: bare } = await db
    .from("reimbursements")
    .select("id, claimant_id, payout_details(reimbursement_id)")
    .in("claimant_id", savedPayouts.map((p) => p.profile_id))
    .not("status", "in", "(paid,rejected)");
  for (const c of (bare ?? []).filter((x) => !(x.payout_details as unknown as { reimbursement_id: string } | null))) {
    const p = savedPayouts.find((x) => x.profile_id === c.claimant_id)!;
    check(await db.from("payout_details").insert({ reimbursement_id: c.id, account_holder: p.account_holder, iban: p.iban, paypal_email: p.paypal_email }), "saved payout details on claims");
    check(await db.from("reimbursements").update({ payout_method: p.iban ? "bank" : "paypal" }).eq("id", c.id), "payout method of claims");
  }
  const token = (prefix: string) => ({ token_hash: rng.hex(64), token_prefix: `${prefix}${rng.hex(4)}` });
  check(
    await db.from("calendar_feeds").upsert(
      [
        { profile_id: pid("chloe"), ...token("mesa_cal_"), created_at: iso(now - 20 * DAY), last_used_at: iso(now - 2 * HOUR) },
        { profile_id: pid("amara"), ...token("mesa_cal_"), created_at: iso(now - 9 * DAY), last_used_at: null },
        { profile_id: pid("elif"), ...token("mesa_cal_"), created_at: iso(now - 30 * DAY), last_used_at: iso(now - 5 * HOUR) },
      ],
      { onConflict: "profile_id" }
    ),
    "calendar links"
  );
  check(
    await db.from("esn_access_tokens").insert([
      { profile_id: pid("sofia"), label: "ESN script (Firefox)", ...token("mesa_esn_"), created_at: iso(now - 25 * DAY), expires_at: iso(now + 65 * DAY), last_used_at: iso(now - 3 * DAY) },
      { profile_id: pid("sofia"), label: "Old laptop", ...token("mesa_esn_"), created_at: iso(now - 80 * DAY), expires_at: iso(now + 10 * DAY), last_used_at: iso(now - 40 * DAY), revoked_at: iso(now - 26 * DAY) },
      { profile_id: pid("elif"), label: "Board laptop", ...token("mesa_esn_"), created_at: iso(now - 120 * DAY), expires_at: iso(now - 30 * DAY), last_used_at: iso(now - 45 * DAY) },
    ]),
    "ESN tokens"
  );

  const byKind: Record<string, number> = {};
  for (const r of rows) {
    const k = r.status === "cancelled" ? `${r.kind} (cancelled)` : r.kind;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  return { internalEvents: byKind, cashReports: reportStates, ledgerEntries: full.length };
}

/** What seedInternalStaging() made that the event and internal-event removal does not reach. */
export async function removeInternalStaging(db: Db, demoEmails: string[], demoIds: string[], tags: string[]): Promise<void> {
  const by = [...demoEmails, ...tags];
  check(await db.from("finance_entries").delete().in("created_by", by), "old ledger entries (demo members)");
  check(await db.from("cash_box_changes").delete().in("created_by", by), "old cash box history");
  const boxes = check(await db.from("cash_boxes").select("id").in("created_by", by).is("default_for", null), "old cash boxes").map((b) => b.id);
  if (boxes.length) {
    check(await db.from("cash_reports").delete().in("cash_box_id", boxes), "old reports of extra boxes");
    check(await db.from("cash_boxes").delete().in("id", boxes), "old cash boxes");
  }
  check(await db.from("profile_payout_details").delete().in("profile_id", demoIds), "old saved payout details");
  check(await db.from("calendar_feeds").delete().in("profile_id", demoIds), "old calendar links");
}
